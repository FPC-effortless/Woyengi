import type { WorkEpisodeId, WorkInstanceId } from "../../work/src/index.ts";
import type { PrincipalId, WorkspaceId } from "../../workspace/src/index.ts";

export type HarnessCandidateKind = "SKILL" | "PROCEDURE" | "MODEL" | "AGENT" | "TOOL" | "PROVIDER";

export interface CandidateExecutionEstimate {
  readonly cost: { readonly amount: number; readonly currency: string };
  readonly durationMs: number;
  readonly tokens: number;
}

export interface HarnessCandidateDefinitionBase<Kind extends HarnessCandidateKind> {
  readonly id: string;
  readonly kind: Kind;
  readonly version: string;
  readonly relevance: number;
  readonly jurisdictions: readonly string[];
  readonly requiredProviderIds: readonly string[];
  readonly defaultBindings: Readonly<Record<string, string>>;
  readonly bindingRequirements: Readonly<Record<string, readonly string[]>>;
  readonly estimatedBudget: CandidateExecutionEstimate;
  readonly estimatedRisk: number;
}

export type SkillCandidateDefinition = HarnessCandidateDefinitionBase<"SKILL">;
export type ProcedureCandidateDefinition = HarnessCandidateDefinitionBase<"PROCEDURE">;
export type ModelCandidateDefinition = HarnessCandidateDefinitionBase<"MODEL">;
export type AgentCandidateDefinition = HarnessCandidateDefinitionBase<"AGENT">;
export type ToolCandidateDefinition = HarnessCandidateDefinitionBase<"TOOL">;
export type ProviderCandidateDefinition = HarnessCandidateDefinitionBase<"PROVIDER">;

export type HarnessCandidateDefinition =
  | SkillCandidateDefinition
  | ProcedureCandidateDefinition
  | ModelCandidateDefinition
  | AgentCandidateDefinition
  | ToolCandidateDefinition
  | ProviderCandidateDefinition;

export interface RequestedExecutionBudget {
  readonly maxCost: { readonly amount: number; readonly currency: string };
  readonly maxDurationMs: number;
  readonly maxTokens: number;
}

export interface HarnessRequest {
  readonly traceId: string;
  readonly principalId: PrincipalId;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly purpose: string;
  readonly jurisdiction: string;
  readonly availableProviderIds: readonly string[];
  readonly bindings: {
    readonly app: Readonly<Record<string, string>>;
    readonly work: Readonly<Record<string, string>>;
    readonly overrides: Readonly<Record<string, string>>;
    readonly requiredKeys: readonly string[];
  };
  readonly executionBudget: RequestedExecutionBudget;
  readonly maxRisk: number;
  readonly conditions: Readonly<Record<string, string>>;
}

export interface MemoryApplicabilityDecision {
  readonly applicable: boolean;
  readonly score: number;
  readonly knownFailureMemoryIds: readonly string[];
  readonly rationale: string;
}

export type HarnessGateDecision =
  | { readonly allowed: true; readonly score: number; readonly rationale: string }
  | { readonly allowed: false; readonly rationale: string };

export interface HarnessPorts {
  readonly evaluateMemoryApplicability?: (input: {
    readonly request: HarnessRequest;
    readonly candidate: HarnessCandidateDefinition;
    readonly effectiveBindings: Readonly<Record<string, string>>;
  }) => MemoryApplicabilityDecision | Promise<MemoryApplicabilityDecision>;
  readonly evaluateAuthority?: (input: {
    readonly request: HarnessRequest;
    readonly candidate: HarnessCandidateDefinition;
    readonly effectiveBindings: Readonly<Record<string, string>>;
  }) => HarnessGateDecision | Promise<HarnessGateDecision>;
  readonly evaluateBudget?: (input: {
    readonly request: HarnessRequest;
    readonly candidate: HarnessCandidateDefinition;
  }) => HarnessGateDecision | Promise<HarnessGateDecision>;
  readonly evaluateRisk?: (input: {
    readonly request: HarnessRequest;
    readonly candidate: HarnessCandidateDefinition;
    readonly effectiveBindings: Readonly<Record<string, string>>;
  }) => HarnessGateDecision | Promise<HarnessGateDecision>;
}

