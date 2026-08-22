import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EpisodeEvaluator,
  type EpisodeEvaluationTraceInput,
} from "../src/index.ts";

test("replays an immutable correlated episode trace with fully attributed same-currency cost and no issued effects", () => {
  const evaluator = new EpisodeEvaluator();
  const trace = evaluator.recordTrace(episodeTrace());
  const replay = evaluator.replay(trace);

  assert.equal(Object.isFrozen(trace), true);
  assert.equal(Object.isFrozen(trace.usage[0]), true);
  assert.deepEqual(replay.correlation, {
    traceId: "trace:episode-18",
    workspaceId: "workspace:one",
    workInstanceId: "work-instance:incident-18",
    workEpisodeId: "work-episode:repair-18",
  });
  assert.deepEqual(replay.references, trace.references);
  assert.deepEqual(replay.cost, {
    total: { amount: 3, currency: "USD" },
    byPrincipal: [{ id: "principal:agent-one", cost: { amount: 3, currency: "USD" } }],
    byProvider: [
      { id: "provider:model-one", cost: { amount: 2, currency: "USD" } },
      { id: "provider:verifier-one", cost: { amount: 1, currency: "USD" } },
    ],
    byProcedure: [{ id: "procedure:repair", cost: { amount: 3, currency: "USD" } }],
    byWorkload: [{ id: "workload:repair-18", cost: { amount: 3, currency: "USD" } }],
    byApplication: [{ id: "application-instance:repair", cost: { amount: 3, currency: "USD" } }],
  });
  assert.equal(replay.acceptanceStatus, "ACCEPTED");
  assert.equal(replay.semanticCommitId, "semantic-commit:repair-18");
  assert.equal(replay.semanticEffectsIssued, false);
  assert.equal(replay.externalEffectsIssued, false);
  assert.equal(replay.source, "RECORDED_ONLY");
});

test("rejects ambiguous cost currencies instead of aggregating incomparable values", () => {
  const evaluator = new EpisodeEvaluator();
  const input = episodeTrace();
  assert.throws(() => evaluator.recordTrace({
    ...input,
    usage: input.usage.map((entry, index) => index === 0 ? entry : { ...entry, cost: { amount: 1, currency: "EUR" } }),
  }), /ambiguous currency: EUR, USD/);
});

test("compares recorded strategies deterministically without invoking callable provider or tool properties", () => {
  let effectPortCalls = 0;
  const evaluator = new EpisodeEvaluator();
  const input = episodeTrace();
  const strategiesWithTraps = input.strategies.map((strategy) => ({
    ...strategy,
    invokeProvider: () => { effectPortCalls += 1; },
    executeTool: () => { effectPortCalls += 1; },
  }));
  const forward = evaluator.compareStrategies(evaluator.recordTrace({ ...input, strategies: strategiesWithTraps }));
  const reversed = evaluator.compareStrategies(evaluator.recordTrace({ ...input, strategies: [...strategiesWithTraps].reverse() }));

  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward.strategies.map(({ id, rank }) => ({ id, rank })), [
    { id: "strategy:model-safe", rank: 1 },
    { id: "strategy:model-fast", rank: 2 },
  ]);
  assert.equal(forward.recommendedStrategyId, "strategy:model-safe");
  assert.deepEqual(forward.correlation, input.correlation);
  assert.equal(forward.semanticEffectsIssued, false);
  assert.equal(forward.externalEffectsIssued, false);
  assert.equal(forward.source, "RECORDED_OBSERVATIONS_AND_DECISIONS_ONLY");
  assert.equal(effectPortCalls, 0);
});

