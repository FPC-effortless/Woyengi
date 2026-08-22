export type EvaluationEffectClass = "RUNTIME" | "SEMANTIC" | "EXTERNAL";
export type EvaluationStage = "HARNESS" | "PROVIDER" | "BUDGET" | "RECONCILIATION" | "VERIFICATION" | "ACCEPTANCE";
export type SimulatedAcceptance = "ACCEPTED" | "REJECTED" | "REVIEW_REQUIRED";

export interface EpisodeTraceCorrelation {
  readonly traceId: string;
  readonly workspaceId: string;
  readonly workInstanceId: string;
  readonly workEpisodeId: string;
}

export interface MonetaryCost {
  readonly amount: number;
  readonly currency: string;
}

export interface HarnessSelectionReference {
  readonly id: string;
  readonly candidateIds: readonly string[];
  readonly selectedCandidateId: string;
}

export interface ExpectedEffectReference {
  readonly id: string;
  readonly effectClass: EvaluationEffectClass;
}

export interface ObservedEffectReference {
  readonly id: string;
  readonly expectedEffectId: string;
  readonly status: "OBSERVED" | "FAILED" | "UNKNOWN";
}

export interface ReconciliationReference {
  readonly id: string;
  readonly expectedEffectId: string;
  readonly status: "CONFIRMED" | "DIVERGED" | "UNCERTAIN";
}

export interface VerificationReference {
  readonly id: string;
  readonly status: "VERIFIED" | "REJECTED" | "INCONCLUSIVE";
  readonly evidenceIds: readonly string[];
}

export interface AcceptedOutcomeReference {
  readonly id: string;
  readonly status: SimulatedAcceptance;
}

export interface EpisodeEvaluationReferences {
  readonly principalIds: readonly string[];
  readonly providerIds: readonly string[];
  readonly procedureIds: readonly string[];
  readonly workloadIds: readonly string[];
  readonly applicationInstanceIds: readonly string[];
  readonly harnessSelection: HarnessSelectionReference;
  readonly expectedEffects: readonly ExpectedEffectReference[];
  readonly observedEffects: readonly ObservedEffectReference[];
  readonly reconciliations: readonly ReconciliationReference[];
  readonly verifications: readonly VerificationReference[];
  readonly acceptedOutcome: AcceptedOutcomeReference;
  readonly semanticCommitId?: string;
}

export interface EpisodeUsageAttribution extends EpisodeTraceCorrelation {
  readonly id: string;
  readonly principalId: string;
  readonly providerId: string;
  readonly procedureId: string;
  readonly workloadId: string;
  readonly applicationInstanceId: string;
  readonly durationMs: number;
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly cost: MonetaryCost;
}

export interface RecordedEvaluationObservation {
  readonly id: string;
  readonly stage: EvaluationStage;
  readonly status: string;
  readonly detail: string;
}

export interface RecordedEvaluationDecision {
  readonly id: string;
  readonly stage: EvaluationStage;
  readonly outcome: string;
  readonly observationIds: readonly string[];
}

export interface RecordedCounterfactualStrategy {
  readonly id: string;
  readonly decisionIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly simulatedAcceptance: SimulatedAcceptance;
  readonly score: number;
  readonly cost: MonetaryCost;
}

export interface EpisodeEvaluationTraceInput {
  readonly id: string;
  readonly correlation: EpisodeTraceCorrelation;
  readonly references: EpisodeEvaluationReferences;
  readonly usage: readonly EpisodeUsageAttribution[];
  readonly observations: readonly RecordedEvaluationObservation[];
  readonly decisions: readonly RecordedEvaluationDecision[];
  readonly strategies: readonly RecordedCounterfactualStrategy[];
  readonly recordedAt: string;
}

export interface EpisodeEvaluationTrace extends EpisodeEvaluationTraceInput {
  readonly contract: "woyengi.episode-evaluation-trace.v1";
}

export interface AttributedCostEntry {
  readonly id: string;
  readonly cost: MonetaryCost;
}

