import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  HostedComputeStateHttpApi, PostgresHostedComputeStatePort,
  PostgresHostedObservationJournal, type HostedWorkloadLease,
  type HostedAuthorityRequest,
} from "../index.ts";
import { migratePostgresCanonicalLedger, type PostgresPool } from "../../postgres-storage/index.ts";

const db = process.env.WOYENGI_TEST_DATABASE_URL;
const root = process.env.WOYENGI_PG_MODULE_ROOT;
const issued = "2026-08-22T13:00:00Z";
const token = "compute-" + "q".repeat(48);

test("real PostgreSQL state server safely grants one lease to independent compute process and records a governed receipt", {
  skip: db && root ? false : "requires PostgreSQL and an isolated pg driver",
}, async (t) => {
  const { Pool } = createRequire(join(root!, "package.json"))("pg") as {
    readonly Pool: new (input: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const poolA = new Pool({ connectionString: db!, max: 4 });
  const poolB = new Pool({ connectionString: db!, max: 4 });
  const suffix = randomUUID().replaceAll("-", "");
  const journal = "hosted_state_" + suffix;
  const receipts = "hosted_receipts_" + suffix;
  await migratePostgresCanonicalLedger(poolA);
  const observedA = PostgresHostedObservationJournal.open({ pool: poolA, namespace: receipts });
  const observedB = PostgresHostedObservationJournal.open({ pool: poolB, namespace: receipts });
  let decisions = 0;
  let permit = true;
  const authorize = async (request: HostedAuthorityRequest) => {
    decisions += 1;
    return {
      allowed: permit && request.nodeId === "compute-node:one"
        && request.providerId === "provider:hosted-compute"
        && request.envelope.principalId === "principal:agent-one",
      decisionReference: request.envelope.authorityReference,
      reason: "explicit trusted policy for test agent scope",
    };
  };
  let clock = Date.parse(issued);
  const makeState = (pool: PostgresPool, receipt: PostgresHostedObservationJournal) =>
    PostgresHostedComputeStatePort.open({
      pool, namespace: journal, receipts: receipt, providerId: "provider:hosted-compute",
      authorize,
      authorizeRegistration: async candidate =>
        candidate.nodeId === "compute-node:one"
        && candidate.version === "1.0.0"
        && candidate.workspaceIds.length === 1
        && candidate.workspaceIds[0] === "workspace:one"
        && candidate.capabilities.length === 1
        && candidate.capabilities[0] === "compute:typescript"
        && candidate.budgetLimit.maxCost.amount === 10
        && candidate.budgetLimit.maxCost.currency === "USD"
        && candidate.budgetLimit.maxDurationMs === 10_000
        && candidate.budgetLimit.maxOutputBytes === 1024
        && candidate.heartbeatTtlMs === 300_000
        && Date.parse(candidate.registeredAt) === Date.parse(issued),
      now: () => clock,
    });
  const a = makeState(poolA, observedA);
  const b = makeState(poolB, observedB);
  const server = await new HostedComputeStateHttpApi({
    statePort: b, credentials: [{ nodeId: "compute-node:one", token }],
  }).listen({ hostname: "127.0.0.1", port: 0 });
  t.after(async () => {
    await server.close();
    await Promise.all([poolA.end(), poolB.end()]);
  });
  const node = registration();
  const initial = await a.register(node);
  assert.equal(initial.sessionId, "compute-node-session:one");
  await assert.rejects(a.register({
    ...node, workspaceIds: ["workspace:unapproved"],
  }), /registration denied/);
  await assert.rejects(b.register({
    ...node, capabilities: ["compute:typescript", "compute:admin"],
  }), /registration denied/);
  assert.equal((await b.register(node)).sessionId, initial.sessionId);
  assert.equal((await a.history()).length, 1);

  const lease = hostedLease();
  await assert.rejects(a.queueLease({ ...lease, nodeId: "compute-node:forged" }), /authority denied/);
  permit = false;
  await assert.rejects(a.queueLease(lease), /authority denied/);
  permit = true;
  await a.queueLease(lease);
  assert.equal(decisions >= 2, true);
  assert.equal((await b.history()).filter(x => x.kind === "compute.lease.queued").length, 1);
  await assert.rejects(b.authorize({
    operation: "EXECUTE_HOSTED_WORKLOAD", nodeId: "compute-node:one",
    providerId: "provider:hosted-compute", envelope: lease.envelope,
  }), /not issued/);
  assert.equal((await b.nextLease({
    nodeId: "compute-node:one", sessionId: "compute-node-session:forged",
    workspaceIds: ["workspace:one"], capabilities: ["compute:typescript"],
    requestedAt: "2026-08-22T13:02:00Z",
  })), undefined);
  // Two process-side ports, one PostgreSQL causal scope lock: only one can
  // claim the queued lease. The other sees no claimable work.
  const attempts = await Promise.all([a.nextLease({
    nodeId: "compute-node:one", sessionId: initial.sessionId,
    workspaceIds: ["workspace:one"], capabilities: ["compute:typescript"],
    requestedAt: "2026-08-22T13:02:00Z",
  }), b.nextLease({
    nodeId: "compute-node:one", sessionId: initial.sessionId,
    workspaceIds: ["workspace:one"], capabilities: ["compute:typescript"],
    requestedAt: "2026-08-22T13:02:00Z",
  })]);
  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal(attempts.find(Boolean)?.id, lease.id);
  assert.equal((await b.history()).filter(x => x.kind === "compute.lease.issued").length, 1);

  // A second distinct lease, claimed only by the child process's HTTP call.
  const second = {
    ...lease, id: "compute-lease:child",
    envelope: {
      ...lease.envelope, executionId: "compute-execution:child",
      idempotencyKey: "compute:child",
      workload: { ...lease.envelope.workload, id: "workload:child",
        idempotencyKey: "compute:child" },
    },
  };
  await a.queueLease(second);
  // A different OS process claims the second lease while the first remains
  // exclusively claimed by the competing database client.
  clock = Date.parse("2026-08-22T13:02:00Z");
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  const child = spawn(process.execPath, [
    fileURLToPath(new URL("../fixtures/remote-compute-child.ts", import.meta.url)),
  ], { shell: false, stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, WOYENGI_TEST_REMOTE_COMPUTE_URL: server.url,
    WOYENGI_TEST_REMOTE_NODE_TOKEN: token,
    WOYENGI_TEST_REMOTE_WORKLOAD_ID: "workload:child",
  } });
  child.stdout.on("data", (x: Buffer) => output.push(x));
  child.stderr.on("data", (x: Buffer) => errors.push(x));
  const exit = await new Promise<number>((resolve, reject) => {
    const kill = setTimeout(() => { child.kill(); reject(new Error("compute child timeout")); }, 15_000);
    child.once("error", err => { clearTimeout(kill); reject(err); });
    child.once("close", code => { clearTimeout(kill); resolve(code ?? -1); });
  });
  assert.equal(exit, 0, Buffer.concat(errors).toString("utf8"));
  const observation = (JSON.parse(Buffer.concat(output).toString("utf8")) as { observation: unknown }).observation;
  const childReceipt = observation as { readonly leaseId: string; readonly acceptedTruth: boolean;
    readonly usage: { readonly cost: { readonly amount: number } } };
  assert.equal(childReceipt.leaseId, "compute-lease:child");
  assert.equal(childReceipt.acceptedTruth, false);
  assert.equal(childReceipt.usage.cost.amount, 2);
  assert.equal((await observedB.history({ workspaceId: "workspace:one" })).length, 1);
  assert.equal((await b.history()).filter(x => x.kind === "compute.lease.issued").length, 2);

  await assert.rejects(a.publishObservation({
    ...observationFixture(), leaseId: "compute-lease:unknown",
  }), /unknown|issued|mismatch/);
  const published = observationFixture();
  await assert.rejects(b.publishObservation({
    ...published, id: "compute-node-observation:second-alias",
  }), /observation id does not match issued execution/);
  await b.publishObservation(published);
  await a.publishObservation(published);
  const saved = await observedB.history({ workspaceId: "workspace:one" });
  assert.equal(saved.length, 2);
  assert.equal(saved.every(item => item.usage.cost.amount === 2), true);
  assert.equal(saved.every(item => item.reconciliation.status === "PENDING"), true);
  assert.equal(saved.every(item => item.acceptedTruth === false), true);
  assert.equal(saved.every(item => item.authorityReference === "decision:authority-repair-19c"), true);

  // A third lease is claimed, then its worker disappears without publishing
  // evidence. Expiration MUST NEVER cause automatic replay of the same effect.
  const abandoned: HostedWorkloadLease = {
    ...lease, id: "compute-lease:abandoned",
    envelope: {
      ...lease.envelope, executionId: "compute-execution:abandoned",
      idempotencyKey: "compute:abandoned",
      workload: { ...lease.envelope.workload,
        id: "workload:abandoned", idempotencyKey: "compute:abandoned" },
    },
  };
  await a.queueLease(abandoned);
  const claim = await b.nextLease({
    nodeId: "compute-node:one", sessionId: initial.sessionId,
    workspaceIds: ["workspace:one"], capabilities: ["compute:typescript"],
    requestedAt: "2026-08-22T13:02:00Z",
  });
  assert.equal(claim?.id, abandoned.id);
  await assert.rejects(a.quarantineExpiredLease({
    leaseId: abandoned.id, recordedAt: "2026-08-22T13:03:00Z",
  }), /not expired/);
  await assert.rejects(b.quarantineExpiredLease({
    leaseId: "compute-lease:unissued", recordedAt: "2026-08-22T13:06:01Z",
  }), /not issued/);

  permit = false;
  const rejected = await b.authorize({
    operation: "EXECUTE_HOSTED_WORKLOAD", nodeId: "compute-node:one",
    providerId: "provider:hosted-compute", envelope: lease.envelope,
  });
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.decisionReference, lease.envelope.authorityReference);
  clock = Date.parse("2026-08-22T13:06:01Z");
  assert.equal((await b.nextLease({
    nodeId: "compute-node:one", sessionId: initial.sessionId,
    workspaceIds: ["workspace:one"], capabilities: ["compute:typescript"],
    requestedAt: "2026-08-22T13:06:01Z",
  })), undefined);

  const results = await Promise.allSettled([
    a.quarantineExpiredLease({
      leaseId: abandoned.id, recordedAt: "2026-08-22T13:06:01Z",
    }),
    b.quarantineExpiredLease({
      leaseId: abandoned.id, recordedAt: "2026-08-22T13:06:01Z",
    }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal((await b.history()).filter(op => op.kind === "compute.lease.quarantined").length, 1);
  const quarantine = (await a.history()).find(op => op.kind === "compute.lease.quarantined");
  assert.equal(quarantine?.kind, "compute.lease.quarantined");
  if (quarantine?.kind === "compute.lease.quarantined") {
    assert.equal(quarantine.leaseId, abandoned.id);
    assert.equal(quarantine.reason, "OUTCOME_UNVERIFIED");
  }
  await assert.rejects(b.quarantineExpiredLease({
    leaseId: abandoned.id, recordedAt: "2026-08-22T13:06:02Z",
  }), /already quarantined/);
  permit = true;
  await assert.rejects(b.authorize({
    operation: "EXECUTE_HOSTED_WORKLOAD", nodeId: "compute-node:one",
    providerId: "provider:hosted-compute", envelope: abandoned.envelope,
  }), /expired|quarantined/);
  // A late observation is still retained as evidence for independent
  // reconciliation, not treated as permission to retry the external action.
  await a.publishObservation({
    ...published,
    id: "compute-node-observation:abandoned",
    executionId: abandoned.envelope.executionId,
    leaseId: abandoned.id,
    workloadId: abandoned.envelope.workload.id,
    idempotencyKey: abandoned.envelope.idempotencyKey,
  });
  assert.equal((await observedB.history({ workspaceId: "workspace:one" })).length, 3);
  assert.equal((await a.history()).filter(op => op.kind === "compute.lease.quarantined").length, 1);
});

function registration() {
  return {
    nodeId: "compute-node:one", version: "1.0.0",
    workspaceIds: ["workspace:one"], capabilities: ["compute:typescript"],
    budgetLimit: {
      maxDurationMs: 10_000, maxOutputBytes: 1024,
      maxCost: { amount: 10, currency: "USD" },
    },
    heartbeatTtlMs: 300_000, registeredAt: issued,
  };
}
function hostedLease(): HostedWorkloadLease {
  const budget = { maxDurationMs: 1000, maxOutputBytes: 128,
    maxCost: { amount: 5, currency: "USD" } };
  return {
    id: "compute-lease:repair-19c",
    nodeId: "compute-node:one", sessionId: "compute-node-session:one",
    leasedAt: "2026-08-22T13:01:30Z", expiresAt: "2026-08-22T13:04:00Z",
    envelope: {
      executionId: "compute-execution:repair-19c",
      correlation: { workspaceId: "workspace:one", workInstanceId: "work-instance:incident-19c",
        workEpisodeId: "work-episode:repair-19c", traceId: "trace:repair-19c" },
      principalId: "principal:agent-one", authorityReference: "decision:authority-repair-19c",
      budget, idempotencyKey: "compute:repair-19c",
      workload: {
        id: "workload:repair-19c", workspaceId: "workspace:one",
        requestedByPrincipalId: "principal:agent-one", operation: "repair:ticket",
        input: { ticketId: "ticket:19c" }, requiredCapabilities: ["compute:typescript"],
        budget, authorityReference: "decision:authority-repair-19c",
        idempotencyKey: "compute:repair-19c", createdAt: "2026-08-22T13:01:00Z",
      },
      expectedEffect: { id: "expected-effect:ticket-update", effectClass: "EXTERNAL" },
      reconciliation: { id: "reconciliation:ticket-update", strategy: "CANONICAL_READ", required: true },
      startedAt: "2026-08-22T13:02:00Z",
    },
  };
}
function observationFixture() {
  return {
    contract: "woyengi.hosted-compute-observation.v1" as const,
    id: "compute-node-observation:repair-19c", executionId: "compute-execution:repair-19c",
    correlation: hostedLease().envelope.correlation, nodeId: "compute-node:one",
    sessionId: "compute-node-session:one", leaseId: "compute-lease:repair-19c",
    providerId: "provider:hosted-compute", workloadId: "workload:repair-19c",
    principalId: "principal:agent-one", authorityReference: "decision:authority-repair-19c",
    budget: hostedLease().envelope.budget, idempotencyKey: "compute:repair-19c",
    expectedEffectId: "expected-effect:ticket-update", expectedEffectClass: "EXTERNAL" as const,
    reconciliation: { id: "reconciliation:ticket-update", strategy: "CANONICAL_READ" as const,
      required: true, status: "PENDING" as const },
    status: "succeeded" as const,
    output: { repaired: true },
    usage: { durationMs: 240, outputBytes: 32, cost: { amount: 2, currency: "USD" } },
    startedAt: "2026-08-22T13:02:00Z", finishedAt: "2026-08-22T13:02:30Z",
    observationOnly: true as const, acceptedTruth: false as const, semanticMutation: false as const,
  };
}
