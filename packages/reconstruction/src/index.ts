import type { RetrievalModality } from "../../search/src/index.ts";

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
