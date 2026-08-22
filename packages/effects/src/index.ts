export interface ExecutionCorrelation {
  readonly workspaceId: string;
  readonly workInstanceId: string;
  readonly workEpisodeId: string;
  readonly traceId: string;
}

export interface ActionIntent {
  readonly id: string;
  readonly kind: "ACTION_INTENT";
  readonly correlation: ExecutionCorrelation;
  readonly principalId: string;
  readonly objective: string;
}

export interface RuntimeExpectedEffect {
  readonly id: string;
  readonly effectClass: "RUNTIME";
  readonly description: string;
  readonly runtimeEffectLeaseId: string;
  readonly runtimeCleanupOnly: true;
}

export interface SemanticExpectedEffect {
  readonly id: string;
  readonly effectClass: "SEMANTIC";
  readonly description: string;
  readonly changeSetId: string;
}

export interface ExternalExpectedEffect {
  readonly id: string;
  readonly effectClass: "EXTERNAL";
  readonly description: string;
  readonly idempotencyKey: string;
  readonly reconciliationRequired: true;
  readonly correction: "COMPENSATION_OR_REPAIR";
}

export type ExpectedEffect = RuntimeExpectedEffect | SemanticExpectedEffect | ExternalExpectedEffect;

export interface EffectPlan {
  readonly id: string;
  readonly kind: "EFFECT_PLAN";
  readonly actionIntentId: string;
  readonly correlation: ExecutionCorrelation;
  readonly effects: readonly ExpectedEffect[];
}

export type ControlDecisionKind = "AUTHORITY" | "POLICY" | "BUDGET" | "RISK";

export interface ControlDecision {
  readonly id: string;
  readonly kind: ControlDecisionKind;
  readonly status: "ALLOWED" | "DENIED";
  readonly reason: string;
}

export interface VerificationContract {
  readonly id: string;
  readonly kind: "VERIFICATION_CONTRACT";
  readonly requiredEvidenceIds: readonly string[];
  readonly independentVerifierRequired: boolean;
  readonly budget: { readonly maximumCost: number; readonly currency: string };
  readonly maximumAttempts: number;
  readonly stopCondition: "VERIFIED";
}

export interface ExecutionManifest {
  readonly id: string;
  readonly kind: "EXECUTION_MANIFEST";
  readonly correlation: ExecutionCorrelation;
  readonly actionIntent: ActionIntent;
  readonly effectPlan: EffectPlan;
  readonly decisions: {
    readonly authority: ControlDecision & { readonly kind: "AUTHORITY" };
    readonly policy: ControlDecision & { readonly kind: "POLICY" };
    readonly budget: ControlDecision & { readonly kind: "BUDGET" };
    readonly risk: ControlDecision & { readonly kind: "RISK" };
  };
  readonly verificationContract: VerificationContract;
  readonly status: "AUTHORIZED" | "BLOCKED";
  readonly transactionTime: { readonly from: string };
}

export interface ExecutionReceipt {
  readonly id: string;
  readonly kind: "EXECUTION_RECEIPT";
  readonly manifestId: string;
  readonly correlation: ExecutionCorrelation;
  readonly providerId: string;
  readonly transportStatus?: number;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly transactionTime: { readonly from: string };
}

export interface ObservedEffect {
  readonly id: string;
  readonly kind: "OBSERVED_EFFECT";
  readonly manifestId: string;
  readonly expectedEffectId: string;
  readonly effectClass: ExpectedEffect["effectClass"];
  readonly correlation: ExecutionCorrelation;
  readonly providerId: string;
  readonly observation: string;
  readonly transactionTime: { readonly from: string };
}

export type ReconciliationStatus = "CONFIRMED" | "DIVERGED" | "UNCERTAIN";
export type ReconciliationStrategy = "IN_PROCESS" | "CANONICAL_READ" | "IMMEDIATE_REREAD" | "EVENTUAL_OBSERVATION" | "WEBHOOK" | "HUMAN_CONFIRMATION";

export interface EffectReconciliation {
  readonly id: string;
  readonly kind: "EFFECT_RECONCILIATION";
  readonly manifestId: string;
  readonly expectedEffectId: string;
  readonly observedEffectId: string;
  readonly correlation: ExecutionCorrelation;
  readonly status: ReconciliationStatus;
  readonly strategy: ReconciliationStrategy;
  readonly reason: string;
  readonly reviewRequired: boolean;
  readonly transactionTime: { readonly from: string };
}

