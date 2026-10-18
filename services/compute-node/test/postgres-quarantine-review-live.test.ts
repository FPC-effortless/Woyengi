import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import {
  PostgresHostedComputeStatePort, PostgresHostedObservationJournal,
  PostgresHostedEffectVerificationJournal, PostgresHostedQuarantineReviewJournal,
  type HostedWorkloadLease,
} from "../index.ts";
import { migratePostgresCanonicalLedger, PostgresCanonicalLedger, type PostgresPool } from "../../postgres-storage/index.ts";

const db = process.env.WOYENGI_TEST_DATABASE_URL;
const driver = process.env.WOYENGI_PG_MODULE_ROOT;
const at = "2026-08-22T13:00:00Z";
const inspectedAt = "2026-08-22T13:06:05Z";
const verifiedAt = "2026-08-22T13:06:10Z";
const reviewAt = "2026-08-22T13:06:15Z";

function lease(): HostedWorkloadLease {
  const budget = { maxDurationMs: 1000, maxOutputBytes: 128,
    maxCost: { amount: 5, currency: "USD" } };
  return {
    id: "compute-lease:review", nodeId: "compute-node:worker",
    sessionId: "compute-node-session:worker",
    leasedAt: "2026-08-22T13:01:30Z", expiresAt: "2026-08-22T13:04:00Z",
    envelope: {
      executionId: "compute-execution:review",
      correlation: { workspaceId: "workspace:one", workInstanceId: "work-instance:one",
        workEpisodeId: "work-episode:one", traceId: "trace:one" },
      principalId: "principal:agent-one", authorityReference: "decision:review-scope",
      budget, idempotencyKey: "compute:review",
      workload: {
        id: "workload:review", workspaceId: "workspace:one",
        requestedByPrincipalId: "principal:agent-one", operation: "repair:ticket",
        input: { ticketId: "ticket:review" }, requiredCapabilities: ["compute:typescript"],
        budget, authorityReference: "decision:review-scope",
        idempotencyKey: "compute:review", createdAt: "2026-08-22T13:01:00Z",
      },
      expectedEffect: { id: "expected-effect:review", effectClass: "EXTERNAL" },
      reconciliation: { id: "reconciliation:review", strategy: "CANONICAL_READ", required: true },
      startedAt: "2026-08-22T13:02:00Z",
    },
  };
}

