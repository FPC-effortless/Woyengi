import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  HostedComputeStateHttpApi, PostgresHostedObservationJournal,
  type ComputeNodeStatePort, type HostedComputeObservation, type HostedWorkloadLease,
} from "../index.ts";
import {
  migratePostgresCanonicalLedger, PostgresCanonicalLedger, type PostgresPool,
} from "../../postgres-storage/index.ts";

const db = process.env.WOYENGI_TEST_DATABASE_URL;
const root = process.env.WOYENGI_PG_MODULE_ROOT;
const token = "remote-" + "q".repeat(48);

test("independent compute process delivers an append-only PostgreSQL usage/effect observation, with safe retries", {
  skip: db && root ? false : "requires real PostgreSQL and driver",
}, async (t) => {
  const { Pool } = createRequire(join(root!, "package.json"))("pg") as {
    readonly Pool: new (input: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const poolA = new Pool({ connectionString: db!, max: 4 });
  const poolB = new Pool({ connectionString: db!, max: 4 });
  const namespace = "compute_" + randomUUID().replaceAll("-", "");
  await migratePostgresCanonicalLedger(poolA);
  const a = PostgresHostedObservationJournal.open({ pool: poolA, namespace });
  const b = PostgresHostedObservationJournal.open({ pool: poolB, namespace });
  const state: ComputeNodeStatePort = {
    register: async input => ({
      sessionId: "compute-node-session:node-one",
      nodeId: input.nodeId,
      acceptedAt: "2026-08-22T13:00:00Z",
      heartbeatExpiresAt: "2026-08-22T13:05:00Z",
    }),
    heartbeat: async input => ({
      sessionId: input.sessionId, nodeId: input.nodeId,
      acceptedAt: "2026-08-22T13:01:00Z", heartbeatExpiresAt: "2026-08-22T13:06:00Z",
    }),
    nextLease: async () => lease(),
    authorize: async input => ({
      allowed: input.envelope.authorityReference === "decision:authority-repair-19c",
      decisionReference: input.envelope.authorityReference, reason: "authorized by trusted state service",
    }),
    publishObservation: async observation => { await a.publishObservation(observation); },
  };
  const server = await new HostedComputeStateHttpApi({
    statePort: state, credentials: [{ nodeId: "compute-node:one", token }],
  }).listen({ hostname: "127.0.0.1", port: 0 });
  t.after(async () => {
    await server.close();
    await Promise.all([poolA.end(), poolB.end()]);
  });
  const child = spawn(process.execPath, [
    fileURLToPath(new URL("../fixtures/remote-compute-child.ts", import.meta.url)),
  ], {
    env: { ...process.env, WOYENGI_TEST_REMOTE_COMPUTE_URL: server.url,
      WOYENGI_TEST_REMOTE_NODE_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  const outputs: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on("data", (x: Buffer) => outputs.push(x));
  child.stderr.on("data", (x: Buffer) => errors.push(x));
  const exit = await new Promise<number>((resolve, reject) => {
    const abort = setTimeout(() => { child.kill(); reject(new Error("compute child timed out")); }, 15_000);
    child.once("error", error => { clearTimeout(abort); reject(error); });
    child.once("close", code => { clearTimeout(abort); resolve(code ?? -1); });
  });
  assert.equal(exit, 0, Buffer.concat(errors).toString("utf8"));
  const published = (JSON.parse(Buffer.concat(outputs).toString("utf8")) as {
    readonly observation: HostedComputeObservation;
  }).observation;
  assert.equal(published.observationOnly, true);
  assert.equal(published.acceptedTruth, false);
  assert.equal(published.semanticMutation, false);

  const received = await b.history({ workspaceId: "workspace:one" });
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], published);
  assert.equal(received[0]?.reconciliation.status, "PENDING");
  assert.equal(received[0]?.expectedEffectId, "expected-effect:ticket-update");
  assert.equal(received[0]?.usage.cost.amount, 2);

  // Re-publishing the same observation through another independent DB pool
  // must converge to one canonical receipt, including concurrent retries.
  await Promise.all([a.publishObservation(published), b.publishObservation(published)]);
  assert.equal((await b.history({ workspaceId: "workspace:one" })).length, 1);
  await assert.rejects(b.publishObservation({
    ...published, usage: { ...published.usage,
      cost: { ...published.usage.cost, amount: 3 } },
  }), /conflict/);
  await assert.rejects(b.publishObservation({
    ...published, id: "compute-node-observation:untrusted", acceptedTruth: true,
  }), /observation-only/);
  assert.equal((await a.history({ workspaceId: "workspace:one" })).length, 1);

  // Unknown privileged writes cannot become a projection of valid receipt.
  const raw = PostgresCanonicalLedger.open({ pool: poolA, namespace });
  await raw.append({
    id: "compute-node-observation:corrupted", kind: "compute.privilege-granted",
    workspaceId: "workspace:one",
    transactionTime: { from: "2026-08-22T13:03:00Z" },
  });
  await assert.rejects(b.history({ workspaceId: "workspace:one" }), /unsupported|unexpected/);
});

function lease(): HostedWorkloadLease {
  const budget = {
    maxDurationMs: 1000, maxOutputBytes: 128,
    maxCost: { amount: 5, currency: "USD" },
  };
  return {
    id: "compute-lease:repair-19c",
    nodeId: "compute-node:one",
    sessionId: "compute-node-session:node-one",
    leasedAt: "2026-08-22T13:01:30Z",
    expiresAt: "2026-08-22T13:04:00Z",
    envelope: {
      executionId: "compute-execution:repair-19c",
      correlation: {
        workspaceId: "workspace:one", workInstanceId: "work-instance:incident-19c",
        workEpisodeId: "work-episode:repair-19c", traceId: "trace:repair-19c",
      },
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
      reconciliation: { id: "reconciliation:ticket-update",
        strategy: "CANONICAL_READ", required: true },
      startedAt: "2026-08-22T13:02:00Z",
    },
  };
}