export interface ExecutionEvidenceReference {
  readonly id: string;
  readonly kind: "EXECUTION_EVIDENCE_REFERENCE";
  readonly manifestId: string;
  readonly correlation: ExecutionCorrelation;
  readonly source: string;
  readonly transactionTime: { readonly from: string };
}

export interface IndependentVerificationResult {
  readonly id: string;
  readonly kind: "INDEPENDENT_VERIFICATION_RESULT";
  readonly manifestId: string;
  readonly correlation: ExecutionCorrelation;
  readonly verifierId: string;
  readonly status: "VERIFIED" | "REJECTED" | "INCONCLUSIVE";
  readonly independentFromProvider: boolean;
  readonly evidenceIds: readonly string[];
  readonly attempt: number;
  readonly cost: { readonly amount: number; readonly currency: string };
  readonly stopConditionMet: boolean;
  readonly transactionTime: { readonly from: string };
}

export interface CompensatingAction {
  readonly id: string;
  readonly kind: "COMPENSATING_ACTION";
  readonly manifestId: string;
  readonly expectedExternalEffectId: string;
  readonly correlation: ExecutionCorrelation;
  readonly reason: string;
  readonly transactionTime: { readonly from: string };
}

export interface AcceptanceOutcome {
  readonly id: string;
  readonly kind: "ACCEPTANCE_OUTCOME";
  readonly acceptanceDecisionId: string;
  readonly manifestId: string;
  readonly correlation: ExecutionCorrelation;
  readonly status: "ACCEPTED" | "REJECTED";
  readonly reasons: readonly string[];
  readonly reviewRequired: boolean;
  readonly acceptedByPrincipalId: string;
  readonly verificationResultId?: string;
  readonly transactionTime: { readonly from: string };
}

export interface VerifiedSemanticCommit {
  readonly id: string;
  readonly kind: "VERIFIED_SEMANTIC_COMMIT";
  readonly manifestId: string;
  readonly correlation: ExecutionCorrelation;
  readonly actionIntentId: string;
  readonly acceptanceOutcomeId: string;
  readonly verificationResultId: string;
  readonly evidenceIds: readonly string[];
  readonly semanticEffectIds: readonly string[];
  readonly transactionTime: { readonly from: string };
}

export type ExecutionJournalEntryKind =
  | "ACTION_INTENT_RECORDED"
  | "EFFECT_PLAN_RECORDED"
  | "MANIFEST_CREATED"
  | "EXECUTION_RECEIPT_RECORDED"
  | "EFFECT_OBSERVED"
  | "EFFECT_RECONCILED"
  | "EVIDENCE_ATTACHED"
  | "VERIFICATION_RECORDED"
  | "COMPENSATION_RECORDED"
  | "OUTCOME_REJECTED"
  | "OUTCOME_ACCEPTED"
  | "SEMANTIC_COMMITTED";

export interface ExecutionJournalEntry {
  readonly id: string;
  readonly kind: ExecutionJournalEntryKind;
  readonly sequence: number;
  readonly manifestId: string;
  readonly recordId: string;
  readonly correlation: ExecutionCorrelation;
  readonly transactionTime: { readonly from: string };
}

export interface GovernedExecutionSnapshot {
  readonly correlation: ExecutionCorrelation;
  readonly actionIntent: ActionIntent;
  readonly effectPlan: EffectPlan;
  readonly manifest: ExecutionManifest;
  readonly receipt?: ExecutionReceipt;
  readonly observedEffects: readonly ObservedEffect[];
  readonly reconciliations: readonly EffectReconciliation[];
  readonly evidence: readonly ExecutionEvidenceReference[];
  readonly verifications: readonly IndependentVerificationResult[];
  readonly compensations: readonly CompensatingAction[];
  readonly outcomes: readonly AcceptanceOutcome[];
  readonly semanticCommits: readonly VerifiedSemanticCommit[];
  readonly journal: readonly ExecutionJournalEntry[];
}

export interface AcceptanceResult {
  readonly outcome: AcceptanceOutcome;
  readonly semanticCommit?: VerifiedSemanticCommit;
}

