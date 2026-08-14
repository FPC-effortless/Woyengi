import type {
  CanonicalRecord,
  ClaimRecord,
  LifecycleTransitionRecord,
} from "../../core/src/index.ts";

export interface ClaimHistoryFilter {
  readonly subject?: string;
  readonly predicate?: string;
}

export interface StateProjectionQuery {
  readonly subject: string;
  readonly predicate: string;
  readonly validAt: string;
  readonly recordedAt: string;
}

export interface ProjectedClaim {
  readonly claim: ClaimRecord;
  readonly effectiveLifecycle: ClaimRecord["lifecycle"];
}

export interface ProjectionTraceStep {
  readonly stage:
    | "candidate-discovery"
    | "transaction-time"
    | "valid-time"
    | "lifecycle"
    | "selection";
  readonly inputCount: number;
  readonly outputCount: number;
  readonly detail: string;
}

export interface StateProjection {
  readonly subject: string;
  readonly predicate: string;
  readonly validAt: string;
  readonly recordedAt: string;
  readonly selected?: ProjectedClaim;
  readonly candidates: readonly ProjectedClaim[];
  readonly conflicts: readonly ProjectedClaim[];
  readonly trace: readonly ProjectionTraceStep[];
}

export class ClaimLedger {
  readonly #claimsById = new Map<string, ClaimRecord>();
  readonly #lifecycleByTarget = new Map<string, LifecycleTransitionRecord[]>();
  readonly #recordIds = new Set<string>();

  static replay(
    records: readonly CanonicalRecord[],
    options: { readonly until?: string } = {},
  ): ClaimLedger {
    const ledger = new ClaimLedger();
    const until = options.until === undefined ? undefined : normalizeInstant(options.until);
    const ordered = [...records]
      .filter((record) => until === undefined || record.transactionTime.from <= until)
      .sort(compareCanonicalTransactionOrder);

    for (const record of ordered) {
      if (record.kind === "claim") {
        ledger.append(record);
      } else {
        ledger.appendLifecycleTransition(record);
      }
    }
    return ledger;
  }

  append(claim: ClaimRecord): void {
    this.#assertNewRecordId(claim.id);
    this.#claimsById.set(claim.id, claim);
    this.#recordIds.add(claim.id);
  }

  appendLifecycleTransition(transition: LifecycleTransitionRecord): void {
    this.#assertNewRecordId(transition.id);
    if (!this.#claimsById.has(transition.targetId)) {
      throw new Error(`lifecycle target does not exist: ${transition.targetId}`);
    }
    const history = this.#lifecycleByTarget.get(transition.targetId) ?? [];
    history.push(transition);
    this.#lifecycleByTarget.set(transition.targetId, history);
    this.#recordIds.add(transition.id);
  }