export interface EpisodeCostAttribution {
  readonly total: MonetaryCost;
  readonly byPrincipal: readonly AttributedCostEntry[];
  readonly byProvider: readonly AttributedCostEntry[];
  readonly byProcedure: readonly AttributedCostEntry[];
  readonly byWorkload: readonly AttributedCostEntry[];
  readonly byApplication: readonly AttributedCostEntry[];
}

export interface EpisodeReplayResult {
  readonly contract: "woyengi.episode-replay.v1";
  readonly traceId: string;
  readonly correlation: EpisodeTraceCorrelation;
  readonly references: EpisodeEvaluationReferences;
  readonly cost: EpisodeCostAttribution;
  readonly acceptanceStatus: SimulatedAcceptance;
  readonly semanticCommitId?: string;
  readonly semanticEffectsIssued: false;
  readonly externalEffectsIssued: false;
  readonly source: "RECORDED_ONLY";
}

export interface CounterfactualStrategyResult extends RecordedCounterfactualStrategy {
  readonly rank: number;
}

export interface StrategyComparisonResult {
  readonly contract: "woyengi.recorded-strategy-comparison.v1";
  readonly traceId: string;
  readonly correlation: EpisodeTraceCorrelation;
  readonly strategies: readonly CounterfactualStrategyResult[];
  readonly recommendedStrategyId: string;
  readonly semanticEffectsIssued: false;
  readonly externalEffectsIssued: false;
  readonly source: "RECORDED_OBSERVATIONS_AND_DECISIONS_ONLY";
}

export type FailureInjectionKind =
  | "PROVIDER_LOSS"
  | "BUDGET_EXHAUSTION"
  | "VERIFICATION_FAILURE"
  | "RECONCILIATION_UNCERTAINTY";

export interface ControlledFailureInjection {
  readonly id: string;
  readonly kind: FailureInjectionKind;
}

export interface FailureInjectionResult {
  readonly contract: "woyengi.failure-injection-result.v1";
  readonly id: string;
  readonly traceId: string;
  readonly correlation: EpisodeTraceCorrelation;
  readonly injectionId: string;
  readonly kind: FailureInjectionKind;
  readonly stage: EvaluationStage;
  readonly reasonCode: "PROVIDER_UNAVAILABLE" | "BUDGET_EXHAUSTED" | "VERIFICATION_FAILED" | "RECONCILIATION_UNCERTAIN";
  readonly affectedRecordedIds: readonly string[];
  readonly baselineAcceptance: SimulatedAcceptance;
  readonly simulatedAcceptance: "REJECTED" | "REVIEW_REQUIRED";
  readonly controlStatus: "SAFE_REJECTION" | "HUMAN_REVIEW_REQUIRED";
  readonly semanticEffectsIssued: false;
  readonly externalEffectsIssued: false;
  readonly source: "SIMULATED_FROM_RECORDED_TRACE";
}

export interface PackageConformanceCaseResult {
  readonly id: string;
  readonly title: string;
  readonly status: "PASSED" | "FAILED";
  readonly evidenceIds: readonly string[];
}

export interface PackageCertificationInput {
  readonly id: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly traceIds: readonly string[];
  readonly conformanceCases: readonly PackageConformanceCaseResult[];
  readonly failureInjectionResults: readonly FailureInjectionResult[];
  readonly minimumScore: number;
  readonly evaluatedAt: string;
}

export interface PackageCertificationScore {
  readonly passedConformanceCases: number;
  readonly totalConformanceCases: number;
  readonly safeFailureInjections: number;
  readonly totalFailureInjections: number;
  readonly value: number;
  readonly minimumRequired: number;
}

export interface PackageCertificationResult {
  readonly contract: "woyengi.package-certification.v1";
  readonly id: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly traceIds: readonly string[];
  readonly conformanceCases: readonly PackageConformanceCaseResult[];
  readonly evidenceIds: readonly string[];
  readonly failureInjectionResults: readonly FailureInjectionResult[];
  readonly score: PackageCertificationScore;
  readonly decision: "CERTIFIED_FOR_EVALUATED_SCOPE" | "NOT_CERTIFIED";
  readonly productionReadyClaim: false;
  readonly limitations: readonly string[];
  readonly evaluatedAt: string;
}