export interface ApplicabilityEvaluation {
  readonly kind: "applicability-evaluation";
  readonly candidate: HarnessCandidateDefinition;
  readonly decision: "APPLICABLE" | "REJECTED";
  readonly reasons: readonly string[];
  readonly effectiveBindings: Readonly<Record<string, string>>;
  readonly score: {
    readonly relevance: number;
    readonly memoryApplicability: number;
    readonly authority: number;
    readonly budgetEfficiency: number;
    readonly riskFitness: number;
    readonly total: number;
  };
  readonly memory: {
    readonly applicable: boolean;
    readonly rationale: string;
    readonly knownFailureMemoryIds: readonly string[];
  };
  readonly authority: { readonly allowed: boolean; readonly rationale: string };
  readonly budget: {
    readonly allowed: boolean;
    readonly rationale: string;
    readonly requested: RequestedExecutionBudget;
    readonly estimated: CandidateExecutionEstimate;
  };
  readonly risk: {
    readonly allowed: boolean;
    readonly rationale: string;
    readonly requestedMaximum: number;
    readonly estimated: number;
  };
}

export interface HarnessSelectionResult {
  readonly kind: "harness-selection";
  readonly traceId: string;
  readonly selected?: ApplicabilityEvaluation;
  readonly rejectedAlternatives: readonly ApplicabilityEvaluation[];
  readonly eligibleAlternatives: readonly ApplicabilityEvaluation[];
  readonly effectiveBindings: Readonly<Record<string, string>>;
  readonly requestedBudget: RequestedExecutionBudget;
  readonly authorityRationale: string;
  readonly budgetRationale: string;
}

export class Harness {
  readonly #ports: HarnessPorts;

  constructor(ports: HarnessPorts) {
    this.#ports = ports;
  }

