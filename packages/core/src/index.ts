export type EntityId = string & { readonly __brand: "EntityId" };
export type Predicate = string & { readonly __brand: "Predicate" };
export type RecordId<Kind extends RecordKind = RecordKind> = string & {
  readonly __brand: "RecordId";
  readonly __kind: Kind;
};

export type RecordKind =
  | "observation"
  | "claim"
  | "event"
  | "relationship"
  | "evidence"
  | "authority-assessment"
  | "lifecycle-transition"
  | "artifact";

export type LifecycleStatus =
  | "provisional"
  | "verified"
  | "rejected"
  | "superseded"
  | "retracted"
  | "invalidated"
  | "archived";

export type StateValue =
  | null
  | boolean
  | number
  | string
  | readonly StateValue[]
  | { readonly [key: string]: StateValue };

export interface TimeInterval {
  readonly from: string;
  readonly to?: string;
}

export interface ProvenanceReference {
  readonly kind: RecordKind;
  readonly id: string;
}

export interface Provenance {
  readonly derivedFrom: readonly ProvenanceReference[];
  readonly transformations: readonly string[];
}

export interface Authority {
  readonly level: number;
  readonly basis: string;
  readonly principal?: EntityId;
}

export interface ObservationRecord {
  readonly kind: "observation";
  readonly id: RecordId<"observation">;
  readonly sourceId: string;
  readonly observedAt: string;
  readonly transactionTime: TimeInterval;
  readonly payload: StateValue;
  readonly provenance: Provenance;
  readonly lifecycle: LifecycleStatus;
}

export interface EvidenceRecord {
  readonly kind: "evidence";
  readonly id: RecordId<"evidence">;
  readonly sourceId: string;
  readonly locator: string;
  readonly transactionTime: TimeInterval;
  readonly provenance: Provenance;
  readonly lifecycle: LifecycleStatus;
}

export interface ClaimRecord {
  readonly kind: "claim";
  readonly id: RecordId<"claim">;
  readonly subject: EntityId;
  readonly predicate: Predicate;
  readonly object: StateValue;
  readonly validTime: TimeInterval;
  readonly transactionTime: TimeInterval;
  readonly observationIds: readonly RecordId<"observation">[];
  readonly evidenceIds: readonly RecordId<"evidence">[];
  readonly provenance: Provenance;
  readonly authority: Authority;
  readonly confidence: number;
  readonly lifecycle: LifecycleStatus;
}

export interface LifecycleTransitionRecord {
  readonly kind: "lifecycle-transition";
  readonly id: RecordId<"lifecycle-transition">;
  readonly targetId: RecordId;
  readonly status: LifecycleStatus;
  readonly reason: string;
  readonly transactionTime: TimeInterval;
  readonly provenance: Provenance;
  readonly authority: Authority;
}

export interface CreateObservationInput {
  readonly id: string;
  readonly sourceId: string;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly payload: StateValue;
  readonly provenance?: ProvenanceInput;
  readonly lifecycle?: LifecycleStatus;
}

export interface CreateEvidenceInput {
  readonly id: string;
  readonly sourceId: string;
  readonly locator: string;
  readonly recordedAt: string;
  readonly provenance?: ProvenanceInput;
  readonly lifecycle?: LifecycleStatus;
}

export interface CreateClaimInput {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: StateValue;
  readonly validTime: { readonly from: string; readonly to?: string };
  readonly recordedAt: string;
  readonly observationIds?: readonly string[];
  readonly evidenceIds?: readonly string[];
  readonly provenance?: ProvenanceInput;
  readonly authority: {
    readonly level: number;
    readonly basis: string;
    readonly principal?: string;
  };
  readonly confidence: number;
  readonly lifecycle?: LifecycleStatus;
}

export interface CreateLifecycleTransitionInput {
  readonly id: string;
  readonly targetId: string;
  readonly status: LifecycleStatus;
  readonly reason: string;
  readonly recordedAt: string;
  readonly provenance?: ProvenanceInput;
  readonly authority: {
    readonly level: number;
    readonly basis: string;
    readonly principal?: string;
  };
}

export interface ProvenanceInput {
  readonly derivedFrom?: readonly ProvenanceReference[];
  readonly transformations?: readonly string[];
}

export function createObservation(input: CreateObservationInput): ObservationRecord {
  return deepFreeze({
    kind: "observation" as const,
    id: recordId("observation", input.id),
    sourceId: requiredText("sourceId", input.sourceId),
    observedAt: normalizeInstant(input.observedAt),
    transactionTime: interval(input.recordedAt),
    payload: input.payload,
    provenance: provenance(input.provenance),
    lifecycle: input.lifecycle ?? "provisional",
  });
}