const EFFECT_CLASSES: readonly EvaluationEffectClass[] = Object.freeze(["RUNTIME", "SEMANTIC", "EXTERNAL"]);
const STAGES: readonly EvaluationStage[] = Object.freeze(["HARNESS", "PROVIDER", "BUDGET", "RECONCILIATION", "VERIFICATION", "ACCEPTANCE"]);
const ACCEPTANCE_VALUES: readonly SimulatedAcceptance[] = Object.freeze(["ACCEPTED", "REJECTED", "REVIEW_REQUIRED"]);

export class EpisodeEvaluator {
  recordTrace(input: EpisodeEvaluationTraceInput): EpisodeEvaluationTrace {
    const correlation = normalizeCorrelation(input.correlation);
    const references = normalizeReferences(input.references);
    const usage = input.usage.map((entry) => normalizeUsage(entry, correlation, references));
    if (usage.length === 0) throw new TypeError("episode evaluation trace requires at least one usage attribution");
    assertUnique("usage attribution", usage.map((entry) => entry.id));
    const currency = sameCurrency(usage.map((entry) => entry.cost), "episode usage cost");
    const observations = input.observations.map(normalizeObservation);
    assertUnique("evaluation observation", observations.map((entry) => entry.id));
    const observationIds = new Set(observations.map((entry) => entry.id));
    const decisions = input.decisions.map((entry) => normalizeDecision(entry, observationIds));
    assertUnique("evaluation decision", decisions.map((entry) => entry.id));
    const decisionIds = new Set(decisions.map((entry) => entry.id));
    const strategies = input.strategies.map((entry) => normalizeStrategy(entry, decisionIds, observationIds, currency));
    assertUnique("counterfactual strategy", strategies.map((entry) => entry.id));
    return deepFreeze({
      contract: "woyengi.episode-evaluation-trace.v1" as const,
      id: prefixed("episode evaluation trace id", input.id, "episode-evaluation-trace:"),
      correlation,
      references,
      usage,
      observations,
      decisions,
      strategies,
      recordedAt: normalizeInstant(input.recordedAt),
    });
  }

  replay(input: EpisodeEvaluationTrace): EpisodeReplayResult {
    const trace = this.recordTrace(input);
    return deepFreeze({
      contract: "woyengi.episode-replay.v1" as const,
      traceId: trace.id,
      correlation: trace.correlation,
      references: trace.references,
      cost: aggregateCost(trace.usage),
      acceptanceStatus: trace.references.acceptedOutcome.status,
      ...(trace.references.semanticCommitId === undefined ? {} : { semanticCommitId: trace.references.semanticCommitId }),
      semanticEffectsIssued: false as const,
      externalEffectsIssued: false as const,
      source: "RECORDED_ONLY" as const,
    });
  }

  compareStrategies(input: EpisodeEvaluationTrace): StrategyComparisonResult {
    const trace = this.recordTrace(input);
    if (trace.strategies.length === 0) throw new Error("strategy comparison requires at least one recorded strategy");
    const ordered = [...trace.strategies].sort(compareRecordedStrategies);
    const strategies = ordered.map((strategy, index) => deepFreeze({ ...strategy, rank: index + 1 }));
    return deepFreeze({
      contract: "woyengi.recorded-strategy-comparison.v1" as const,
      traceId: trace.id,
      correlation: trace.correlation,
      strategies,
      recommendedStrategyId: strategies[0]!.id,
      semanticEffectsIssued: false as const,
      externalEffectsIssued: false as const,
      source: "RECORDED_OBSERVATIONS_AND_DECISIONS_ONLY" as const,
    });
  }

