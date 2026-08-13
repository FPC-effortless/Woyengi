import type { RetrievalModality } from "../../search/src/index.ts";
import type { StateValue } from "../../core/src/index.ts";

export interface ResolvedIntent {
  readonly intent: string;
  readonly subjects: readonly string[];
  readonly action?: string;
  readonly domain: string;
  readonly validAt: string;
  readonly recordedAt: string;
  readonly constraints: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly contradictionRequirements: readonly string[];
  readonly graphIds: readonly string[];
  readonly modalities: readonly RetrievalModality[];
  readonly purpose: string;
  readonly normalizedRequest: string;
}

export interface StateRequirementPlan {
  readonly request: string;
  readonly principal: string;
  readonly intent: string;
  readonly subjects: readonly string[];
  readonly action?: string;
  readonly domain: string;
  readonly validAt: string;
  readonly recordedAt: string;
  readonly purpose: string;
  readonly constraints: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly contradictionRequirements: readonly string[];
  readonly requiredState: readonly ("current-state" | "relevant-history" | "evidence" | "contradictions")[];
  readonly graphIds: readonly string[];
  readonly modalities: readonly RetrievalModality[];
  readonly checks: readonly (
    | { readonly kind: "authority"; readonly predicate: string; readonly purpose: string }
    | { readonly kind: "permission"; readonly operation: "RECONSTRUCT"; readonly principal: string; readonly purpose: string }
  )[];
}

export class StateRequirementPlanner {
  readonly #resolveIntent: (input: { readonly request: string; readonly principal: string }) => Promise<ResolvedIntent>;

  constructor(ports: {
    readonly resolveIntent: (input: { readonly request: string; readonly principal: string }) => Promise<ResolvedIntent>;
  }) {
    this.#resolveIntent = ports.resolveIntent;
  }

  async plan(input: { readonly request: string; readonly principal: string }): Promise<StateRequirementPlan> {
    const request = normalizeRequest(input.request);
    const principal = namespaced("principal", input.principal);
    const resolved = await this.#resolveIntent({ request, principal });
    const normalized = normalizeRequest(resolved.normalizedRequest);
    const action = resolved.action === undefined ? undefined : namespaced("action", resolved.action);
    return deepFreeze({
      request: normalized,
      principal,
      intent: requiredText("intent", resolved.intent),
      subjects: uniqueRequired("subjects", resolved.subjects.map((subject) => namespaced("subject", subject))),
      ...(action === undefined ? {} : { action }),
      domain: namespaced("domain", resolved.domain),
      validAt: normalizeInstant(resolved.validAt),
      recordedAt: normalizeInstant(resolved.recordedAt),
      purpose: requiredText("purpose", resolved.purpose),
      constraints: unique("constraints", resolved.constraints),
      evidenceRequirements: unique("evidence requirements", resolved.evidenceRequirements),
      contradictionRequirements: unique("contradiction requirements", resolved.contradictionRequirements),
      requiredState: ["current-state", "relevant-history", "evidence", "contradictions"] as const,
      graphIds: unique("graph ids", resolved.graphIds.map((graph) => prefixed("graph id", graph, "graph:"))),
      modalities: unique("retrieval modalities", resolved.modalities),
      checks: [
        ...(action === undefined
          ? []
          : [{ kind: "authority" as const, predicate: action, purpose: resolved.purpose }]),
        { kind: "permission" as const, operation: "RECONSTRUCT" as const, principal, purpose: resolved.purpose },
      ],
    });
  }
}

export type WorkspaceItem = Readonly<Record<string, StateValue>>;

export interface WorkspaceAssembly {
  readonly currentState: readonly WorkspaceItem[];
  readonly historicalState: readonly WorkspaceItem[];
  readonly relevantEvents: readonly WorkspaceItem[];
  readonly decisions: readonly WorkspaceItem[];
  readonly procedures: readonly WorkspaceItem[];
  readonly evidence: readonly WorkspaceItem[];
  readonly contradictions: readonly WorkspaceItem[];
  readonly uncertainties: readonly WorkspaceItem[];
  readonly authorityContext: WorkspaceItem;
  readonly provenanceManifest: readonly string[];
  readonly renderedContext: string;
}

