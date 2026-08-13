export interface LedgerRecord {
  readonly id: string;
  readonly kind: string;
  readonly transactionTime: {
    readonly from: string;
    readonly to?: string;
  };
}

export interface LedgerQuery {
  readonly kinds?: readonly string[];
  readonly from?: string;
  readonly until?: string;
}

export interface CanonicalLedgerPort<RecordType extends LedgerRecord = LedgerRecord> {
  append(record: RecordType): void;
  get(id: string): RecordType | undefined;
  query(query?: LedgerQuery): readonly RecordType[];
}

export class InMemoryCanonicalLedger<RecordType extends LedgerRecord = LedgerRecord>
  implements CanonicalLedgerPort<RecordType>
{
  readonly #records = new Map<string, RecordType>();

  static replay<RecordType extends LedgerRecord>(
    records: readonly RecordType[],
  ): InMemoryCanonicalLedger<RecordType> {
    const ledger = new InMemoryCanonicalLedger<RecordType>();
    for (const record of [...records].sort(compareRecords)) {
      ledger.append(record);
    }
    return ledger;
  }

  append(record: RecordType): void {
    const id = requiredText("record id", record.id);
    requiredText("record kind", record.kind);
    normalizeInstant(record.transactionTime.from);
    if (this.#records.has(id)) {
      throw new Error(`canonical record already exists: ${id}`);
    }
    this.#records.set(id, deepFreeze(structuredClone(record)));
  }

  get(id: string): RecordType | undefined {
    return this.#records.get(id);
  }

  query(query: LedgerQuery = {}): readonly RecordType[] {
    const from = query.from === undefined ? undefined : normalizeInstant(query.from);
    const until = query.until === undefined ? undefined : normalizeInstant(query.until);
    if (from !== undefined && until !== undefined && until < from) {
      throw new RangeError("ledger query until must not be before from");
    }
    const kinds = query.kinds === undefined ? undefined : new Set(query.kinds);
    const records = [...this.#records.values()]
      .filter((record) => kinds === undefined || kinds.has(record.kind))
      .filter((record) => from === undefined || record.transactionTime.from >= from)
      .filter((record) => until === undefined || record.transactionTime.from <= until)
      .sort(compareRecords);
    return Object.freeze(records);
  }
}

function compareRecords(left: LedgerRecord, right: LedgerRecord): number {
  return (
    left.transactionTime.from.localeCompare(right.transactionTime.from) ||
    left.id.localeCompare(right.id)
  );
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