  simulateFailure(input: EpisodeEvaluationTrace, injection: ControlledFailureInjection): FailureInjectionResult {
    const trace = this.recordTrace(input);
    const injectionId = prefixed("failure injection id", injection.id, "failure-injection:");
    const specification = failureSpecification(trace, failureInjectionKind(injection.kind));
    if (specification.affectedRecordedIds.length === 0) {
      throw new Error(`failure injection has no recorded stage evidence: ${injection.kind}`);
    }
    return deepFreeze({
      contract: "woyengi.failure-injection-result.v1" as const,
      id: `simulated-outcome:${injectionId.slice("failure-injection:".length)}`,
      traceId: trace.id,
      correlation: trace.correlation,
      injectionId,
      kind: injection.kind,
      stage: specification.stage,
      reasonCode: specification.reasonCode,
      affectedRecordedIds: specification.affectedRecordedIds,
      baselineAcceptance: trace.references.acceptedOutcome.status,
      simulatedAcceptance: specification.simulatedAcceptance,
      controlStatus: specification.simulatedAcceptance === "REJECTED" ? ("SAFE_REJECTION" as const) : ("HUMAN_REVIEW_REQUIRED" as const),
      semanticEffectsIssued: false as const,
      externalEffectsIssued: false as const,
      source: "SIMULATED_FROM_RECORDED_TRACE" as const,
    });
  }

  certifyPackage(input: PackageCertificationInput): PackageCertificationResult {
    const traceIds = uniqueSorted("certification traces", input.traceIds, (value) => prefixed("episode evaluation trace id", value, "episode-evaluation-trace:"));
    const conformanceCases = input.conformanceCases.map((entry) => {
      if (entry.status !== "PASSED" && entry.status !== "FAILED") throw new TypeError(`invalid conformance status: ${entry.status}`);
      return deepFreeze({
        id: prefixed("conformance case id", entry.id, "conformance-case:"),
        title: requiredText("conformance case title", entry.title),
        status: entry.status,
        evidenceIds: uniqueSorted("conformance evidence", entry.evidenceIds, (value) => prefixed("evaluation evidence id", value, "evaluation-evidence:")),
      });
    });
    if (conformanceCases.length === 0) throw new TypeError("package certification requires conformance cases");
    assertUnique("conformance case", conformanceCases.map((entry) => entry.id));
    if (input.failureInjectionResults.length === 0) throw new TypeError("package certification requires failure injection results");
    const failureInjectionResults = input.failureInjectionResults.map((result) => normalizeFailureResult(result, traceIds));
    assertUnique("failure injection result", failureInjectionResults.map((result) => result.id));
    const passedConformanceCases = conformanceCases.filter((entry) => entry.status === "PASSED").length;
    const safeFailureInjections = failureInjectionResults.filter(isSafeFailureResult).length;
    const totalChecks = conformanceCases.length + failureInjectionResults.length;
    const minimumRequired = unitInterval("minimum certification score", input.minimumScore);
    const score = deepFreeze({
      passedConformanceCases,
      totalConformanceCases: conformanceCases.length,
      safeFailureInjections,
      totalFailureInjections: failureInjectionResults.length,
      value: (passedConformanceCases + safeFailureInjections) / totalChecks,
      minimumRequired,
    });
    const certified = passedConformanceCases === conformanceCases.length
      && safeFailureInjections === failureInjectionResults.length
      && score.value >= score.minimumRequired;
    return deepFreeze({
      contract: "woyengi.package-certification.v1" as const,
      id: prefixed("package certification id", input.id, "package-certification:"),
      packageId: prefixed("application package id", input.packageId, "application-package:"),
      packageVersion: semanticVersion(input.packageVersion),
      traceIds,
      conformanceCases,
      evidenceIds: [...new Set(conformanceCases.flatMap((entry) => entry.evidenceIds))].sort(),
      failureInjectionResults,
      score,
      decision: certified ? ("CERTIFIED_FOR_EVALUATED_SCOPE" as const) : ("NOT_CERTIFIED" as const),
      productionReadyClaim: false as const,
      limitations: [
        "Certification is limited to the supplied recorded traces and conformance evidence.",
        "Certification is not a production-readiness claim.",
      ],
      evaluatedAt: normalizeInstant(input.evaluatedAt),
    });
  }
}