  async select(
    input: HarnessRequest,
    definitions: readonly HarnessCandidateDefinition[],
  ): Promise<HarnessSelectionResult> {
    const request = normalizeRequest(input);
    const candidates = uniqueCandidates(definitions.map(defineHarnessCandidate));
    const evaluations: ApplicabilityEvaluation[] = [];
    for (const candidate of candidates) {
      evaluations.push(await this.#evaluate(request, candidate));
    }
    const applicable = evaluations.filter(({ decision }) => decision === "APPLICABLE").sort(compareApplicable);
    const selected = applicable[0];
    const rejectedAlternatives = evaluations
      .filter(({ decision }) => decision === "REJECTED")
      .sort((left, right) => left.candidate.id.localeCompare(right.candidate.id));
    const eligibleAlternatives = applicable.slice(1);
    return deepFreeze({
      kind: "harness-selection" as const,
      traceId: request.traceId,
      ...(selected === undefined ? {} : { selected }),
      rejectedAlternatives,
      eligibleAlternatives,
      effectiveBindings: selected?.effectiveBindings ?? {},
      requestedBudget: request.executionBudget,
      authorityRationale: selected?.authority.rationale ?? "No applicable candidate was authorized.",
      budgetRationale: selected?.budget.rationale ?? "No applicable candidate fit the requested execution budget.",
    });
  }

  async #evaluate(
    request: HarnessRequest,
    candidate: HarnessCandidateDefinition,
  ): Promise<ApplicabilityEvaluation> {
    const effectiveBindings = sortedRecord({
      ...candidate.defaultBindings,
      ...request.bindings.app,
      ...request.bindings.work,
      ...request.bindings.overrides,
    });
    const reasons = structuralReasons(candidate, request, effectiveBindings);
    const memory = await evaluateMemory(this.#ports.evaluateMemoryApplicability, request, candidate, effectiveBindings);
    if (!memory.applicable) reasons.push(memory.reason);
    const authority = await evaluateGate(
      this.#ports.evaluateAuthority,
      "authority",
      { request, candidate, effectiveBindings },
    );
    if (!authority.allowed) reasons.push(authority.reason);
    const budgetHardReasons = budgetReasons(candidate.estimatedBudget, request.executionBudget);
    reasons.push(...budgetHardReasons);
    const budget = await evaluateGate(this.#ports.evaluateBudget, "budget", { request, candidate });
    if (!budget.allowed) reasons.push(budget.reason);
    if (candidate.estimatedRisk > request.maxRisk) reasons.push("risk-exceeds-requested-maximum");
    const risk = await evaluateGate(
      this.#ports.evaluateRisk,
      "risk",
      { request, candidate, effectiveBindings },
    );
    if (!risk.allowed) reasons.push(risk.reason);
    const score = {
      relevance: candidate.relevance,
      memoryApplicability: memory.score,
      authority: authority.score,
      budgetEfficiency: budget.score,
      riskFitness: risk.score,
      total: round(
        candidate.relevance * 0.35 +
          memory.score * 0.25 +
          authority.score * 0.2 +
          budget.score * 0.1 +
          risk.score * 0.1,
      ),
    };
    const uniqueReasons = [...new Set(reasons)].sort();
    return deepFreeze({
      kind: "applicability-evaluation" as const,
      candidate,
      decision: uniqueReasons.length === 0 ? ("APPLICABLE" as const) : ("REJECTED" as const),
      reasons: uniqueReasons,
      effectiveBindings,
      score,
      memory: {
        applicable: memory.applicable,
        rationale: memory.rationale,
        knownFailureMemoryIds: memory.knownFailureMemoryIds,
      },
      authority: { allowed: authority.allowed, rationale: authority.rationale },
      budget: {
        allowed: budget.allowed && budgetHardReasons.length === 0,
        rationale:
          budgetHardReasons.length === 0
            ? budget.rationale
            : `${budget.rationale}; ${budgetHardReasons.join(", ")}`,
        requested: request.executionBudget,
        estimated: candidate.estimatedBudget,
      },
      risk: {
        allowed: risk.allowed && candidate.estimatedRisk <= request.maxRisk,
        rationale:
          candidate.estimatedRisk <= request.maxRisk
            ? risk.rationale
            : `${risk.rationale}; risk-exceeds-requested-maximum`,
        requestedMaximum: request.maxRisk,
        estimated: candidate.estimatedRisk,
      },
    });
  }
}

export function defineHarnessCandidate(input: HarnessCandidateDefinition): HarnessCandidateDefinition {
  const kind = candidateKind(input.kind);
  return deepFreeze({
    id: prefixed("harness candidate id", input.id, candidatePrefix(kind)),
    kind,
    version: semanticVersion(input.version),
    relevance: unitScore("candidate relevance", input.relevance),
    jurisdictions: uniqueRequired("candidate jurisdictions", input.jurisdictions.map(normalizeJurisdiction)),
    requiredProviderIds: unique(
      input.requiredProviderIds.map((id) => prefixed("required provider id", id, "provider:")),
    ),
    defaultBindings: normalizeBindings("candidate default bindings", input.defaultBindings),
    bindingRequirements: normalizeBindingRequirements(input.bindingRequirements),
    estimatedBudget: normalizeEstimate(input.estimatedBudget),
    estimatedRisk: unitScore("candidate estimated risk", input.estimatedRisk),
  }) as HarnessCandidateDefinition;
}

function normalizeRequest(input: HarnessRequest): HarnessRequest {
  return deepFreeze({
    traceId: prefixed("trace id", input.traceId, "trace:"),
    principalId: prefixed("principal id", input.principalId, "principal:") as PrincipalId,
    workspaceId: prefixed("workspace id", input.workspaceId, "workspace:") as WorkspaceId,
    workInstanceId: prefixed("work instance id", input.workInstanceId, "work-instance:") as WorkInstanceId,
    workEpisodeId: prefixed("work episode id", input.workEpisodeId, "work-episode:") as WorkEpisodeId,
    purpose: requiredText("harness purpose", input.purpose),
    jurisdiction: normalizeJurisdiction(input.jurisdiction),
    availableProviderIds: unique(
      input.availableProviderIds.map((id) => prefixed("available provider id", id, "provider:")),
    ),
    bindings: {
      app: normalizeBindings("App bindings", input.bindings.app),
      work: normalizeBindings("Work bindings", input.bindings.work),
      overrides: normalizeBindings("binding overrides", input.bindings.overrides),
      requiredKeys: uniqueRequired(
        "required binding keys",
        input.bindings.requiredKeys.map((key) => requiredText("required binding key", key)),
      ),
    },
    executionBudget: normalizeRequestedBudget(input.executionBudget),
    maxRisk: unitScore("maximum execution risk", input.maxRisk),
    conditions: normalizeBindings("harness conditions", input.conditions),
  });
}

function structuralReasons(
  candidate: HarnessCandidateDefinition,
  request: HarnessRequest,
  effectiveBindings: Readonly<Record<string, string>>,
): string[] {
  const reasons: string[] = [];
  if (!candidate.jurisdictions.includes("*") && !candidate.jurisdictions.includes(request.jurisdiction)) {
    reasons.push(`jurisdiction-not-allowed:${request.jurisdiction}`);
  }
  for (const providerId of candidate.requiredProviderIds) {
    if (!request.availableProviderIds.includes(providerId)) reasons.push(`missing-provider:${providerId}`);
  }
  for (const key of request.bindings.requiredKeys) {
    if (effectiveBindings[key] === undefined) reasons.push(`missing-binding:${key}`);
  }
  for (const [key, allowed] of Object.entries(candidate.bindingRequirements)) {
    const value = effectiveBindings[key];
    if (value === undefined) reasons.push(`missing-binding:${key}`);
    else if (!allowed.includes(value)) reasons.push(`binding-incompatible:${key}=${value}`);
  }
  return reasons;
}

async function evaluateMemory(
  evaluator: HarnessPorts["evaluateMemoryApplicability"],
  request: HarnessRequest,
  candidate: HarnessCandidateDefinition,
  effectiveBindings: Readonly<Record<string, string>>,
): Promise<{
  readonly applicable: boolean;
  readonly score: number;
  readonly rationale: string;
  readonly knownFailureMemoryIds: readonly string[];
  readonly reason: string;
}> {
  if (evaluator === undefined) {
    return {
      applicable: false,
      score: 0,
      rationale: "No memory applicability evaluator configured.",
      knownFailureMemoryIds: [],
      reason: "missing-memory-applicability-evaluator",
    };
  }
  try {
    const decision = await evaluator({ request, candidate, effectiveBindings });
    const rationale = decisionRationale(decision?.rationale, "Memory applicability denied without rationale.");
    const score = unitScore("memory applicability score", decision?.score ?? Number.NaN);
    const knownFailureMemoryIds = unique(
      (decision?.knownFailureMemoryIds ?? []).map((id) => prefixed("known failure memory id", id, "memory-record:")),
    );
    return {
      applicable: decision?.applicable === true,
      score,
      rationale,
      knownFailureMemoryIds,
      reason: `memory-inapplicable:${rationale}`,
    };
  } catch {
    return {
      applicable: false,
      score: 0,
      rationale: "Memory applicability evaluator failed.",
      knownFailureMemoryIds: [],
      reason: "memory-applicability-evaluator-failed",
    };
  }
}

async function evaluateGate<Input>(
  evaluator: ((input: Input) => HarnessGateDecision | Promise<HarnessGateDecision>) | undefined,
  gate: "authority" | "budget" | "risk",
  input: Input,
): Promise<{
  readonly allowed: boolean;
  readonly score: number;
  readonly rationale: string;
  readonly reason: string;
}> {
  if (evaluator === undefined) {
    return {
      allowed: false,
      score: 0,
      rationale: `No ${gate} evaluator configured.`,
      reason: `missing-${gate}-evaluator`,
    };
  }
  try {
    const decision = await evaluator(input);
    const rationale = decisionRationale(decision?.rationale, `${gate} denied without rationale.`);
    if (decision?.allowed !== true) {
      return { allowed: false, score: 0, rationale, reason: `${gate}-denied:${rationale}` };
    }
    const score = unitScore(`${gate} score`, decision.score);
    return { allowed: true, score, rationale, reason: "" };
  } catch {
    return {
      allowed: false,
      score: 0,
      rationale: `${gate} evaluator failed.`,
      reason: `${gate}-evaluator-failed`,
    };
  }
}

function budgetReasons(estimate: CandidateExecutionEstimate, requested: RequestedExecutionBudget): string[] {
  const reasons: string[] = [];
  if (estimate.cost.currency !== requested.maxCost.currency) reasons.push("budget-currency-mismatch");
  else if (estimate.cost.amount > requested.maxCost.amount) reasons.push("budget-cost-exceeded");
  if (estimate.durationMs > requested.maxDurationMs) reasons.push("budget-duration-exceeded");
  if (estimate.tokens > requested.maxTokens) reasons.push("budget-token-exceeded");
  return reasons;
}

function normalizeRequestedBudget(input: RequestedExecutionBudget): RequestedExecutionBudget {
  return deepFreeze({
    maxCost: {
      amount: nonNegative("maximum execution cost", input.maxCost.amount),
      currency: currency(input.maxCost.currency),
    },
    maxDurationMs: positiveInteger("maximum execution duration", input.maxDurationMs),
    maxTokens: positiveInteger("maximum execution tokens", input.maxTokens),
  });
}

function normalizeEstimate(input: CandidateExecutionEstimate): CandidateExecutionEstimate {
  return deepFreeze({
    cost: {
      amount: nonNegative("estimated execution cost", input.cost.amount),
      currency: currency(input.cost.currency),
    },
    durationMs: positiveInteger("estimated execution duration", input.durationMs),
    tokens: positiveInteger("estimated execution tokens", input.tokens),
  });
}

function normalizeBindingRequirements(
  input: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> {
  return deepFreeze(
    Object.fromEntries(
      Object.entries(input)
        .map(([key, values]) => [
          requiredText("binding requirement key", key),
          uniqueRequired("binding requirement values", values),
        ] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function normalizeBindings(name: string, input: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return deepFreeze(
    Object.fromEntries(
      Object.entries(input)
        .map(([key, value]) => [requiredText(`${name} key`, key), requiredText(`${name} value`, value)] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function sortedRecord(input: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return deepFreeze(Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right))));
}

function compareApplicable(left: ApplicabilityEvaluation, right: ApplicabilityEvaluation): number {
  return (
    right.score.total - left.score.total ||
    right.score.authority - left.score.authority ||
    right.score.memoryApplicability - left.score.memoryApplicability ||
    right.score.relevance - left.score.relevance ||
    left.candidate.id.localeCompare(right.candidate.id)
  );
}

function uniqueCandidates(input: readonly HarnessCandidateDefinition[]): HarnessCandidateDefinition[] {
  const candidates = [...input].sort((left, right) => left.id.localeCompare(right.id));
  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index - 1]?.id === candidates[index]?.id) {
      throw new Error(`harness candidate appears more than once: ${candidates[index]?.id}`);
    }
  }
  return candidates;
}

function candidateKind(value: string): HarnessCandidateKind {
  if (["SKILL", "PROCEDURE", "MODEL", "AGENT", "TOOL", "PROVIDER"].includes(value)) {
    return value as HarnessCandidateKind;
  }
  throw new TypeError(`unsupported harness candidate kind: ${value}`);
}

function candidatePrefix(kind: HarnessCandidateKind): string {
  return `${kind.toLowerCase()}:`;
}

function semanticVersion(value: string): string {
  const normalized = requiredText("candidate version", value);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new TypeError(`candidate version must use semantic versioning: ${value}`);
  }
  return normalized;
}

function normalizeJurisdiction(value: string): string {
  const normalized = requiredText("jurisdiction", value).toUpperCase();
  if (normalized === "*") return normalized;
  if (!/^[A-Z]{2}(?:-[A-Z0-9]{1,8})?$/.test(normalized)) {
    throw new TypeError(`invalid jurisdiction: ${value}`);
  }
  return normalized;
}

function currency(value: string): string {
  const normalized = requiredText("currency", value).toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new TypeError(`currency must use a three-letter code: ${value}`);
  return normalized;
}

function unique(input: readonly string[]): readonly string[] {
  return deepFreeze([...new Set(input)].sort());
}

function uniqueRequired(name: string, input: readonly string[]): readonly string[] {
  const values = unique(input.map((value) => requiredText(name, value)));
  if (values.length === 0) throw new TypeError(`${name} must not be empty`);
  return values;
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

function decisionRationale(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function nonNegative(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be non-negative`);
  return value;
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function unitScore(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be between 0 and 1`);
  return value;
}

function round(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
