import type { Provenance, StateValue } from "../../core/src/index.ts";

export type VerificationStrategy =
  | "schema"
  | "constraint"
  | "source"
  | "cross-source"
  | "temporal"
  | "authority"
  | "consistency"
  | "external"
  | "human"
  | "domain";

export interface VerifierResult {
  readonly status: "verified" | "rejected" | "inconclusive";
  readonly details: string;
  readonly issues: readonly string[];
}

export interface Verifier {
  readonly id: string;
  readonly kind: VerificationStrategy;
  verify(input: {
    readonly subjectId: string;
    readonly payload: StateValue;
    readonly context: Readonly<Record<string, StateValue>>;
  }): Promise<VerifierResult>;
}

export interface VerificationOutcome {
  readonly verifierId: string;
  readonly strategy: VerificationStrategy;
  readonly status: "verified" | "rejected" | "inconclusive" | "error";
  readonly details: string;
  readonly issues: readonly string[];
}

export interface VerificationDecision {
  readonly id: string;
  readonly kind: "verification";
  readonly subjectId: string;
  readonly status: "verified" | "rejected" | "inconclusive";
  readonly transactionTime: { readonly from: string };
  readonly provenance: Provenance;
  readonly outcomes: readonly VerificationOutcome[];
}

export class VerificationEngine {
  readonly #verifiers = new Map<string, Verifier>();

  register(verifier: Verifier): void {
    const id = prefixed("verifier id", verifier.id, "verifier:");
    if (this.#verifiers.has(id)) throw new Error(`verifier already exists: ${id}`);
    this.#verifiers.set(id, verifier);
  }

  async verify(input: {
    readonly id: string;
    readonly subjectId: string;
    readonly strategies: readonly VerificationStrategy[];
    readonly payload: StateValue;
    readonly context: Readonly<Record<string, StateValue>>;
    readonly recordedAt: string;
    readonly provenance: Provenance;
  }): Promise<VerificationDecision> {
    const subjectId = namespaced("verification subject", input.subjectId);
    const outcomes: VerificationOutcome[] = [];
    for (const strategy of input.strategies) {
      const matching = [...this.#verifiers.values()]
        .filter((verifier) => verifier.kind === strategy)
        .sort((left, right) => left.id.localeCompare(right.id));
      if (matching.length === 0) {
        outcomes.push({
          verifierId: `verifier:missing:${strategy}`,
          strategy,
          status: "error",
          details: `No ${strategy} verifier is registered.`,
          issues: ["verifier-missing"],
        });
        continue;
      }
      for (const verifier of matching) {
        try {
          const result = await verifier.verify({
            subjectId,
            payload: input.payload,
            context: input.context,
          });
          outcomes.push({
            verifierId: verifier.id,
            strategy,
            status: result.status,
            details: requiredText("verification details", result.details),
            issues: [...result.issues],
          });
        } catch (error) {
          outcomes.push({
            verifierId: verifier.id,
            strategy,
            status: "error",
            details: error instanceof Error ? error.message : "Verifier failed with a non-Error value.",
            issues: ["verifier-exception"],
          });
        }
      }
    }
    const status = outcomes.some((outcome) => outcome.status === "rejected" || outcome.status === "error")
      ? ("rejected" as const)
      : outcomes.length > 0 && outcomes.every((outcome) => outcome.status === "verified")
        ? ("verified" as const)
        : ("inconclusive" as const);
    return deepFreeze({
      id: prefixed("verification id", input.id, "verification:"),
      kind: "verification" as const,
      subjectId,
      status,
      transactionTime: { from: normalizeInstant(input.recordedAt) },
      provenance: cloneProvenance(input.provenance),
      outcomes,
    });
  }
}

function cloneProvenance(value: Provenance): Provenance {
  return {
    derivedFrom: value.derivedFrom.map((reference) => ({ ...reference })),
    transformations: [...value.transformations],
  };
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
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`timestamp must include an explicit UTC offset: ${value}`);
  }
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