function normalizeFailureResult(result: FailureInjectionResult, traceIds: readonly string[]): FailureInjectionResult {
  if (result.contract !== "woyengi.failure-injection-result.v1") throw new TypeError("invalid failure injection result contract");
  if (!traceIds.includes(result.traceId)) throw new Error(`failure injection result references unevaluated trace: ${result.traceId}`);
  if (result.semanticEffectsIssued !== false || result.externalEffectsIssued !== false) {
    throw new Error(`failure injection result issued effects: ${result.id}`);
  }
  if (result.source !== "SIMULATED_FROM_RECORDED_TRACE") throw new Error(`failure injection result has non-recorded source: ${result.id}`);
  return deepFreeze(structuredClone(result));
}

function isSafeFailureResult(result: FailureInjectionResult): boolean {
  return (result.simulatedAcceptance === "REJECTED" || result.simulatedAcceptance === "REVIEW_REQUIRED")
    && result.semanticEffectsIssued === false
    && result.externalEffectsIssued === false;
}

function failureSpecification(trace: EpisodeEvaluationTrace, kind: FailureInjectionKind): {
  readonly stage: EvaluationStage;
  readonly reasonCode: FailureInjectionResult["reasonCode"];
  readonly affectedRecordedIds: readonly string[];
  readonly simulatedAcceptance: FailureInjectionResult["simulatedAcceptance"];
} {
  if (kind === "PROVIDER_LOSS") {
    return {
      stage: "PROVIDER",
      reasonCode: "PROVIDER_UNAVAILABLE",
      affectedRecordedIds: trace.references.providerIds,
      simulatedAcceptance: "REJECTED",
    };
  }
  if (kind === "BUDGET_EXHAUSTION") {
    return {
      stage: "BUDGET",
      reasonCode: "BUDGET_EXHAUSTED",
      affectedRecordedIds: trace.usage.map((entry) => entry.id),
      simulatedAcceptance: "REJECTED",
    };
  }
  if (kind === "VERIFICATION_FAILURE") {
    return {
      stage: "VERIFICATION",
      reasonCode: "VERIFICATION_FAILED",
      affectedRecordedIds: trace.references.verifications.map((entry) => entry.id),
      simulatedAcceptance: "REJECTED",
    };
  }
  return {
    stage: "RECONCILIATION",
    reasonCode: "RECONCILIATION_UNCERTAIN",
    affectedRecordedIds: trace.references.reconciliations.map((entry) => entry.id),
    simulatedAcceptance: "REVIEW_REQUIRED",
  };
}

function failureInjectionKind(value: FailureInjectionKind): FailureInjectionKind {
  if (
    value !== "PROVIDER_LOSS" &&
    value !== "BUDGET_EXHAUSTION" &&
    value !== "VERIFICATION_FAILURE" &&
    value !== "RECONCILIATION_UNCERTAINTY"
  ) {
    throw new TypeError(`invalid failure injection kind: ${value}`);
  }
  return value;
}

function compareRecordedStrategies(left: RecordedCounterfactualStrategy, right: RecordedCounterfactualStrategy): number {
  return acceptanceRank(right.simulatedAcceptance) - acceptanceRank(left.simulatedAcceptance)
    || right.score - left.score
    || left.cost.amount - right.cost.amount
    || left.id.localeCompare(right.id);
}

function acceptanceRank(value: SimulatedAcceptance): number {
  if (value === "ACCEPTED") return 3;
  if (value === "REVIEW_REQUIRED") return 2;
  return 1;
}

