import type { EvidenceRecord, Provenance } from "../../core/src/index.ts";

export interface EvidenceLink {
  readonly id: string;
  readonly kind: "evidence-link";
  readonly evidenceId: string;
  readonly claimId: string;
  readonly stance: "supports" | "contradicts";
  readonly strength: number;
  readonly transactionTime: { readonly from: string };
  readonly provenance: Provenance;
}

export interface VerificationOutcome {
  readonly id: string;
  readonly kind: "verification";
  readonly subjectId: string;
  readonly verifier: {
    readonly id: string;
    readonly kind: "schema" | "constraint" | "source" | "cross-source" | "temporal" | "authority" | "consistency" | "external" | "human" | "domain";
  };
  readonly method: string;
  readonly status: "verified" | "rejected" | "inconclusive";
  readonly transactionTime: { readonly from: string };
  readonly provenance: Provenance;
  readonly details: string;
}

export interface EvidenceAssessment {
  readonly link: EvidenceLink;
  readonly evidence: EvidenceRecord;
  readonly verification: readonly VerificationOutcome[];
}

export interface EvidenceSummary {
  readonly claimId: string;
  readonly assessment: "supported" | "contradicted" | "mixed" | "unresolved";
  readonly supporting: readonly EvidenceAssessment[];
  readonly contradicting: readonly EvidenceAssessment[];
  readonly rationale: string;
}

export function createEvidenceLink(input: {
  readonly id: string;
  readonly evidenceId: string;
  readonly claimId: string;
  readonly stance: EvidenceLink["stance"];
  readonly strength: number;
  readonly recordedAt: string;
  readonly provenance: Provenance;
}): EvidenceLink {
  if (input.strength < 0 || input.strength > 1) {
    throw new RangeError("evidence strength must be between 0 and 1");
  }
  return deepFreeze({
    id: prefixed("evidence link id", input.id, "evidence-link:"),
    kind: "evidence-link" as const,
    evidenceId: prefixed("evidence id", input.evidenceId, "evidence:"),
    claimId: prefixed("claim id", input.claimId, "claim:"),
    stance: input.stance,
    strength: input.strength,
    transactionTime: { from: normalizeInstant(input.recordedAt) },
    provenance: cloneProvenance(input.provenance),
  });
}

export function createVerificationOutcome(input: {
  readonly id: string;
  readonly subjectId: string;
  readonly verifier: VerificationOutcome["verifier"];
  readonly method: string;
  readonly status: VerificationOutcome["status"];
  readonly recordedAt: string;
  readonly provenance: Provenance;
  readonly details: string;
}): VerificationOutcome {
  return deepFreeze({
    id: prefixed("verification id", input.id, "verification:"),
    kind: "verification" as const,
    subjectId: namespaced("verification subject", input.subjectId),
    verifier: {
      id: namespaced("verifier id", input.verifier.id),
      kind: input.verifier.kind,
    },
    method: requiredText("verification method", input.method),
    status: input.status,
    transactionTime: { from: normalizeInstant(input.recordedAt) },
    provenance: cloneProvenance(input.provenance),
    details: requiredText("verification details", input.details),
  });
}

export class EvidenceEngine {
  readonly #evidence = new Map<string, EvidenceRecord>();
  readonly #links = new Map<string, EvidenceLink>();
  readonly #verifications = new Map<string, VerificationOutcome>();
  readonly #recordIds = new Set<string>();

  registerEvidence(evidence: EvidenceRecord): void {
    this.#assertNew(evidence.id);
    this.#evidence.set(evidence.id, evidence);
    this.#recordIds.add(evidence.id);
  }

  appendLink(link: EvidenceLink): void {
    this.#assertNew(link.id);
    if (!this.#evidence.has(link.evidenceId)) {
      throw new Error(`evidence does not exist: ${link.evidenceId}`);
    }
    this.#links.set(link.id, link);
    this.#recordIds.add(link.id);
  }

  appendVerification(outcome: VerificationOutcome): void {
    this.#assertNew(outcome.id);
    if (outcome.subjectId.startsWith("evidence:") && !this.#evidence.has(outcome.subjectId)) {
      throw new Error(`verification evidence subject does not exist: ${outcome.subjectId}`);
    }
    this.#verifications.set(outcome.id, outcome);
    this.#recordIds.add(outcome.id);
  }

  summarize(claimId: string): EvidenceSummary {
    const normalizedClaimId = prefixed("claim id", claimId, "claim:");
    const assessments = [...this.#links.values()]
      .filter((link) => link.claimId === normalizedClaimId)
      .sort(compareTransactionRecords)
      .map((link) => {
        const evidence = this.#evidence.get(link.evidenceId) as EvidenceRecord;
        const verification = [...this.#verifications.values()]
          .filter((outcome) => outcome.subjectId === evidence.id)
          .sort(compareTransactionRecords);
        return { link, evidence, verification };
      });
    const supporting = assessments.filter((assessment) => assessment.link.stance === "supports");
    const contradicting = assessments.filter((assessment) => assessment.link.stance === "contradicts");
    const assessment =
      supporting.length > 0 && contradicting.length > 0
        ? ("mixed" as const)
        : supporting.length > 0
          ? ("supported" as const)
          : contradicting.length > 0
            ? ("contradicted" as const)
            : ("unresolved" as const);
    return deepFreeze({
      claimId: normalizedClaimId,
      assessment,
      supporting,
      contradicting,
      rationale: `${supporting.length} supporting and ${contradicting.length} contradicting evidence records retained; assessment is ${assessment}.`,
    });
  }

  #assertNew(id: string): void {
    if (this.#recordIds.has(id)) throw new Error(`evidence record already exists: ${id}`);
  }
}

function compareTransactionRecords(
  left: { readonly id: string; readonly transactionTime: { readonly from: string } },
  right: { readonly id: string; readonly transactionTime: { readonly from: string } },
): number {
  return left.transactionTime.from.localeCompare(right.transactionTime.from) || left.id.localeCompare(right.id);
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