export interface ReconstructiveWorkspace {
  readonly id: string;
  readonly kind: "reconstruction";
  readonly transactionTime: { readonly from: string };
  readonly request: string;
  readonly intent: string;
  readonly subjects: readonly string[];
  readonly currentState: readonly WorkspaceItem[];
  readonly historicalState: readonly WorkspaceItem[];
  readonly relevantEvents: readonly WorkspaceItem[];
  readonly decisions: readonly WorkspaceItem[];
  readonly constraints: readonly string[];
  readonly procedures: readonly WorkspaceItem[];
  readonly evidence: readonly WorkspaceItem[];
  readonly contradictions: readonly WorkspaceItem[];
  readonly uncertainties: readonly WorkspaceItem[];
  readonly authorityContext: WorkspaceItem;
  readonly permissionContext: {
    readonly allowed: true;
    readonly capabilityId: string;
    readonly rationale: string;
  };
  readonly provenanceManifest: readonly string[];
  readonly recommendedContext: string;
  readonly trace: readonly {
    readonly stage:
      | "intent"
      | "permission"
      | "graph-activation"
      | "retrieval"
      | "temporal-resolution"
      | "authority-resolution"
      | "evidence-evaluation"
      | "context-assembly";
    readonly detail: StateValue;
  }[];
}

export interface ReconstructionEnginePorts {
  readonly planner: StateRequirementPlanner;
  readonly authorize: (plan: StateRequirementPlan) =>
    | { readonly allowed: true; readonly capabilityId: string; readonly rationale: string }
    | { readonly allowed: false; readonly rationale: string };
  readonly retrieve: (plan: StateRequirementPlan) => Promise<{
    readonly recordIds: readonly string[];
    readonly trace: readonly WorkspaceItem[];
  }>;
  readonly assemble: (
    plan: StateRequirementPlan,
    recordIds: readonly string[],
  ) => Promise<WorkspaceAssembly>;
}

export class ReconstructionEngine {
  readonly #ports: ReconstructionEnginePorts;

  constructor(ports: ReconstructionEnginePorts) {
    this.#ports = ports;
  }

  async reconstruct(input: {
    readonly id: string;
    readonly request: string;
    readonly principal: string;
  }): Promise<ReconstructiveWorkspace> {
    const id = prefixed("reconstruction id", input.id, "reconstruction:");
    const plan = await this.#ports.planner.plan({ request: input.request, principal: input.principal });
    const permission = this.#ports.authorize(plan);
    if (!permission.allowed) {
      throw new Error(`reconstruction denied: ${permission.rationale}`);
    }
    const retrieval = await this.#ports.retrieve(plan);
    const recordIds = unique("retrieved record ids", retrieval.recordIds.map((item) => namespaced("record id", item)));
    const assembly = await this.#ports.assemble(plan, recordIds);
    const trace: ReconstructiveWorkspace["trace"] = [
      { stage: "intent", detail: { intent: plan.intent, subjects: plan.subjects } },
      { stage: "permission", detail: { capabilityId: permission.capabilityId, rationale: permission.rationale } },
      { stage: "graph-activation", detail: { graphIds: plan.graphIds } },
      { stage: "retrieval", detail: { recordIds, providers: retrieval.trace } },
      { stage: "temporal-resolution", detail: { validAt: plan.validAt, recordedAt: plan.recordedAt } },
      { stage: "authority-resolution", detail: assembly.authorityContext },
      {
        stage: "evidence-evaluation",
        detail: {
          evidenceCount: assembly.evidence.length,
          contradictionCount: assembly.contradictions.length,
          uncertaintyCount: assembly.uncertainties.length,
        },
      },
      {
        stage: "context-assembly",
        detail: {
          currentStateCount: assembly.currentState.length,
          historicalStateCount: assembly.historicalState.length,
        },
      },
    ];
    return deepFreeze({
      id,
      kind: "reconstruction" as const,
      transactionTime: { from: plan.recordedAt },
      request: plan.request,
      intent: plan.intent,
      subjects: plan.subjects,
      currentState: assembly.currentState,
      historicalState: assembly.historicalState,
      relevantEvents: assembly.relevantEvents,
      decisions: assembly.decisions,
      constraints: plan.constraints,
      procedures: assembly.procedures,
      evidence: assembly.evidence,
      contradictions: assembly.contradictions,
      uncertainties: assembly.uncertainties,
      authorityContext: assembly.authorityContext,
      permissionContext: permission,
      provenanceManifest: unique("provenance manifest", assembly.provenanceManifest),
      recommendedContext: requiredText("rendered context", assembly.renderedContext),
      trace,
    });
  }
}

function normalizeRequest(value: string): string {
  return requiredText("request", value).toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}
function unique<Value extends string>(name: string, values: readonly Value[]): Value[] {
  const result = values.map((value) => requiredText(name, value) as Value);
  if (new Set(result).size !== result.length) throw new Error(`${name} must not contain duplicates`);
  return result.sort();
}
function uniqueRequired<Value extends string>(name: string, values: readonly Value[]): Value[] {
  const result = unique(name, values);
  if (result.length === 0) throw new TypeError(`${name} must not be empty`);
  return result;
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
function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return date.toISOString();
}
function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}
function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