function normalizeCorrelation(input: EpisodeTraceCorrelation): EpisodeTraceCorrelation {
  return deepFreeze({
    traceId: prefixed("trace id", input.traceId, "trace:"),
    workspaceId: prefixed("workspace id", input.workspaceId, "workspace:"),
    workInstanceId: prefixed("work instance id", input.workInstanceId, "work-instance:"),
    workEpisodeId: prefixed("work episode id", input.workEpisodeId, "work-episode:"),
  });
}

function normalizeReferences(input: EpisodeEvaluationReferences): EpisodeEvaluationReferences {
  const expectedEffects = input.expectedEffects.map((effect) => deepFreeze({
    id: prefixed("expected effect id", effect.id, "expected-effect:"),
    effectClass: oneOf("effect class", effect.effectClass, EFFECT_CLASSES),
  }));
  assertUnique("expected effect", expectedEffects.map((effect) => effect.id));
  const expectedIds = new Set(expectedEffects.map((effect) => effect.id));
  const observedEffects = input.observedEffects.map((effect) => {
    const expectedEffectId = prefixed("observed expected effect id", effect.expectedEffectId, "expected-effect:");
    if (!expectedIds.has(expectedEffectId)) throw new Error(`observed effect references unknown expected effect: ${expectedEffectId}`);
    if (effect.status !== "OBSERVED" && effect.status !== "FAILED" && effect.status !== "UNKNOWN") {
      throw new TypeError(`invalid observed effect status: ${effect.status}`);
    }
    return deepFreeze({ id: prefixed("observed effect id", effect.id, "observed-effect:"), expectedEffectId, status: effect.status });
  });
  assertUnique("observed effect", observedEffects.map((effect) => effect.id));
  const reconciliations = input.reconciliations.map((entry) => {
    const expectedEffectId = prefixed("reconciliation expected effect id", entry.expectedEffectId, "expected-effect:");
    if (!expectedIds.has(expectedEffectId)) throw new Error(`reconciliation references unknown expected effect: ${expectedEffectId}`);
    if (entry.status !== "CONFIRMED" && entry.status !== "DIVERGED" && entry.status !== "UNCERTAIN") {
      throw new TypeError(`invalid reconciliation status: ${entry.status}`);
    }
    return deepFreeze({ id: prefixed("reconciliation id", entry.id, "reconciliation:"), expectedEffectId, status: entry.status });
  });
  assertUnique("reconciliation", reconciliations.map((entry) => entry.id));
  const verifications = input.verifications.map((entry) => {
    if (entry.status !== "VERIFIED" && entry.status !== "REJECTED" && entry.status !== "INCONCLUSIVE") {
      throw new TypeError(`invalid verification status: ${entry.status}`);
    }
    return deepFreeze({
      id: prefixed("verification result id", entry.id, "verification-result:"),
      status: entry.status,
      evidenceIds: uniqueSorted("verification evidence", entry.evidenceIds, (value) => prefixed("evidence id", value, "evidence:")),
    });
  });
  assertUnique("verification result", verifications.map((entry) => entry.id));
  const candidateIds = uniqueSorted("harness candidates", input.harnessSelection.candidateIds, (value) => prefixed("harness candidate id", value, "candidate:"));
  const selectedCandidateId = prefixed("selected harness candidate id", input.harnessSelection.selectedCandidateId, "candidate:");
  if (!candidateIds.includes(selectedCandidateId)) throw new Error("selected harness candidate is not in the candidate set");
  const acceptedStatus = acceptance(input.acceptedOutcome.status);
  const semanticCommitId = input.semanticCommitId === undefined ? undefined : prefixed("semantic commit id", input.semanticCommitId, "semantic-commit:");
  if (acceptedStatus === "ACCEPTED" && semanticCommitId === undefined) throw new Error("accepted evaluation trace requires a semantic commit reference");
  if (acceptedStatus !== "ACCEPTED" && semanticCommitId !== undefined) throw new Error("unaccepted evaluation trace cannot reference a semantic commit");
  return deepFreeze({
    principalIds: uniqueSorted("principal references", input.principalIds, (value) => prefixed("principal id", value, "principal:")),
    providerIds: uniqueSorted("provider references", input.providerIds, (value) => prefixed("provider id", value, "provider:")),
    procedureIds: uniqueSorted("procedure references", input.procedureIds, (value) => prefixed("procedure id", value, "procedure:")),
    workloadIds: uniqueSorted("workload references", input.workloadIds, (value) => prefixed("workload id", value, "workload:")),
    applicationInstanceIds: uniqueSorted("application instance references", input.applicationInstanceIds, (value) => prefixed("application instance id", value, "application-instance:")),
    harnessSelection: {
      id: prefixed("harness selection id", input.harnessSelection.id, "harness-selection:"),
      candidateIds,
      selectedCandidateId,
    },
    expectedEffects,
    observedEffects,
    reconciliations,
    verifications,
    acceptedOutcome: {
      id: prefixed("accepted outcome id", input.acceptedOutcome.id, "accepted-outcome:"),
      status: acceptedStatus,
    },
    ...(semanticCommitId === undefined ? {} : { semanticCommitId }),
  });
}