test("PostgreSQL quarantined Work review requires independently verified effect and trusted human reviewer", {
  skip: db && driver ? false : "requires PostgreSQL 16 and isolated pg driver",
}, async () => {
  const { Pool } = createRequire(join(driver!, "package.json"))("pg") as {
    readonly Pool: new (input: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const poolA = new Pool({ connectionString: db!, max: 4 });
  const poolB = new Pool({ connectionString: db!, max: 4 });
  try {
    await migratePostgresCanonicalLedger(poolA);
    const suffix = randomUUID().replaceAll("-", "");
    const namespaces = {
      state: "compute_state_" + suffix, receipts: "compute_receipts_" + suffix,
      verification: "compute_verification_" + suffix, review: "compute_review_" + suffix,
    };
    const receiptsA = PostgresHostedObservationJournal.open({ pool: poolA, namespace: namespaces.receipts });
    const receiptsB = PostgresHostedObservationJournal.open({ pool: poolB, namespace: namespaces.receipts });
    let clock = Date.parse(at);
    const makeState = (pool: PostgresPool, receipts: PostgresHostedObservationJournal) =>
      PostgresHostedComputeStatePort.open({
        pool, namespace: namespaces.state, receipts, providerId: "provider:worker",
        authorize: async request => ({ allowed: request.envelope.principalId === "principal:agent-one",
          decisionReference: request.envelope.authorityReference, reason: "test trusted agent policy" }),
        authorizeRegistration: async r =>
          r.nodeId === "compute-node:worker"
          && r.workspaceIds.length === 1 && r.workspaceIds[0] === "workspace:one"
          && r.capabilities.length === 1 && r.capabilities[0] === "compute:typescript",
        now: () => clock,
      });
    const stateA = makeState(poolA, receiptsA);
    const stateB = makeState(poolB, receiptsB);
    await stateA.register({
      nodeId: "compute-node:worker", version: "1.0.0",
      workspaceIds: ["workspace:one"], capabilities: ["compute:typescript"],
      budgetLimit: { maxDurationMs: 10000, maxOutputBytes: 1024,
        maxCost: { amount: 10, currency: "USD" } },
      heartbeatTtlMs: 300000, registeredAt: at,
    });
    const task = lease();
    await stateA.queueLease(task);
    assert.equal((await stateB.nextLease({
      nodeId: task.nodeId, sessionId: task.sessionId,
      workspaceIds: ["workspace:one"], capabilities: ["compute:typescript"],
      requestedAt: "2026-08-22T13:02:00Z",
    }))?.id, task.id);
    clock = Date.parse(inspectedAt);
    await stateB.quarantineExpiredLease({ leaseId: task.id, recordedAt: inspectedAt });

    let humanAllowed = true;
    const reviewerPolicy = async (request: {
      readonly reviewerPrincipalId: string; readonly workspaceId: string;
      readonly action: "OPEN" | "RESOLVE"; readonly leaseId: string;
    }) => humanAllowed && request.reviewerPrincipalId === "principal:human-reviewer"
      && request.workspaceId === "workspace:one"
      && request.leaseId === task.id;
    const makeVerifier = (pool: PostgresPool, receipts: PostgresHostedObservationJournal, status: "CONFIRMED" | "UNCERTAIN") =>
      PostgresHostedEffectVerificationJournal.open({
        pool, namespace: namespaces.verification, observations: receipts,
        verifierId: "verifier:independent",
        readEffect: async () => ({
          status, evidenceId: "canonical-evidence:independent-read",
          evidenceSourceId: "provider:independent-system",
          reason: status === "CONFIRMED" ? "independently corroborated external state" : "external state not observable",
          observedAt: verifiedAt,
        }),
      });
    const verificationA = makeVerifier(poolA, receiptsA, "CONFIRMED");
    const verificationB = makeVerifier(poolB, receiptsB, "CONFIRMED");
    const makeReviews = (pool: PostgresPool, state: PostgresHostedComputeStatePort,
      verification: PostgresHostedEffectVerificationJournal) =>
      PostgresHostedQuarantineReviewJournal.open({
        pool, namespace: namespaces.review, computeState: state, verifications: verification,
        authorizeReviewer: reviewerPolicy,
      });
    const reviewA = makeReviews(poolA, stateA, verificationA);
    const reviewB = makeReviews(poolB, stateB, verificationB);
    const base = { workspaceId: "workspace:one", leaseId: task.id,
      reviewerPrincipalId: "principal:human-reviewer" };
    await assert.rejects(reviewA.openCase({
      ...base, reviewerPrincipalId: "principal:worker", recordedAt: inspectedAt,
    }), /reviewer denied/);
    await assert.rejects(reviewA.openCase({
      ...base, workspaceId: "workspace:other", recordedAt: inspectedAt,
    }), /workspace|scope/);
    assert.deepEqual(await reviewB.history({ workspaceId: "workspace:one" }), []);
    const opened = await reviewA.openCase({ ...base, recordedAt: inspectedAt });
    assert.equal(opened.kind, "compute.lease.review.opened");
    assert.equal(opened.leaseId, task.id);
    assert.equal(opened.observationOnly, true);
    assert.equal(opened.acceptedTruth, false);
    assert.equal(opened.semanticMutation, false);
    assert.equal(opened.ledgerSequence, 1);
    await assert.rejects(reviewB.openCase({ ...base, recordedAt: inspectedAt }), /already open/);
    await assert.rejects(reviewB.resolveCase({
      ...base, recordedAt: reviewAt, rationale: "looks okay",
    }), /verified|evidence|missing/);
    assert.equal((await reviewA.history({ workspaceId: "workspace:one" })).length, 1);

    // Late-arriving receipt is evidence, not retry permission or acceptance.
    await stateA.publishObservation({
      contract: "woyengi.hosted-compute-observation.v1", id: "compute-node-observation:review",
      executionId: task.envelope.executionId, correlation: task.envelope.correlation,
      nodeId: task.nodeId, sessionId: task.sessionId, leaseId: task.id,
      providerId: "provider:worker", workloadId: task.envelope.workload.id,
      principalId: task.envelope.principalId,
      authorityReference: task.envelope.authorityReference,
      budget: task.envelope.budget, idempotencyKey: task.envelope.idempotencyKey,
      expectedEffectId: task.envelope.expectedEffect.id,
      expectedEffectClass: "EXTERNAL",
      reconciliation: { id: task.envelope.reconciliation.id,
        strategy: "CANONICAL_READ", required: true, status: "PENDING" },
      status: "succeeded", output: { claimed: true },
      usage: { durationMs: 200, outputBytes: 20, cost: { amount: 1, currency: "USD" } },
      startedAt: "2026-08-22T13:02:00Z", finishedAt: "2026-08-22T13:02:30Z",
      observationOnly: true, acceptedTruth: false, semanticMutation: false,
    });
    const evidence = await verificationA.verifyReceipt({
      workspaceId: "workspace:one", receiptId: "compute-node-observation:review", recordedAt: verifiedAt,
    });
    assert.equal(evidence.status, "CONFIRMED");
    humanAllowed = false;
    await assert.rejects(reviewB.resolveCase({
      ...base, recordedAt: reviewAt, rationale: "checked the independent evidence",
    }), /reviewer denied/);
    humanAllowed = true;
    await assert.rejects(reviewB.resolveCase({
      ...base, recordedAt: reviewAt, rationale: " ", 
    }), /rationale/);
    const attempts = await Promise.allSettled([
      reviewA.resolveCase({ ...base, recordedAt: reviewAt, rationale: "Independent evidence supports the effect" }),
      reviewB.resolveCase({ ...base, recordedAt: reviewAt, rationale: "Another reviewer also examined it" }),
    ]);
    assert.deepEqual(attempts.map(x => x.status).sort(), ["fulfilled", "rejected"]);
    const resolved = attempts.find((x): x is PromiseFulfilledResult<Awaited<ReturnType<typeof reviewA.resolveCase>>> =>
      x.status === "fulfilled")?.value;
    assert.equal(resolved?.kind, "compute.lease.review.resolved");
    assert.equal(resolved?.status, "EFFECT_CONFIRMED");
    assert.equal(resolved?.evidenceId, evidence.evidenceId);
    assert.equal(resolved?.acceptedTruth, false);
    assert.equal(resolved?.semanticMutation, false);
    assert.deepEqual((await reviewB.history({ workspaceId: "workspace:one" }))
      .map(x => [x.kind, x.ledgerSequence]),
    [["compute.lease.review.opened", 1], ["compute.lease.review.resolved", 2]]);
    await assert.rejects(reviewB.resolveCase({
      ...base, recordedAt: reviewAt, rationale: "re-resolve",
    }), /already resolved/);
    await assert.rejects(stateA.authorize({
      operation: "EXECUTE_HOSTED_WORKLOAD", nodeId: task.nodeId,
      providerId: "provider:worker", envelope: task.envelope,
    }), /quarantined/);
    assert.equal((await stateB.history()).filter(x => x.kind === "compute.lease.issued").length, 1);

    const raw = PostgresCanonicalLedger.open({ pool: poolA, namespace: namespaces.review });
    await raw.append({
      id: "quarantine-review:forged", kind: "compute.lease.retry.authorized",
      workspaceId: "workspace:one", transactionTime: { from: reviewAt },
    });
    await assert.rejects(reviewA.history({ workspaceId: "workspace:one" }), /unsupported/);
  } finally {
    await Promise.all([poolA.end(), poolB.end()]);
  }
});