export function createEvidence(input: CreateEvidenceInput): EvidenceRecord {
  return deepFreeze({
    kind: "evidence" as const,
    id: recordId("evidence", input.id),
    sourceId: requiredText("sourceId", input.sourceId),
    locator: requiredText("locator", input.locator),
    transactionTime: interval(input.recordedAt),
    provenance: provenance(input.provenance),
    lifecycle: input.lifecycle ?? "provisional",
  });
}

export function createClaim(input: CreateClaimInput): ClaimRecord {
  if (input.confidence < 0 || input.confidence > 1) {
    throw new RangeError("confidence must be between 0 and 1");
  }
  if (!Number.isFinite(input.authority.level)) {
    throw new TypeError("authority.level must be a finite number");
  }

  return deepFreeze({
    kind: "claim" as const,
    id: recordId("claim", input.id),
    subject: entityId(input.subject),
    predicate: predicate(input.predicate),
    object: input.object,
    validTime: interval(input.validTime.from, input.validTime.to),
    transactionTime: interval(input.recordedAt),
    observationIds: (input.observationIds ?? []).map((id) => recordId("observation", id)),
    evidenceIds: (input.evidenceIds ?? []).map((id) => recordId("evidence", id)),
    provenance: provenance(input.provenance),
    authority: {
      level: input.authority.level,
      basis: requiredText("authority.basis", input.authority.basis),
      ...(input.authority.principal === undefined
        ? {}
        : { principal: entityId(input.authority.principal) }),
    },
    confidence: input.confidence,
    lifecycle: input.lifecycle ?? "provisional",
  });
}

export function createLifecycleTransition(
  input: CreateLifecycleTransitionInput,
): LifecycleTransitionRecord {
  if (!Number.isFinite(input.authority.level)) {
    throw new TypeError("authority.level must be a finite number");
  }

  return deepFreeze({
    kind: "lifecycle-transition" as const,
    id: prefixedRecordId("lifecycle-transition", "lifecycle", input.id),
    targetId: genericRecordId(input.targetId),
    status: input.status,
    reason: requiredText("reason", input.reason),
    transactionTime: interval(input.recordedAt),
    provenance: provenance(input.provenance),
    authority: {
      level: input.authority.level,
      basis: requiredText("authority.basis", input.authority.basis),
      ...(input.authority.principal === undefined
        ? {}
        : { principal: entityId(input.authority.principal) }),
    },
  });
}

function provenance(input: ProvenanceInput | undefined): Provenance {
  return {
    derivedFrom: [...(input?.derivedFrom ?? [])],
    transformations: [...(input?.transformations ?? [])],
  };
}

function interval(from: string, to?: string): TimeInterval {
  const normalizedFrom = normalizeInstant(from);
  const normalizedTo = to === undefined ? undefined : normalizeInstant(to);
  if (normalizedTo !== undefined && normalizedTo <= normalizedFrom) {
    throw new RangeError("time interval end must be after its start");
  }
  return normalizedTo === undefined
    ? { from: normalizedFrom }
    : { from: normalizedFrom, to: normalizedTo };
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`timestamp must include an explicit UTC offset: ${value}`);
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError(`invalid timestamp: ${value}`);
  }
  return instant.toISOString();
}

function recordId<Kind extends RecordKind>(kind: Kind, value: string): RecordId<Kind> {
  const normalized = requiredText(`${kind} id`, value);
  if (!normalized.startsWith(`${kind}:`)) {
    throw new TypeError(`${kind} id must start with ${kind}:`);
  }
  return normalized as RecordId<Kind>;
}

function prefixedRecordId<Kind extends RecordKind>(
  kind: Kind,
  prefix: string,
  value: string,
): RecordId<Kind> {
  const normalized = requiredText(`${kind} id`, value);
  if (!normalized.startsWith(`${prefix}:`)) {
    throw new TypeError(`${kind} id must start with ${prefix}:`);
  }
  return normalized as RecordId<Kind>;
}

function genericRecordId(value: string): RecordId {
  const normalized = requiredText("target record id", value);
  if (!/^[a-z][a-z0-9-]*:.+/i.test(normalized)) {
    throw new TypeError("target record id must be namespace-qualified");
  }
  return normalized as RecordId;
}

function entityId(value: string): EntityId {
  const normalized = requiredText("entity id", value);
  if (!normalized.startsWith("entity:")) {
    throw new TypeError("entity id must start with entity:");
  }
  return normalized as EntityId;
}

function predicate(value: string): Predicate {
  const normalized = requiredText("predicate", value);
  if (!normalized.includes(":")) {
    throw new TypeError("predicate must be namespace-qualified");
  }
  return normalized as Predicate;
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
  return normalized;
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