function normalizeUsage(
  input: EpisodeUsageAttribution,
  correlation: EpisodeTraceCorrelation,
  references: EpisodeEvaluationReferences,
): EpisodeUsageAttribution {
  const entry = deepFreeze({
    id: prefixed("usage attribution id", input.id, "usage:"),
    ...normalizeCorrelation(input),
    principalId: prefixed("usage principal id", input.principalId, "principal:"),
    providerId: prefixed("usage provider id", input.providerId, "provider:"),
    procedureId: prefixed("usage procedure id", input.procedureId, "procedure:"),
    workloadId: prefixed("usage workload id", input.workloadId, "workload:"),
    applicationInstanceId: prefixed("usage application instance id", input.applicationInstanceId, "application-instance:"),
    durationMs: nonNegative("usage durationMs", input.durationMs),
    inputUnits: nonNegative("usage inputUnits", input.inputUnits),
    outputUnits: nonNegative("usage outputUnits", input.outputUnits),
    cost: normalizeCost(input.cost),
  });
  if (stableStringify(normalizeCorrelation(entry)) !== stableStringify(correlation)) throw new Error(`usage correlation mismatch: ${entry.id}`);
  assertReferenced("principal", entry.principalId, references.principalIds);
  assertReferenced("provider", entry.providerId, references.providerIds);
  assertReferenced("procedure", entry.procedureId, references.procedureIds);
  assertReferenced("workload", entry.workloadId, references.workloadIds);
  assertReferenced("application instance", entry.applicationInstanceId, references.applicationInstanceIds);
  return entry;
}

function normalizeObservation(input: RecordedEvaluationObservation): RecordedEvaluationObservation {
  return deepFreeze({
    id: prefixed("evaluation observation id", input.id, "evaluation-observation:"),
    stage: oneOf("evaluation stage", input.stage, STAGES),
    status: requiredText("evaluation observation status", input.status),
    detail: requiredText("evaluation observation detail", input.detail),
  });
}

function normalizeDecision(input: RecordedEvaluationDecision, observationIds: ReadonlySet<string>): RecordedEvaluationDecision {
  const ids = uniqueSorted("decision observations", input.observationIds, (value) => prefixed("evaluation observation id", value, "evaluation-observation:"));
  for (const id of ids) if (!observationIds.has(id)) throw new Error(`evaluation decision references unknown observation: ${id}`);
  return deepFreeze({
    id: prefixed("evaluation decision id", input.id, "evaluation-decision:"),
    stage: oneOf("evaluation stage", input.stage, STAGES),
    outcome: requiredText("evaluation decision outcome", input.outcome),
    observationIds: ids,
  });
}