test("injects controlled recorded-stage failures that explicitly change simulated acceptance", () => {
  const evaluator = new EpisodeEvaluator();
  const trace = evaluator.recordTrace(episodeTrace());
  const kinds = [
    "PROVIDER_LOSS",
    "BUDGET_EXHAUSTION",
    "VERIFICATION_FAILURE",
    "RECONCILIATION_UNCERTAINTY",
  ] as const;
  const results = kinds.map((kind) => evaluator.simulateFailure(trace, {
    id: `failure-injection:${kind.toLowerCase()}`,
    kind,
  }));

  assert.deepEqual(results.map((result) => result.simulatedAcceptance), [
    "REJECTED",
    "REJECTED",
    "REJECTED",
    "REVIEW_REQUIRED",
  ]);
  assert.equal(results.every((result) => result.baselineAcceptance === "ACCEPTED"), true);
  assert.equal(results.every((result) => result.simulatedAcceptance !== result.baselineAcceptance), true);
  assert.equal(results.every((result) => result.semanticEffectsIssued === false), true);
  assert.equal(results.every((result) => result.externalEffectsIssued === false), true);
  assert.equal(results.every((result) => JSON.stringify(result.correlation) === JSON.stringify(trace.correlation)), true);
  assert.deepEqual(results.map((result) => result.stage), ["PROVIDER", "BUDGET", "VERIFICATION", "RECONCILIATION"]);
  assert.deepEqual(results.map((result) => result.reasonCode), [
    "PROVIDER_UNAVAILABLE",
    "BUDGET_EXHAUSTED",
    "VERIFICATION_FAILED",
    "RECONCILIATION_UNCERTAIN",
  ]);
  assert.equal(results.every((result) => result.affectedRecordedIds.length > 0), true);
});

test("keeps a failing package uncertified with inspectable conformance evidence and failure results", () => {
  const evaluator = new EpisodeEvaluator();
  const trace = evaluator.recordTrace(episodeTrace());
  const failureInjectionResults = [
    "PROVIDER_LOSS",
    "BUDGET_EXHAUSTION",
    "VERIFICATION_FAILURE",
    "RECONCILIATION_UNCERTAINTY",
  ].map((kind, index) => evaluator.simulateFailure(trace, {
    id: `failure-injection:certification-${index + 1}`,
    kind: kind as "PROVIDER_LOSS" | "BUDGET_EXHAUSTION" | "VERIFICATION_FAILURE" | "RECONCILIATION_UNCERTAINTY",
  }));

  const certification = evaluator.certifyPackage({
    id: "package-certification:repair-app-1",
    packageId: "application-package:repair-app",
    packageVersion: "1.2.0",
    traceIds: [trace.id],
    conformanceCases: [
      {
        id: "conformance-case:replay-safe",
        title: "Replay issues no world effects",
        status: "PASSED",
        evidenceIds: ["evaluation-evidence:replay-test"],
      },
      {
        id: "conformance-case:permission-isolation",
        title: "Cross-workspace permission isolation",
        status: "FAILED",
        evidenceIds: ["evaluation-evidence:permission-failure"],
      },
    ],
    failureInjectionResults,
    minimumScore: 0.8,
    evaluatedAt: "2026-08-22T12:30:00Z",
  });

  assert.equal(certification.decision, "NOT_CERTIFIED");
  assert.equal(certification.productionReadyClaim, false);
  assert.deepEqual(certification.score, {
    passedConformanceCases: 1,
    totalConformanceCases: 2,
    safeFailureInjections: 4,
    totalFailureInjections: 4,
    value: 5 / 6,
    minimumRequired: 0.8,
  });
  assert.deepEqual(certification.evidenceIds, [
    "evaluation-evidence:permission-failure",
    "evaluation-evidence:replay-test",
  ]);
  assert.deepEqual(certification.failureInjectionResults, failureInjectionResults);
  assert.equal(certification.limitations.length > 0, true);
  assert.equal(Object.isFrozen(certification), true);
});

