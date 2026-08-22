import assert from "node:assert/strict";
import { test } from "node:test";

import { GovernedExecutionEngine } from "../src/index.ts";

test("accepts and commits only authorized reconciled evidence-backed independently verified execution", () => {
  const engine = new GovernedExecutionEngine();
  const correlation = {
    workspaceId: "workspace:one",
    workInstanceId: "work-instance:launch",
    workEpisodeId: "work-episode:launch-1",
    traceId: "trace:launch-1",
  } as const;
  const allowed = (kind: "AUTHORITY" | "POLICY" | "BUDGET" | "RISK") => ({
    id: `decision:${kind.toLowerCase()}`,
    kind,
    status: "ALLOWED" as const,
    reason: `${kind.toLowerCase()} accepted`,
  });

  assert.throws(() => engine.createManifest({
    actionIntent: {
      id: "action-intent:unauthorized",
      correlation,
      principalId: "principal:agent",
      objective: "attempt without authority",
    },
    effectPlan: { id: "effect-plan:unauthorized", effects: [] },
    decisions: { policy: allowed("POLICY"), budget: allowed("BUDGET"), risk: allowed("RISK") },
    verificationContract: {
      id: "verification-contract:unauthorized",
      requiredEvidenceIds: [], independentVerifierRequired: true,
      budget: { maximumCost: 1, currency: "USD" }, maximumAttempts: 1,
      stopCondition: "VERIFIED",
    },
    recordedAt: "2026-08-21T00:00:00Z",
  } as never), /authority decision is required/);

  const manifest = engine.createManifest({
    id: "execution-manifest:launch",
    actionIntent: {
      id: "action-intent:launch",
      correlation,
      principalId: "principal:agent",
      objective: "publish the verified launch",
    },
    effectPlan: {
      id: "effect-plan:launch",
      effects: [
        {
          id: "expected-effect:runtime-subscription",
          effectClass: "RUNTIME",
          description: "subscribe to launch progress",
          runtimeEffectLeaseId: "runtime-effect-lease:launch-progress",
          runtimeCleanupOnly: true,
        },
        {
          id: "expected-effect:semantic-launch-state",
          effectClass: "SEMANTIC",
          description: "propose launch state",
          changeSetId: "change-set:launch-state",
        },
        {
          id: "expected-effect:external-release",
          effectClass: "EXTERNAL",
          description: "publish release",
          idempotencyKey: "release:launch-1",
          reconciliationRequired: true,
          correction: "COMPENSATION_OR_REPAIR",
        },
      ],
    },
    decisions: {
      authority: allowed("AUTHORITY"), policy: allowed("POLICY"),
      budget: allowed("BUDGET"), risk: allowed("RISK"),
    },
    verificationContract: {
      id: "verification-contract:launch",
      requiredEvidenceIds: ["evidence:release-state"],
      independentVerifierRequired: true,
      budget: { maximumCost: 5, currency: "USD" },
      maximumAttempts: 2,
      stopCondition: "VERIFIED",
    },
    recordedAt: "2026-08-21T00:00:00Z",
  });

  assert.equal(manifest.status, "AUTHORIZED");
  assert.equal(Object.isFrozen(manifest), true);
  assert.deepEqual(manifest.effectPlan.effects.map((effect) => effect.effectClass), ["RUNTIME", "SEMANTIC", "EXTERNAL"]);
  const runtimeEffect = manifest.effectPlan.effects[0];
  const externalEffect = manifest.effectPlan.effects[2];
  assert.equal(runtimeEffect?.effectClass === "RUNTIME" && runtimeEffect.runtimeCleanupOnly, true);
  assert.equal(externalEffect?.effectClass === "EXTERNAL" && externalEffect.correction, "COMPENSATION_OR_REPAIR");
  assert.equal("runtimeEffectLeaseId" in (externalEffect ?? {}), false);

  engine.recordReceipt({
    id: "execution-receipt:provider-ack",
    manifestId: manifest.id,
    providerId: "provider:release-api",
    transportStatus: 200,
    status: "SUCCEEDED",
    recordedAt: "2026-08-21T00:01:00Z",
  });
  const providerSuccessOnly = engine.decide({
    id: "acceptance-decision:provider-success-only",
    outcomeId: "accepted-outcome:provider-success-only",
    semanticCommitId: "semantic-commit:provider-success-only",
    manifestId: manifest.id,
    acceptedByPrincipalId: "principal:reviewer",
    recordedAt: "2026-08-21T00:02:00Z",
  });
  assert.equal(providerSuccessOnly.outcome.status, "REJECTED");
  assert.equal(providerSuccessOnly.outcome.acceptanceDecisionId, "acceptance-decision:provider-success-only");
  assert.equal(providerSuccessOnly.semanticCommit, undefined);
  assert.equal(providerSuccessOnly.outcome.reasons.some((reason) => reason.startsWith("MISSING_OBSERVATION:")), true);
  assert.equal(providerSuccessOnly.outcome.reasons.some((reason) => reason.startsWith("MISSING_RECONCILIATION:")), true);
  assert.equal(providerSuccessOnly.outcome.reasons.includes("MISSING_EVIDENCE:evidence:release-state"), true);
  assert.equal(providerSuccessOnly.outcome.reasons.includes("MISSING_VERIFICATION"), true);
  assert.throws(() => engine.decide({
    id: "invalid-decision-id",
    outcomeId: "accepted-outcome:invalid-decision-id",
    semanticCommitId: "semantic-commit:invalid-decision-id",
    manifestId: manifest.id,
    acceptedByPrincipalId: "principal:reviewer",
    recordedAt: "2026-08-21T00:02:30Z",
  }), /acceptance decision id must start with acceptance-decision:/);

  const observed = manifest.effectPlan.effects.map((effect, index) => engine.observeEffect({
    id: `observed-effect:${index + 1}`,
    manifestId: manifest.id,
    expectedEffectId: effect.id,
    effectClass: effect.effectClass,
    providerId: effect.effectClass === "EXTERNAL" ? "provider:release-api" : "provider:runtime",
    observation: effect.effectClass === "EXTERNAL" ? "HTTP 200; state not yet reread" : "effect observed",
    recordedAt: `2026-08-21T00:0${index + 3}:00Z`,
  }));
  engine.reconcile({
    id: "reconciliation:runtime",
    manifestId: manifest.id,
    expectedEffectId: "expected-effect:runtime-subscription",
    observedEffectId: observed[0]?.id as string,
    status: "CONFIRMED", strategy: "IN_PROCESS", reason: "lease exists",
    recordedAt: "2026-08-21T00:06:00Z",
  });
  engine.reconcile({
    id: "reconciliation:semantic",
    manifestId: manifest.id,
    expectedEffectId: "expected-effect:semantic-launch-state",
    observedEffectId: observed[1]?.id as string,
    status: "CONFIRMED", strategy: "CANONICAL_READ", reason: "proposal persisted",
    recordedAt: "2026-08-21T00:07:00Z",
  });
  engine.reconcile({
    id: "reconciliation:external-uncertain",
    manifestId: manifest.id,
    expectedEffectId: "expected-effect:external-release",
    observedEffectId: observed[2]?.id as string,
    status: "UNCERTAIN", strategy: "IMMEDIATE_REREAD", reason: "provider read timed out",
    recordedAt: "2026-08-21T00:08:00Z",
  });

  const uncertain = engine.decide({
    id: "acceptance-decision:uncertain",
    outcomeId: "accepted-outcome:uncertain",
    semanticCommitId: "semantic-commit:uncertain",
    manifestId: manifest.id,
    acceptedByPrincipalId: "principal:reviewer",
    recordedAt: "2026-08-21T00:09:00Z",
  });
  assert.equal(uncertain.outcome.status, "REJECTED");
  assert.equal(uncertain.outcome.reviewRequired, true);
  assert.equal(uncertain.outcome.reasons.includes("UNCERTAIN_EXTERNAL_EFFECT:expected-effect:external-release"), true);

  const compensation = engine.recordCompensation({
    id: "compensating-action:release",
    manifestId: manifest.id,
    expectedExternalEffectId: "expected-effect:external-release",
    reason: "repair if later divergence is confirmed",
    recordedAt: "2026-08-21T00:10:00Z",
  });
  assert.equal(compensation.kind, "COMPENSATING_ACTION");
  assert.equal(compensation.expectedExternalEffectId, "expected-effect:external-release");
  assert.notEqual(compensation.id, runtimeEffect?.effectClass === "RUNTIME" ? runtimeEffect.runtimeEffectLeaseId : "");

  engine.attachEvidence({
    id: "evidence:release-state",
    manifestId: manifest.id,
    source: "release API reread",
    recordedAt: "2026-08-21T00:11:00Z",
  });
  engine.reconcile({
    id: "reconciliation:external-confirmed",
    manifestId: manifest.id,
    expectedEffectId: "expected-effect:external-release",
    observedEffectId: observed[2]?.id as string,
    status: "CONFIRMED", strategy: "EVENTUAL_OBSERVATION", reason: "release reread matches",
    recordedAt: "2026-08-21T00:12:00Z",
  });
  engine.recordVerification({
    id: "verification-result:provider-self-check",
    manifestId: manifest.id,
    verifierId: "provider:release-api",
    status: "VERIFIED",
    independentFromProvider: false,
    evidenceIds: ["evidence:release-state"],
    attempt: 1, cost: { amount: 1, currency: "USD" }, stopConditionMet: true,
    recordedAt: "2026-08-21T00:13:00Z",
  });
  const selfVerified = engine.decide({
    id: "acceptance-decision:self-verified",
    outcomeId: "accepted-outcome:self-verified",
    semanticCommitId: "semantic-commit:self-verified",
    manifestId: manifest.id,
    acceptedByPrincipalId: "principal:reviewer",
    recordedAt: "2026-08-21T00:14:00Z",
  });
  assert.equal(selfVerified.outcome.status, "REJECTED");
  assert.equal(selfVerified.outcome.reasons.includes("INDEPENDENT_VERIFICATION_REQUIRED"), true);

  const verification = engine.recordVerification({
    id: "verification-result:independent",
    manifestId: manifest.id,
    verifierId: "verifier:independent-release",
    status: "VERIFIED",
    independentFromProvider: true,
    evidenceIds: ["evidence:release-state"],
    attempt: 2, cost: { amount: 2, currency: "USD" }, stopConditionMet: true,
    recordedAt: "2026-08-21T00:15:00Z",
  });
  assert.equal(verification.attempt, 2);
  assert.equal(verification.stopConditionMet, true);
  assert.deepEqual(verification.cost, { amount: 2, currency: "USD" });

  const accepted = engine.decide({
    id: "acceptance-decision:accepted",
    outcomeId: "accepted-outcome:launch",
    semanticCommitId: "semantic-commit:launch",
    manifestId: manifest.id,
    acceptedByPrincipalId: "principal:reviewer",
    recordedAt: "2026-08-21T00:16:00Z",
  });
  assert.equal(accepted.outcome.status, "ACCEPTED");
  assert.equal(accepted.outcome.verificationResultId, verification.id);
  assert.equal(accepted.semanticCommit?.id, "semantic-commit:launch");
  assert.deepEqual(accepted.semanticCommit?.semanticEffectIds, ["expected-effect:semantic-launch-state"]);

  const repeated = engine.decide({
    id: "acceptance-decision:repeated",
    outcomeId: "accepted-outcome:repeated",
    semanticCommitId: "semantic-commit:repeated",
    manifestId: manifest.id,
    acceptedByPrincipalId: "principal:reviewer",
    recordedAt: "2026-08-21T00:17:00Z",
  });
  assert.equal(repeated.outcome.status, "REJECTED");
  assert.equal(repeated.outcome.reasons.includes("SEMANTIC_COMMIT_ALREADY_EXISTS"), true);
  assert.equal(repeated.semanticCommit, undefined);

  const snapshot = engine.execution(manifest.id);
  assert.deepEqual(snapshot?.correlation, correlation);
  assert.equal(snapshot?.actionIntent.id, "action-intent:launch");
  assert.equal(snapshot?.receipt?.transportStatus, 200);
  assert.equal(snapshot?.journal.every((entry, index) => entry.sequence === index + 1), true);
  assert.equal(snapshot?.journal.every((entry) => JSON.stringify(entry.correlation) === JSON.stringify(correlation)), true);
  assert.equal(snapshot?.semanticCommits.length, 1);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("blocks acceptance when cumulative verification spend exceeds the contract budget", () => {
  const engine = new GovernedExecutionEngine();
  const manifest = prepareReconciledExecution(engine, "budget", 2);
  for (const [attempt, amount] of [[1, 1.25], [2, 1.25]] as const) {
    engine.recordVerification({
      id: `verification-result:budget-${attempt}`,
      manifestId: manifest.id,
      verifierId: `verifier:budget-${attempt}`,
      status: "VERIFIED",
      independentFromProvider: true,
      evidenceIds: ["evidence:budget"],
      attempt,
      cost: { amount, currency: "USD" },
      stopConditionMet: true,
      recordedAt: `2026-08-21T01:0${attempt + 3}:00Z`,
    });
  }

  const decision = engine.decide({
    id: "acceptance-decision:budget",
    outcomeId: "accepted-outcome:budget",
    semanticCommitId: "semantic-commit:budget",
    manifestId: manifest.id,
    acceptedByPrincipalId: "principal:reviewer",
    recordedAt: "2026-08-21T01:06:00Z",
  });

  assert.equal(decision.outcome.status, "REJECTED");
  assert.equal(decision.outcome.reasons.includes("VERIFICATION_BUDGET_EXCEEDED"), true);
  assert.equal(decision.semanticCommit, undefined);
});

function prepareReconciledExecution(engine: GovernedExecutionEngine, suffix: string, maximumCost: number) {
  const correlation = {
    workspaceId: "workspace:one",
    workInstanceId: `work-instance:${suffix}`,
    workEpisodeId: `work-episode:${suffix}`,
    traceId: `trace:${suffix}`,
  };
  const control = (kind: "AUTHORITY" | "POLICY" | "BUDGET" | "RISK") => ({
    id: `decision:${suffix}-${kind.toLowerCase()}`,
    kind,
    status: "ALLOWED" as const,
    reason: "allowed",
  });
  const manifest = engine.createManifest({
    id: `execution-manifest:${suffix}`,
    actionIntent: { id: `action-intent:${suffix}`, correlation, principalId: "principal:agent", objective: suffix },
    effectPlan: { id: `effect-plan:${suffix}`, effects: [{
      id: `expected-effect:${suffix}`,
      effectClass: "SEMANTIC",
      description: suffix,
      changeSetId: `change-set:${suffix}`,
    }] },
    decisions: { authority: control("AUTHORITY"), policy: control("POLICY"), budget: control("BUDGET"), risk: control("RISK") },
    verificationContract: {
      id: `verification-contract:${suffix}`,
      requiredEvidenceIds: [`evidence:${suffix}`],
      independentVerifierRequired: true,
      budget: { maximumCost, currency: "USD" },
      maximumAttempts: 2,
      stopCondition: "VERIFIED",
    },
    recordedAt: "2026-08-21T01:00:00Z",
  });
  engine.recordReceipt({
    id: `execution-receipt:${suffix}`,
    manifestId: manifest.id,
    providerId: `provider:${suffix}`,
    status: "SUCCEEDED",
    recordedAt: "2026-08-21T01:01:00Z",
  });
  const observed = engine.observeEffect({
    id: `observed-effect:${suffix}`,
    manifestId: manifest.id,
    expectedEffectId: `expected-effect:${suffix}`,
    effectClass: "SEMANTIC",
    providerId: `provider:${suffix}`,
    observation: "observed",
    recordedAt: "2026-08-21T01:02:00Z",
  });
  engine.reconcile({
    id: `reconciliation:${suffix}`,
    manifestId: manifest.id,
    expectedEffectId: `expected-effect:${suffix}`,
    observedEffectId: observed.id,
    status: "CONFIRMED",
    strategy: "CANONICAL_READ",
    reason: "confirmed",
    recordedAt: "2026-08-21T01:03:00Z",
  });
  engine.attachEvidence({
    id: `evidence:${suffix}`,
    manifestId: manifest.id,
    source: "test",
    recordedAt: "2026-08-21T01:04:00Z",
  });
  return manifest;
}
