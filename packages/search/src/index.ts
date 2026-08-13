import type { StateValue } from "../../core/src/index.ts";

export type RetrievalModality =
  | "lexical"
  | "vector"
  | "graph"
  | "temporal"
  | "entity"
  | "state"
  | "procedure"
  | "evidence";

export interface RetrievalCandidate {
  readonly recordId: string;
  readonly score: number;
  readonly provenance: readonly string[];
}

export interface RetrievalProvider {
  readonly id: string;
  readonly modality: RetrievalModality;
  retrieve(input: {
    readonly query: string;
    readonly limit: number;
    readonly filters: Readonly<Record<string, StateValue>>;
  }): Promise<readonly RetrievalCandidate[]>;
}

export interface RetrievalPlan {
  readonly query: string;
  readonly limit: number;
  readonly modalities: readonly { readonly modality: RetrievalModality; readonly weight: number }[];
  readonly filters: Readonly<Record<string, StateValue>>;
}

export interface FusedCandidate {
  readonly recordId: string;
  readonly score: number;
  readonly provenance: readonly string[];
  readonly contributions: readonly {
    readonly providerId: string;
    readonly modality: RetrievalModality;
    readonly score: number;
    readonly weight: number;
    readonly weightedScore: number;
  }[];
}

export interface RetrievalResult {
  readonly candidates: readonly FusedCandidate[];
  readonly trace: readonly {
    readonly providerId: string;
    readonly modality: RetrievalModality;
    readonly candidateCount: number;
    readonly weight: number;
  }[];
}

export class RetrievalOrchestrator {
  readonly #providers = new Map<string, RetrievalProvider>();

  register(provider: RetrievalProvider): void {
    const id = prefixed("retriever id", provider.id, "retriever:");
    if (this.#providers.has(id)) throw new Error(`retrieval provider already exists: ${id}`);
    this.#providers.set(id, provider);
  }

  async retrieve(plan: RetrievalPlan): Promise<RetrievalResult> {
    const query = requiredText("retrieval query", plan.query);
    if (!Number.isInteger(plan.limit) || plan.limit < 1) throw new RangeError("retrieval limit must be positive");
    const configured = [...plan.modalities]
      .map((item) => {
        if (!Number.isFinite(item.weight) || item.weight < 0) throw new RangeError("modality weight must be non-negative");
        return item;
      })
      .sort((left, right) => left.modality.localeCompare(right.modality));
    const modalitySet = new Set<RetrievalModality>();
    for (const item of configured) {
      if (modalitySet.has(item.modality)) throw new Error(`duplicate retrieval modality: ${item.modality}`);
      modalitySet.add(item.modality);
    }
    const providers = [...this.#providers.values()]
      .filter((provider) => modalitySet.has(provider.modality))
      .sort((left, right) => left.modality.localeCompare(right.modality) || left.id.localeCompare(right.id));
    const responses = await Promise.all(
      providers.map(async (provider) => {
        const weight = configured.find((item) => item.modality === provider.modality)?.weight as number;
        const candidates = await provider.retrieve({ query, limit: plan.limit, filters: plan.filters });
        return { provider, weight, candidates: validateCandidates(candidates) };
      }),
    );
    const fused = new Map<string, { score: number; provenance: Set<string>; contributions: FusedCandidate["contributions"][number][] }>();
    for (const response of responses) {
      for (const candidate of response.candidates) {
        const current = fused.get(candidate.recordId) ?? { score: 0, provenance: new Set<string>(), contributions: [] };
        const weightedScore = candidate.score * response.weight;
        current.score += weightedScore;
        for (const reference of candidate.provenance) current.provenance.add(reference);
        current.contributions.push({
          providerId: response.provider.id,
          modality: response.provider.modality,
          score: candidate.score,
          weight: response.weight,
          weightedScore,
        });
        fused.set(candidate.recordId, current);
      }
    }
    const candidates = [...fused.entries()]
      .map(([recordId, value]) => ({
        recordId,
        score: value.score,
        provenance: [...value.provenance].sort(),
        contributions: value.contributions.sort(
          (left, right) => left.modality.localeCompare(right.modality) || left.providerId.localeCompare(right.providerId),
        ),
      }))
      .sort((left, right) => right.score - left.score || left.recordId.localeCompare(right.recordId))
      .slice(0, plan.limit);
    return deepFreeze({
      candidates,
      trace: responses.map((response) => ({
        providerId: response.provider.id,
        modality: response.provider.modality,
        candidateCount: response.candidates.length,
        weight: response.weight,
      })),
    });
  }
}

function validateCandidates(values: readonly RetrievalCandidate[]): RetrievalCandidate[] {
  return values.map((value) => {
    if (value.score < 0 || value.score > 1) throw new RangeError("retrieval score must be between 0 and 1");
    return {
      recordId: namespaced("retrieval record id", value.recordId),
      score: value.score,
      provenance: [...new Set(value.provenance.map((item) => namespaced("retrieval provenance", item)))].sort(),
    };
  });
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
function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
