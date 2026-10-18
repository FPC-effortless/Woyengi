import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import {
  PostgresHostedEffectVerificationJournal,
  PostgresHostedObservationJournal,
  type HostedComputeObservation,
} from "../index.ts";
import {
  migratePostgresCanonicalLedger,
  PostgresCanonicalLedger,
  type PostgresPool,
} from "../../postgres-storage/index.ts";

const url = process.env.WOYENGI_TEST_DATABASE_URL;
const driver = process.env.WOYENGI_PG_MODULE_ROOT;
const at = "2026-10-18T10:00:00Z";
const observedAt = "2026-10-18T10:01:00Z";

function receipt(name: string): HostedComputeObservation {
  return {
    contract: "woyengi.hosted-compute-observation.v1",
    id: "compute-node-observation:" + name,
    executionId: "compute-execution:" + name,
    correlation: {
      workspaceId: "workspace:verified",
      workInstanceId: "work-instance:verification",
      workEpisodeId: "work-episode:verification",
      traceId: "trace:verification",
    },
    nodeId: "compute-node:worker",
    sessionId: "compute-node-session:worker",
    leaseId: "compute-lease:" + name,
    providerId: "provider:untrusted-worker",
    workloadId: "workload:" + name,
    principalId: "principal:agent",
    authorityReference: "decision:authority-" + name,
    budget: {
      maxDurationMs: 5000, maxOutputBytes: 1024,
      maxCost: { amount: 2, currency: "USD" },
    },
    idempotencyKey: "compute:run-" + name,
    expectedEffectId: "expected-effect:" + name,
    expectedEffectClass: "EXTERNAL",
    reconciliation: {
      id: "reconciliation:" + name,
      strategy: "CANONICAL_READ",
      required: true,
      status: "PENDING",
    },
    status: "succeeded",
    output: { workerClaimsItChanged: true },
    usage: { durationMs: 100, outputBytes: 20, cost: { amount: 1, currency: "USD" } },
    startedAt: at, finishedAt: at,
    observationOnly: true, acceptedTruth: false, semanticMutation: false,
  };
}