  history(filter: ClaimHistoryFilter = {}): readonly ClaimRecord[] {
    const claims = [...this.#claimsById.values()]
      .filter((claim) => filter.subject === undefined || claim.subject === filter.subject)
      .filter((claim) => filter.predicate === undefined || claim.predicate === filter.predicate)
      .sort(compareTransactionOrder);

    return Object.freeze(claims);
  }

  lifecycleHistory(targetId: string): readonly LifecycleTransitionRecord[] {
    return Object.freeze(
      [...(this.#lifecycleByTarget.get(targetId) ?? [])].sort(compareLifecycleTransactionOrder),
    );
  }

  canonicalRecords(): readonly CanonicalRecord[] {
    const records: CanonicalRecord[] = [
      ...this.#claimsById.values(),
      ...[...this.#lifecycleByTarget.values()].flat(),
    ];
    return Object.freeze(records.sort(compareCanonicalTransactionOrder));
  }

  projectAt(query: StateProjectionQuery): StateProjection {
    const validAt = normalizeInstant(query.validAt);
    const recordedAt = normalizeInstant(query.recordedAt);
    const discovered = [...this.history({ subject: query.subject, predicate: query.predicate })];
    const known = discovered.filter((claim) => contains(claim.transactionTime, recordedAt));
    const valid = known.filter((claim) => contains(claim.validTime, validAt));
    const lifecycleCandidates = valid.map((claim) => ({
      claim,
      effectiveLifecycle: this.#effectiveLifecycle(claim, recordedAt),
    }));
    const governing = lifecycleCandidates
      .filter(
        (candidate) =>
          candidate.effectiveLifecycle === "verified" ||
          candidate.effectiveLifecycle === "provisional",
      )
      .sort(compareProjectionPriority);
    const selected = governing[0];
    const selectedClaimId = selected?.claim.id;
    const selectedValue = selected === undefined ? undefined : canonicalValue(selected.claim.object);
    const conflicts =
      selectedValue === undefined
        ? []
        : governing.filter(
            (candidate) =>
              candidate.claim.id !== selectedClaimId &&
              canonicalValue(candidate.claim.object) !== selectedValue,
          );

    return deepFreeze({
      subject: query.subject,
      predicate: query.predicate,
      validAt,
      recordedAt,
      ...(selected === undefined ? {} : { selected }),
      candidates: governing,
      conflicts,
      trace: [
        trace("candidate-discovery", discovered.length, discovered.length, "matched subject and predicate"),
        trace("transaction-time", discovered.length, known.length, "removed claims not yet recorded"),
        trace("valid-time", known.length, valid.length, "removed claims not valid in the world"),
        trace(
          "lifecycle",
          lifecycleCandidates.length,
          governing.length,
          "applied lifecycle transitions and removed non-governing states",
        ),
        trace(
          "selection",
          governing.length,
          selected === undefined ? 0 : 1,
          "ranked lifecycle, authority, valid time, transaction time, confidence, then ID",
        ),
      ],
    });
  }

  #effectiveLifecycle(
    claim: ClaimRecord,
    recordedAt: string,
  ): ClaimRecord["lifecycle"] {
    const applicable = this.lifecycleHistory(claim.id).filter(
      (transition) => transition.transactionTime.from <= recordedAt,
    );
    return applicable.at(-1)?.status ?? claim.lifecycle;
  }

  #assertNewRecordId(id: string): void {
    if (this.#recordIds.has(id)) {
      throw new Error(`record already exists: ${id}`);
    }
  }
}

function compareTransactionOrder(left: ClaimRecord, right: ClaimRecord): number {
  return (
    left.transactionTime.from.localeCompare(right.transactionTime.from) ||
    left.id.localeCompare(right.id)
  );
}

function compareLifecycleTransactionOrder(
  left: LifecycleTransitionRecord,
  right: LifecycleTransitionRecord,
): number {
  return (
    left.transactionTime.from.localeCompare(right.transactionTime.from) ||
    left.id.localeCompare(right.id)
  );
}

function compareCanonicalTransactionOrder(
  left: CanonicalRecord,
  right: CanonicalRecord,
): number {
  return (
    left.transactionTime.from.localeCompare(right.transactionTime.from) ||
    left.id.localeCompare(right.id)
  );
}

function compareProjectionPriority(left: ProjectedClaim, right: ProjectedClaim): number {
  return (
    lifecycleRank(right.effectiveLifecycle) - lifecycleRank(left.effectiveLifecycle) ||
    right.claim.authority.level - left.claim.authority.level ||
    right.claim.validTime.from.localeCompare(left.claim.validTime.from) ||
    right.claim.transactionTime.from.localeCompare(left.claim.transactionTime.from) ||
    right.claim.confidence - left.claim.confidence ||
    left.claim.id.localeCompare(right.claim.id)
  );
}

function lifecycleRank(status: ClaimRecord["lifecycle"]): number {
  return status === "verified" ? 2 : status === "provisional" ? 1 : 0;
}

function contains(interval: ClaimRecord["validTime"], instant: string): boolean {
  return interval.from <= instant && (interval.to === undefined || instant < interval.to);
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`timestamp must include an explicit UTC offset: ${value}`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`invalid timestamp: ${value}`);
  }
  return date.toISOString();
}

function canonicalValue(value: ClaimRecord["object"]): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalValue(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function trace(
  stage: ProjectionTraceStep["stage"],
  inputCount: number,
  outputCount: number,
  detail: string,
): ProjectionTraceStep {
  return { stage, inputCount, outputCount, detail };
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