function episodeTrace(): EpisodeEvaluationTraceInput {
  const correlation = {
    traceId: "trace:episode-18",
    workspaceId: "workspace:one",
    workInstanceId: "work-instance:incident-18",
    workEpisodeId: "work-episode:repair-18",
  };
  return {
    id: "episode-evaluation-trace:repair-18",
    correlation,
    references: {
      principalIds: ["principal:agent-one"],
      providerIds: ["provider:model-one", "provider:verifier-one"],
      procedureIds: ["procedure:repair"],
      workloadIds: ["workload:repair-18"],
      applicationInstanceIds: ["application-instance:repair"],
      harnessSelection: {
        id: "harness-selection:repair-18",
        candidateIds: ["candidate:model-fast", "candidate:model-safe"],
        selectedCandidateId: "candidate:model-safe",
      },
      expectedEffects: [
        { id: "expected-effect:repair-state", effectClass: "SEMANTIC" },
        { id: "expected-effect:ticket-update", effectClass: "EXTERNAL" },
      ],
      observedEffects: [
        { id: "observed-effect:repair-state", expectedEffectId: "expected-effect:repair-state", status: "OBSERVED" },
        { id: "observed-effect:ticket-update", expectedEffectId: "expected-effect:ticket-update", status: "OBSERVED" },
      ],
      reconciliations: [
        { id: "reconciliation:repair-state", expectedEffectId: "expected-effect:repair-state", status: "CONFIRMED" },
        { id: "reconciliation:ticket-update", expectedEffectId: "expected-effect:ticket-update", status: "CONFIRMED" },
      ],
      verifications: [{ id: "verification-result:repair-18", status: "VERIFIED", evidenceIds: ["evidence:repair-18"] }],
      acceptedOutcome: { id: "accepted-outcome:repair-18", status: "ACCEPTED" },
      semanticCommitId: "semantic-commit:repair-18",
    },
    usage: [
      {
        id: "usage:model-one",
        ...correlation,
        principalId: "principal:agent-one",
        providerId: "provider:model-one",
        procedureId: "procedure:repair",
        workloadId: "workload:repair-18",
        applicationInstanceId: "application-instance:repair",
        durationMs: 120,
        inputUnits: 300,
        outputUnits: 80,
        cost: { amount: 2, currency: "USD" },
      },
      {
        id: "usage:verifier-one",
        ...correlation,
        principalId: "principal:agent-one",
        providerId: "provider:verifier-one",
        procedureId: "procedure:repair",
        workloadId: "workload:repair-18",
        applicationInstanceId: "application-instance:repair",
        durationMs: 40,
        inputUnits: 50,
        outputUnits: 10,
        cost: { amount: 1, currency: "USD" },
      },
    ],
    observations: [
      { id: "evaluation-observation:provider", stage: "PROVIDER", status: "SUCCEEDED", detail: "provider result recorded" },
      { id: "evaluation-observation:verification", stage: "VERIFICATION", status: "VERIFIED", detail: "verification recorded" },
    ],
    decisions: [
      { id: "evaluation-decision:harness", stage: "HARNESS", outcome: "SELECTED", observationIds: ["evaluation-observation:provider"] },
      { id: "evaluation-decision:acceptance", stage: "ACCEPTANCE", outcome: "ACCEPTED", observationIds: ["evaluation-observation:verification"] },
    ],
    strategies: [
      {
        id: "strategy:model-fast",
        decisionIds: ["evaluation-decision:harness"],
        observationIds: ["evaluation-observation:provider"],
        simulatedAcceptance: "REVIEW_REQUIRED",
        score: 0.7,
        cost: { amount: 2, currency: "USD" },
      },
      {
        id: "strategy:model-safe",
        decisionIds: ["evaluation-decision:harness", "evaluation-decision:acceptance"],
        observationIds: ["evaluation-observation:provider", "evaluation-observation:verification"],
        simulatedAcceptance: "ACCEPTED",
        score: 0.9,
        cost: { amount: 3, currency: "USD" },
      },
    ],
    recordedAt: "2026-08-22T12:00:00Z",
  };
}