test("PostgreSQL effect verifier rereads independent state and retains CONFIRMED/DIVERGED/UNCERTAIN evidence across DB instances", {
  skip: !url || !driver ? "requires PostgreSQL 16 and an isolated pg driver" : false,
}, async () => {
  const { Pool } = createRequire(join(driver!, "package.json"))("pg") as {
    readonly Pool: new (input: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const poolA = new Pool({ connectionString: url!, max: 4 });
  const poolB = new Pool({ connectionString: url!, max: 4 });
  try {
    await migratePostgresCanonicalLedger(poolA);
    const suffix = randomUUID().replaceAll("-", "");
    const receiptNs = "compute_receipt_" + suffix;
    const verificationNs = "compute_verify_" + suffix;
    const sourceA = PostgresHostedObservationJournal.open({ pool: poolA, namespace: receiptNs });
    const sourceB = PostgresHostedObservationJournal.open({ pool: poolB, namespace: receiptNs });
    const confirmed = receipt("confirmed");
    const absent = receipt("absent");
    const unknown = receipt("unknown");
    for (const item of [confirmed, absent, unknown]) await sourceA.publishObservation(item);

    // Independent canonical state, controlled by the verification provider,
    // not by the worker's output or the client request.
    const observedState = new Map<string, "PRESENT" | "ABSENT">([
      [confirmed.expectedEffectId, "PRESENT"],
      [absent.expectedEffectId, "ABSENT"],
    ]);
    let reads = 0;
    const verify = async (request: {
      readonly expectedEffectId: string;
      readonly correlation: { readonly workspaceId: string };
    }) => {
      reads++;
      assert.equal(request.correlation.workspaceId, "workspace:verified");
      const state = observedState.get(request.expectedEffectId);
      return {
        status: state === "PRESENT" ? "CONFIRMED" as const
          : state === "ABSENT" ? "DIVERGED" as const : "UNCERTAIN" as const,
        evidenceId: "canonical-evidence:read-" + reads,
        evidenceSourceId: "provider:independent-canonical-read",
        reason: state === "PRESENT" ? "independent state agrees"
          : state === "ABSENT" ? "effect missing from canonical read" : "no independent evidence",
        observedAt,
      };
    };

    const a = PostgresHostedEffectVerificationJournal.open({
      pool: poolA, namespace: verificationNs, observations: sourceA,
      verifierId: "verifier:canonical-observer",
      readEffect: verify,
    });
    const b = PostgresHostedEffectVerificationJournal.open({
      pool: poolB, namespace: verificationNs, observations: sourceB,
      verifierId: "verifier:canonical-observer",
      readEffect: verify,
    });
    assert.deepEqual(await a.history({ workspaceId: "workspace:verified" }), []);

    const success = await b.verifyReceipt({
      workspaceId: "workspace:verified", receiptId: confirmed.id, recordedAt: observedAt,
    });
    assert.equal(success.status, "CONFIRMED");
    assert.equal(success.receiptId, confirmed.id);
    assert.equal(success.expectedEffectId, confirmed.expectedEffectId);
    assert.equal(success.verifierId, "verifier:canonical-observer");
    assert.equal(success.evidenceSourceId, "provider:independent-canonical-read");
    assert.equal(success.observationOnly, true);
    assert.equal(success.semanticMutation, false);
    assert.equal(success.acceptedTruth, false);
    assert.equal(success.ledgerSequence, 1);
    assert.equal((await a.history({ workspaceId: "workspace:verified" })).length, 1);

    const divergence = await a.verifyReceipt({
      workspaceId: "workspace:verified", receiptId: absent.id, recordedAt: observedAt,
    });
    const inconclusive = await b.verifyReceipt({
      workspaceId: "workspace:verified", receiptId: unknown.id, recordedAt: observedAt,
    });
    assert.equal(divergence.status, "DIVERGED");
    assert.equal(inconclusive.status, "UNCERTAIN");
    assert.deepEqual((await b.history({ workspaceId: "workspace:verified" }))
      .map(x => [x.ledgerSequence, x.status]),
    [[1, "CONFIRMED"], [2, "DIVERGED"], [3, "UNCERTAIN"]]);
    assert.equal((await b.history({ workspaceId: "workspace:verified" })).every(x =>
      x.acceptedTruth === false && x.semanticMutation === false), true);
    assert.equal((await sourceA.history({ workspaceId: "workspace:verified" })).length, 3);

    await assert.rejects(a.verifyReceipt({
      workspaceId: "workspace:verified", receiptId: confirmed.id, recordedAt: observedAt,
    }), /already recorded/);
    await assert.rejects(a.verifyReceipt({
      workspaceId: "workspace:other", receiptId: confirmed.id, recordedAt: observedAt,
    }), /not found/);
    assert.equal((await b.history({ workspaceId: "workspace:verified" })).length, 3);

    const sameReceipt = receipt("race");
    await sourceA.publishObservation(sameReceipt);
    const raced = await Promise.allSettled([a.verifyReceipt({
      workspaceId: "workspace:verified", receiptId: sameReceipt.id, recordedAt: observedAt,
    }), b.verifyReceipt({
      workspaceId: "workspace:verified", receiptId: sameReceipt.id, recordedAt: observedAt,
    })]);
    assert.deepEqual(raced.map(x => x.status).sort(), ["fulfilled", "rejected"]);
    assert.equal((await a.history({ workspaceId: "workspace:verified" })).length, 4);

    // An unrecognized privileged operation poisons projections instead of
    // making past evidence disappear or being silently ignored.
    const raw = PostgresCanonicalLedger.open({ pool: poolA, namespace: verificationNs });
    await raw.append({
      id: "effect-verification:forged",
      kind: "effect.accepted",
      workspaceId: "workspace:verified",
      transactionTime: { from: observedAt },
    });
    await assert.rejects(b.history({ workspaceId: "workspace:verified" }), /unsupported/);
  } finally {
    await Promise.all([poolA.end(), poolB.end()]);
  }
});

test("independent effect verification refuses self-attestation and cannot upgrade a worker receipt", {
  skip: !url || !driver ? "requires PostgreSQL 16 and an isolated pg driver" : false,
}, async () => {
  const { Pool } = createRequire(join(driver!, "package.json"))("pg") as {
    readonly Pool: new (input: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const pool = new Pool({ connectionString: url!, max: 3 });
  try {
    await migratePostgresCanonicalLedger(pool);
    const suffix = randomUUID().replaceAll("-", "");
    const observations = PostgresHostedObservationJournal.open({
      pool, namespace: "receipt_" + suffix,
    });
    const value = receipt("spoof");
    await observations.publishObservation(value);
    const journal = PostgresHostedEffectVerificationJournal.open({
      pool, namespace: "verification_" + suffix, observations,
      verifierId: "verifier:external-canonical-check",
      readEffect: async () => ({
        status: "CONFIRMED",
        evidenceId: "canonical-evidence:worker-claim",
        evidenceSourceId: value.providerId, // Untrusted execution provider.
        reason: "worker self-attested",
        observedAt,
      }),
    });
    await assert.rejects(journal.verifyReceipt({
      workspaceId: value.correlation.workspaceId,
      receiptId: value.id, recordedAt: observedAt,
    }), /independent/);
    assert.deepEqual(await journal.history({ workspaceId: value.correlation.workspaceId }), []);
    await assert.rejects(journal.verifyReceipt({
      workspaceId: value.correlation.workspaceId,
      receiptId: value.id, recordedAt: "2026-10-18T09:59:59Z",
    }), /before receipt|precede/);
  } finally {
    await pool.end();
  }
});