function normalizeStrategy(
  input: RecordedCounterfactualStrategy,
  decisionIds: ReadonlySet<string>,
  observationIds: ReadonlySet<string>,
  currency: string,
): RecordedCounterfactualStrategy {
  const decisions = uniqueSorted("strategy decisions", input.decisionIds, (value) => prefixed("evaluation decision id", value, "evaluation-decision:"));
  const observations = uniqueSorted("strategy observations", input.observationIds, (value) => prefixed("evaluation observation id", value, "evaluation-observation:"));
  for (const id of decisions) if (!decisionIds.has(id)) throw new Error(`strategy references unknown decision: ${id}`);
  for (const id of observations) if (!observationIds.has(id)) throw new Error(`strategy references unknown observation: ${id}`);
  const cost = normalizeCost(input.cost);
  if (cost.currency !== currency) throw new Error(`ambiguous strategy cost currency: ${currency}, ${cost.currency}`);
  return deepFreeze({
    id: prefixed("strategy id", input.id, "strategy:"),
    decisionIds: decisions,
    observationIds: observations,
    simulatedAcceptance: acceptance(input.simulatedAcceptance),
    score: unitInterval("strategy score", input.score),
    cost,
  });
}

function aggregateCost(usage: readonly EpisodeUsageAttribution[]): EpisodeCostAttribution {
  const currency = sameCurrency(usage.map((entry) => entry.cost), "episode usage cost");
  return deepFreeze({
    total: { amount: sum(usage.map((entry) => entry.cost.amount)), currency },
    byPrincipal: aggregateDimension(usage, "principalId", currency),
    byProvider: aggregateDimension(usage, "providerId", currency),
    byProcedure: aggregateDimension(usage, "procedureId", currency),
    byWorkload: aggregateDimension(usage, "workloadId", currency),
    byApplication: aggregateDimension(usage, "applicationInstanceId", currency),
  });
}

function aggregateDimension(
  usage: readonly EpisodeUsageAttribution[],
  key: "principalId" | "providerId" | "procedureId" | "workloadId" | "applicationInstanceId",
  currency: string,
): readonly AttributedCostEntry[] {
  const totals = new Map<string, number>();
  for (const entry of usage) totals.set(entry[key], (totals.get(entry[key]) ?? 0) + entry.cost.amount);
  return [...totals].sort(([left], [right]) => left.localeCompare(right)).map(([id, amount]) => deepFreeze({ id, cost: { amount, currency } }));
}

function sameCurrency(costs: readonly MonetaryCost[], name: string): string {
  const currencies = [...new Set(costs.map((cost) => cost.currency))].sort();
  if (currencies.length !== 1) throw new Error(`${name} has ambiguous currency: ${currencies.join(", ")}`);
  return currencies[0] as string;
}

function normalizeCost(input: MonetaryCost): MonetaryCost {
  const currency = requiredText("cost currency", input.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError(`cost currency must be a three-letter code: ${currency}`);
  return deepFreeze({ amount: nonNegative("cost amount", input.amount), currency });
}

function acceptance(value: SimulatedAcceptance): SimulatedAcceptance {
  return oneOf("acceptance status", value, ACCEPTANCE_VALUES);
}

function oneOf<Value extends string>(name: string, value: Value, allowed: readonly Value[]): Value {
  if (!allowed.includes(value)) throw new TypeError(`invalid ${name}: ${value}`);
  return value;
}

function assertReferenced(name: string, id: string, values: readonly string[]): void {
  if (!values.includes(id)) throw new Error(`usage ${name} is not present in trace references: ${id}`);
}

function assertUnique(name: string, ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error(`duplicate ${name} id`);
}

function uniqueSorted(name: string, values: readonly string[], normalize: (value: string) => string): readonly string[] {
  const normalized = [...new Set(values.map(normalize))].sort();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return Object.freeze(normalized);
}

function prefixed(name: string, value: string, prefix: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${name} must start with ${prefix}`);
  return normalized;
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function semanticVersion(value: string): string {
  const normalized = requiredText("semantic version", value);
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) throw new TypeError(`version must use major.minor.patch: ${normalized}`);
  return normalized;
}

function nonNegative(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be non-negative and finite`);
  return value;
}

function unitInterval(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`${name} must be between 0 and 1`);
  return value;
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`);
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return instant.toISOString();
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