interface ExecutionAggregate {
  readonly manifest: ExecutionManifest;
  receipt?: ExecutionReceipt;
  readonly observedEffects: ObservedEffect[];
  readonly reconciliations: EffectReconciliation[];
  readonly evidence: ExecutionEvidenceReference[];
  readonly verifications: IndependentVerificationResult[];
  readonly compensations: CompensatingAction[];
  readonly outcomes: AcceptanceOutcome[];
  readonly semanticCommits: VerifiedSemanticCommit[];
  readonly journal: ExecutionJournalEntry[];
}

export class GovernedExecutionEngine {
  readonly #executions = new Map<string, ExecutionAggregate>();

  createManifest(input: {
    readonly id: string;
    readonly actionIntent: {
      readonly id: string;
      readonly correlation: ExecutionCorrelation;
      readonly principalId: string;
      readonly objective: string;
    };
    readonly effectPlan: { readonly id: string; readonly effects: readonly ExpectedEffect[] };
    readonly decisions: {
      readonly authority: ControlDecision;
      readonly policy: ControlDecision;
      readonly budget: ControlDecision;
      readonly risk: ControlDecision;
    };
    readonly verificationContract: Omit<VerificationContract, "kind">;
    readonly recordedAt: string;
  }): ExecutionManifest {
    const rawDecisions = input.decisions as Partial<typeof input.decisions>;
    for (const key of ["authority", "policy", "budget", "risk"] as const) {
      if (rawDecisions[key] === undefined) throw new Error(`${key} decision is required`);
    }
    const correlation = normalizeCorrelation(input.actionIntent.correlation);
    const actionIntent = deepFreeze({
      id: prefixed("action intent id", input.actionIntent.id, "action-intent:"),
      kind: "ACTION_INTENT" as const,
      correlation,
      principalId: prefixed("action principal id", input.actionIntent.principalId, "principal:"),
      objective: requiredText("action objective", input.actionIntent.objective),
    });
    const effects = normalizeEffects(input.effectPlan.effects);
    const effectPlan = deepFreeze({
      id: prefixed("effect plan id", input.effectPlan.id, "effect-plan:"),
      kind: "EFFECT_PLAN" as const,
      actionIntentId: actionIntent.id,
      correlation,
      effects,
    });
    const decisions = deepFreeze({
      authority: normalizeDecision(input.decisions.authority, "AUTHORITY"),
      policy: normalizeDecision(input.decisions.policy, "POLICY"),
      budget: normalizeDecision(input.decisions.budget, "BUDGET"),
      risk: normalizeDecision(input.decisions.risk, "RISK"),
    });
    const verificationContract = normalizeVerificationContract(input.verificationContract);
    const recordedAt = normalizeInstant(input.recordedAt);
    const manifest = deepFreeze({
      id: prefixed("execution manifest id", input.id, "execution-manifest:"),
      kind: "EXECUTION_MANIFEST" as const,
      correlation,
      actionIntent,
      effectPlan,
      decisions,
      verificationContract,
      status: Object.values(decisions).every((decision) => decision.status === "ALLOWED") ? ("AUTHORIZED" as const) : ("BLOCKED" as const),
      transactionTime: { from: recordedAt },
    });
    if (this.#executions.has(manifest.id)) throw new Error(`execution manifest already exists: ${manifest.id}`);
    const aggregate: ExecutionAggregate = {
      manifest,
      observedEffects: [], reconciliations: [], evidence: [], verifications: [], compensations: [], outcomes: [], semanticCommits: [], journal: [],
    };
    this.#executions.set(manifest.id, aggregate);
    this.#append(aggregate, "ACTION_INTENT_RECORDED", actionIntent.id, recordedAt);
    this.#append(aggregate, "EFFECT_PLAN_RECORDED", effectPlan.id, recordedAt);
    this.#append(aggregate, "MANIFEST_CREATED", manifest.id, recordedAt);
    return manifest;
  }

  recordReceipt(input: {
    readonly id: string;
    readonly manifestId: string;
    readonly providerId: string;
    readonly transportStatus?: number;
    readonly status: ExecutionReceipt["status"];
    readonly recordedAt: string;
  }): ExecutionReceipt {
    const aggregate = this.#aggregate(input.manifestId);
    if (aggregate.manifest.status !== "AUTHORIZED") throw new Error("blocked manifest cannot execute");
    if (aggregate.receipt !== undefined) throw new Error(`execution receipt already exists: ${aggregate.manifest.id}`);
    if (input.transportStatus !== undefined && (!Number.isSafeInteger(input.transportStatus) || input.transportStatus < 100 || input.transportStatus > 599)) {
      throw new TypeError("transport status must be an HTTP status integer");
    }
    const receipt = deepFreeze({
      id: prefixed("execution receipt id", input.id, "execution-receipt:"),
      kind: "EXECUTION_RECEIPT" as const,
      manifestId: aggregate.manifest.id,
      correlation: aggregate.manifest.correlation,
      providerId: namespaced("execution provider id", input.providerId),
      ...(input.transportStatus === undefined ? {} : { transportStatus: input.transportStatus }),
      status: input.status,
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    aggregate.receipt = receipt;
    this.#append(aggregate, "EXECUTION_RECEIPT_RECORDED", receipt.id, receipt.transactionTime.from);
    return receipt;
  }

  observeEffect(input: {
    readonly id: string;
    readonly manifestId: string;
    readonly expectedEffectId: string;
    readonly effectClass: ExpectedEffect["effectClass"];
    readonly providerId: string;
    readonly observation: string;
    readonly recordedAt: string;
  }): ObservedEffect {
    const aggregate = this.#aggregate(input.manifestId);
    const expected = expectedEffect(aggregate, input.expectedEffectId);
    if (expected.effectClass !== input.effectClass) throw new Error("observed effect class does not match expected effect");
    const observed = deepFreeze({
      id: prefixed("observed effect id", input.id, "observed-effect:"),
      kind: "OBSERVED_EFFECT" as const,
      manifestId: aggregate.manifest.id,
      expectedEffectId: expected.id,
      effectClass: expected.effectClass,
      correlation: aggregate.manifest.correlation,
      providerId: namespaced("effect provider id", input.providerId),
      observation: requiredText("effect observation", input.observation),
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    assertUnique(aggregate.observedEffects, observed.id, "observed effect");
    aggregate.observedEffects.push(observed);
    this.#append(aggregate, "EFFECT_OBSERVED", observed.id, observed.transactionTime.from);
    return observed;
  }

  reconcile(input: {
    readonly id: string;
    readonly manifestId: string;
    readonly expectedEffectId: string;
    readonly observedEffectId: string;
    readonly status: ReconciliationStatus;
    readonly strategy: ReconciliationStrategy;
    readonly reason: string;
    readonly recordedAt: string;
  }): EffectReconciliation {
    const aggregate = this.#aggregate(input.manifestId);
    const expected = expectedEffect(aggregate, input.expectedEffectId);
    const observed = aggregate.observedEffects.find((item) => item.id === input.observedEffectId);
    if (observed === undefined || observed.expectedEffectId !== expected.id) throw new Error("reconciliation observation does not match expected effect");
    const reconciliation = deepFreeze({
      id: prefixed("reconciliation id", input.id, "reconciliation:"),
      kind: "EFFECT_RECONCILIATION" as const,
      manifestId: aggregate.manifest.id,
      expectedEffectId: expected.id,
      observedEffectId: observed.id,
      correlation: aggregate.manifest.correlation,
      status: reconciliationStatus(input.status),
      strategy: reconciliationStrategy(input.strategy),
      reason: requiredText("reconciliation reason", input.reason),
      reviewRequired: input.status === "UNCERTAIN" && expected.effectClass === "EXTERNAL",
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    assertUnique(aggregate.reconciliations, reconciliation.id, "reconciliation");
    aggregate.reconciliations.push(reconciliation);
    this.#append(aggregate, "EFFECT_RECONCILED", reconciliation.id, reconciliation.transactionTime.from);
    return reconciliation;
  }

  attachEvidence(input: {
    readonly id: string;
    readonly manifestId: string;
    readonly source: string;
    readonly recordedAt: string;
  }): ExecutionEvidenceReference {
    const aggregate = this.#aggregate(input.manifestId);
    const evidence = deepFreeze({
      id: prefixed("evidence id", input.id, "evidence:"),
      kind: "EXECUTION_EVIDENCE_REFERENCE" as const,
      manifestId: aggregate.manifest.id,
      correlation: aggregate.manifest.correlation,
      source: requiredText("evidence source", input.source),
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    assertUnique(aggregate.evidence, evidence.id, "evidence");
    aggregate.evidence.push(evidence);
    this.#append(aggregate, "EVIDENCE_ATTACHED", evidence.id, evidence.transactionTime.from);
    return evidence;
  }

  recordVerification(input: {
    readonly id: string;
    readonly manifestId: string;
    readonly verifierId: string;
    readonly status: IndependentVerificationResult["status"];
    readonly independentFromProvider: boolean;
    readonly evidenceIds: readonly string[];
    readonly attempt: number;
    readonly cost: { readonly amount: number; readonly currency: string };
    readonly stopConditionMet: boolean;
    readonly recordedAt: string;
  }): IndependentVerificationResult {
    const aggregate = this.#aggregate(input.manifestId);
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) throw new TypeError("verification attempt must be a positive integer");
    if (!Number.isFinite(input.cost.amount) || input.cost.amount < 0) throw new TypeError("verification cost must be non-negative");
    const verification = deepFreeze({
      id: prefixed("verification result id", input.id, "verification-result:"),
      kind: "INDEPENDENT_VERIFICATION_RESULT" as const,
      manifestId: aggregate.manifest.id,
      correlation: aggregate.manifest.correlation,
      verifierId: namespaced("verifier id", input.verifierId),
      status: input.status,
      independentFromProvider: input.independentFromProvider
        && aggregate.receipt !== undefined
        && aggregate.receipt.providerId !== input.verifierId,
      evidenceIds: unique("verification evidence ids", input.evidenceIds.map((id) => prefixed("verification evidence id", id, "evidence:"))),
      attempt: input.attempt,
      cost: { amount: input.cost.amount, currency: requiredText("verification cost currency", input.cost.currency) },
      stopConditionMet: input.stopConditionMet,
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    assertUnique(aggregate.verifications, verification.id, "verification result");
    aggregate.verifications.push(verification);
    this.#append(aggregate, "VERIFICATION_RECORDED", verification.id, verification.transactionTime.from);
    return verification;
  }

  recordCompensation(input: {
    readonly id: string;
    readonly manifestId: string;
    readonly expectedExternalEffectId: string;
    readonly reason: string;
    readonly recordedAt: string;
  }): CompensatingAction {
    const aggregate = this.#aggregate(input.manifestId);
    const expected = expectedEffect(aggregate, input.expectedExternalEffectId);
    if (expected.effectClass !== "EXTERNAL") throw new Error("compensation is only valid for an external effect");
    const compensation = deepFreeze({
      id: prefixed("compensating action id", input.id, "compensating-action:"),
      kind: "COMPENSATING_ACTION" as const,
      manifestId: aggregate.manifest.id,
      expectedExternalEffectId: expected.id,
      correlation: aggregate.manifest.correlation,
      reason: requiredText("compensation reason", input.reason),
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    assertUnique(aggregate.compensations, compensation.id, "compensating action");
    aggregate.compensations.push(compensation);
    this.#append(aggregate, "COMPENSATION_RECORDED", compensation.id, compensation.transactionTime.from);
    return compensation;
  }

  decide(input: {
    readonly id: string;
    readonly outcomeId: string;
    readonly semanticCommitId: string;
    readonly manifestId: string;
    readonly acceptedByPrincipalId: string;
    readonly recordedAt: string;
  }): AcceptanceResult {
    const aggregate = this.#aggregate(input.manifestId);
    const acceptanceDecisionId = prefixed("acceptance decision id", input.id, "acceptance-decision:");
    const reasons: string[] = [];
    if (aggregate.semanticCommits.length > 0) reasons.push("SEMANTIC_COMMIT_ALREADY_EXISTS");
    let reviewRequired = false;
    if (aggregate.manifest.status !== "AUTHORIZED") reasons.push("MANIFEST_NOT_AUTHORIZED");
    if (aggregate.receipt === undefined || aggregate.receipt.status !== "SUCCEEDED") reasons.push("EXECUTION_NOT_SUCCEEDED");
    for (const effect of aggregate.manifest.effectPlan.effects) {
      const observed = [...aggregate.observedEffects].reverse().find((item) => item.expectedEffectId === effect.id);
      if (observed === undefined) reasons.push(`MISSING_OBSERVATION:${effect.id}`);
      const reconciliation = [...aggregate.reconciliations].reverse().find((item) => item.expectedEffectId === effect.id);
      if (reconciliation === undefined) {
        reasons.push(`MISSING_RECONCILIATION:${effect.id}`);
      } else if (reconciliation.status === "DIVERGED") {
        reasons.push(`DIVERGED_EFFECT:${effect.id}`);
      } else if (reconciliation.status === "UNCERTAIN") {
        if (effect.effectClass === "EXTERNAL") {
          reasons.push(`UNCERTAIN_EXTERNAL_EFFECT:${effect.id}`);
          reviewRequired = true;
        } else {
          reasons.push(`UNCERTAIN_EFFECT:${effect.id}`);
        }
      }
    }
    const evidenceIds = aggregate.evidence.map((item) => item.id);
    for (const requiredId of aggregate.manifest.verificationContract.requiredEvidenceIds) {
      if (!evidenceIds.includes(requiredId)) reasons.push(`MISSING_EVIDENCE:${requiredId}`);
    }
    const verification = selectVerification(aggregate);
    if (verification.result === undefined) reasons.push(...verification.reasons);
    const recordedAt = normalizeInstant(input.recordedAt);
    const accepted = reasons.length === 0 && verification.result !== undefined;
    const outcome = deepFreeze({
      id: prefixed("acceptance outcome id", input.outcomeId, "accepted-outcome:"),
      kind: "ACCEPTANCE_OUTCOME" as const,
      acceptanceDecisionId,
      manifestId: aggregate.manifest.id,
      correlation: aggregate.manifest.correlation,
      status: accepted ? ("ACCEPTED" as const) : ("REJECTED" as const),
      reasons: unique("acceptance reasons", reasons),
      reviewRequired,
      acceptedByPrincipalId: prefixed("accepting principal id", input.acceptedByPrincipalId, "principal:"),
      ...(verification.result === undefined ? {} : { verificationResultId: verification.result.id }),
      transactionTime: { from: recordedAt },
    });
    aggregate.outcomes.push(outcome);
    this.#append(aggregate, accepted ? "OUTCOME_ACCEPTED" : "OUTCOME_REJECTED", outcome.id, recordedAt);
    if (!accepted || verification.result === undefined) return deepFreeze({ outcome });
    const commit = deepFreeze({
      id: prefixed("semantic commit id", input.semanticCommitId, "semantic-commit:"),
      kind: "VERIFIED_SEMANTIC_COMMIT" as const,
      manifestId: aggregate.manifest.id,
      correlation: aggregate.manifest.correlation,
      actionIntentId: aggregate.manifest.actionIntent.id,
      acceptanceOutcomeId: outcome.id,
      verificationResultId: verification.result.id,
      evidenceIds: unique("semantic commit evidence ids", evidenceIds),
      semanticEffectIds: aggregate.manifest.effectPlan.effects.filter((effect) => effect.effectClass === "SEMANTIC").map((effect) => effect.id),
      transactionTime: { from: recordedAt },
    });
    assertUnique(aggregate.semanticCommits, commit.id, "semantic commit");
    aggregate.semanticCommits.push(commit);
    this.#append(aggregate, "SEMANTIC_COMMITTED", commit.id, recordedAt);
    return deepFreeze({ outcome, semanticCommit: commit });
  }

  execution(manifestId: string): GovernedExecutionSnapshot | undefined {
    const id = prefixed("execution manifest id", manifestId, "execution-manifest:");
    const aggregate = this.#executions.get(id);
    if (aggregate === undefined) return undefined;
    return deepFreeze(structuredClone({
      correlation: aggregate.manifest.correlation,
      actionIntent: aggregate.manifest.actionIntent,
      effectPlan: aggregate.manifest.effectPlan,
      manifest: aggregate.manifest,
      ...(aggregate.receipt === undefined ? {} : { receipt: aggregate.receipt }),
      observedEffects: aggregate.observedEffects,
      reconciliations: aggregate.reconciliations,
      evidence: aggregate.evidence,
      verifications: aggregate.verifications,
      compensations: aggregate.compensations,
      outcomes: aggregate.outcomes,
      semanticCommits: aggregate.semanticCommits,
      journal: aggregate.journal,
    }));
  }

  #aggregate(manifestId: string): ExecutionAggregate {
    const id = prefixed("execution manifest id", manifestId, "execution-manifest:");
    const aggregate = this.#executions.get(id);
    if (aggregate === undefined) throw new Error(`execution manifest does not exist: ${id}`);
    return aggregate;
  }

  #append(aggregate: ExecutionAggregate, kind: ExecutionJournalEntryKind, recordId: string, recordedAt: string): void {
    const sequence = aggregate.journal.length + 1;
    aggregate.journal.push(deepFreeze({
      id: `execution-journal-entry:${encodeURIComponent(aggregate.manifest.id)}:${sequence}`,
      kind,
      sequence,
      manifestId: aggregate.manifest.id,
      recordId,
      correlation: aggregate.manifest.correlation,
      transactionTime: { from: normalizeInstant(recordedAt) },
    }));
  }
}

function selectVerification(aggregate: ExecutionAggregate): { readonly result?: IndependentVerificationResult; readonly reasons: readonly string[] } {
  const contract = aggregate.manifest.verificationContract;
  const required = new Set(contract.requiredEvidenceIds);
  const reasons = new Set<string>();
  const cumulativeCost = aggregate.verifications
    .filter((result) => result.cost.currency === contract.budget.currency)
    .reduce((total, result) => total + result.cost.amount, 0);
  if (cumulativeCost > contract.budget.maximumCost) return { reasons: ["VERIFICATION_BUDGET_EXCEEDED"] };
  for (const result of [...aggregate.verifications].reverse()) {
    if (result.status !== "VERIFIED") { reasons.add("VERIFICATION_NOT_PASSED"); continue; }
    if (contract.independentVerifierRequired && !result.independentFromProvider) { reasons.add("INDEPENDENT_VERIFICATION_REQUIRED"); continue; }
    if (result.attempt > contract.maximumAttempts) { reasons.add("VERIFICATION_ATTEMPT_LIMIT_EXCEEDED"); continue; }
    if (result.cost.currency !== contract.budget.currency || result.cost.amount > contract.budget.maximumCost) { reasons.add("VERIFICATION_BUDGET_EXCEEDED"); continue; }
    if (!result.stopConditionMet) { reasons.add("STOP_CONDITION_NOT_MET"); continue; }
    if (![...required].every((id) => result.evidenceIds.includes(id))) { reasons.add("VERIFICATION_EVIDENCE_INCOMPLETE"); continue; }
    return { result, reasons: [] };
  }
  return { reasons: aggregate.verifications.length === 0 ? ["MISSING_VERIFICATION"] : [...reasons].sort() };
}

function expectedEffect(aggregate: ExecutionAggregate, id: string): ExpectedEffect {
  const normalized = prefixed("expected effect id", id, "expected-effect:");
  const effect = aggregate.manifest.effectPlan.effects.find((item) => item.id === normalized);
  if (effect === undefined) throw new Error(`expected effect does not exist: ${normalized}`);
  return effect;
}

function normalizeEffects(effects: readonly ExpectedEffect[]): readonly ExpectedEffect[] {
  const ids = new Set<string>();
  return deepFreeze(effects.map((effect) => {
    const id = prefixed("expected effect id", effect.id, "expected-effect:");
    if (ids.has(id)) throw new Error(`duplicate expected effect: ${id}`);
    ids.add(id);
    const description = requiredText("expected effect description", effect.description);
    const raw = effect as unknown as Readonly<Record<string, unknown>>;
    if (effect.effectClass === "RUNTIME") {
      if (raw.changeSetId !== undefined || raw.idempotencyKey !== undefined || raw.correction !== undefined) throw new Error("runtime effect cannot declare semantic or external effect fields");
      if (effect.runtimeCleanupOnly !== true) throw new Error("runtime disposer is cleanup only");
      return { id, effectClass: "RUNTIME" as const, description, runtimeEffectLeaseId: prefixed("runtime effect lease id", effect.runtimeEffectLeaseId, "runtime-effect-lease:"), runtimeCleanupOnly: true as const };
    }
    if (effect.effectClass === "SEMANTIC") {
      if (raw.runtimeEffectLeaseId !== undefined || raw.idempotencyKey !== undefined || raw.correction !== undefined) throw new Error("semantic effect cannot declare runtime or external effect fields");
      return { id, effectClass: "SEMANTIC" as const, description, changeSetId: prefixed("change set id", effect.changeSetId, "change-set:") };
    }
    if (raw.runtimeEffectLeaseId !== undefined || raw.changeSetId !== undefined) throw new Error("external effect cannot declare runtime or semantic effect fields");
    if (effect.reconciliationRequired !== true || effect.correction !== "COMPENSATION_OR_REPAIR") throw new Error("external effect requires reconciliation and compensation-or-repair semantics");
    return { id, effectClass: "EXTERNAL" as const, description, idempotencyKey: requiredText("external effect idempotency key", effect.idempotencyKey), reconciliationRequired: true as const, correction: "COMPENSATION_OR_REPAIR" as const };
  }));
}

function normalizeDecision<Kind extends ControlDecisionKind>(decision: ControlDecision, kind: Kind): ControlDecision & { readonly kind: Kind } {
  if (decision.kind !== kind) throw new Error(`${kind.toLowerCase()} decision kind mismatch`);
  return deepFreeze({ id: prefixed("control decision id", decision.id, "decision:"), kind, status: decision.status, reason: requiredText("control decision reason", decision.reason) });
}

function normalizeVerificationContract(input: Omit<VerificationContract, "kind">): VerificationContract {
  if (!Number.isFinite(input.budget.maximumCost) || input.budget.maximumCost < 0) throw new TypeError("verification maximum cost must be non-negative");
  if (!Number.isSafeInteger(input.maximumAttempts) || input.maximumAttempts < 1) throw new TypeError("verification maximum attempts must be positive");
  if (input.stopCondition !== "VERIFIED") throw new TypeError("unsupported verification stop condition");
  return deepFreeze({
    id: prefixed("verification contract id", input.id, "verification-contract:"),
    kind: "VERIFICATION_CONTRACT" as const,
    requiredEvidenceIds: unique("required evidence ids", input.requiredEvidenceIds.map((id) => prefixed("required evidence id", id, "evidence:"))),
    independentVerifierRequired: input.independentVerifierRequired,
    budget: { maximumCost: input.budget.maximumCost, currency: requiredText("verification budget currency", input.budget.currency) },
    maximumAttempts: input.maximumAttempts,
    stopCondition: input.stopCondition,
  });
}

function reconciliationStatus(value: ReconciliationStatus): ReconciliationStatus {
  if (!["CONFIRMED", "DIVERGED", "UNCERTAIN"].includes(value)) throw new TypeError(`unsupported reconciliation status: ${value}`);
  return value;
}

function reconciliationStrategy(value: ReconciliationStrategy): ReconciliationStrategy {
  if (!["IN_PROCESS", "CANONICAL_READ", "IMMEDIATE_REREAD", "EVENTUAL_OBSERVATION", "WEBHOOK", "HUMAN_CONFIRMATION"].includes(value)) {
    throw new TypeError(`unsupported reconciliation strategy: ${value}`);
  }
  return value;
}

function normalizeCorrelation(value: ExecutionCorrelation): ExecutionCorrelation {
  return deepFreeze({
    workspaceId: prefixed("workspace id", value.workspaceId, "workspace:"),
    workInstanceId: prefixed("work instance id", value.workInstanceId, "work-instance:"),
    workEpisodeId: prefixed("work episode id", value.workEpisodeId, "work-episode:"),
    traceId: prefixed("trace id", value.traceId, "trace:"),
  });
}

function assertUnique(values: readonly { readonly id: string }[], id: string, name: string): void {
  if (values.some((value) => value.id === id)) throw new Error(`${name} already exists: ${id}`);
}

function unique(name: string, values: readonly string[]): readonly string[] {
  const normalized = values.map((value) => requiredText(name, value));
  return [...new Set(normalized)].sort();
}

function prefixed(name: string, value: string, prefix: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${name} must start with ${prefix}`);
  return normalized;
}

function namespaced(name: string, value: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.includes(":")) throw new TypeError(`${name} must be namespace-qualified`);
  return normalized;
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`);
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return instant.toISOString();
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
