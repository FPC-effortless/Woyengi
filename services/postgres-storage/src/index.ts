import type { LedgerRecord } from "../../../packages/ledger/src/index.ts";

/**
 * Minimal structural seam compatible with a PostgreSQL driver's Pool/Client
 * (for example pg.Pool). The caller owns connections and secret management.
 */
export interface PostgresConnection {
  query(sql: string, params?: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
  release(): void;
}

export interface PostgresPool {
  connect(): Promise<PostgresConnection>;
}

export interface PostgresLedgerOpenInput {
  readonly pool: PostgresPool;
  /** Isolates independent canonical journals such as work, workspace, sessions. */
  readonly namespace: string;
}

export interface PostgresLedgerLoadInput {
  readonly workspaceId?: string;
}

const GLOBAL_SCOPE = "workspace:legacy-global";

const CREATE_COUNTERS = `CREATE TABLE IF NOT EXISTS woyengi_ledger_counters (
  namespace TEXT NOT NULL,
  scope TEXT NOT NULL,
  next_sequence BIGINT NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  PRIMARY KEY (namespace, scope)
)`;

const CREATE_RECORDS = `CREATE TABLE IF NOT EXISTS woyengi_ledger_records (
  namespace TEXT NOT NULL,
  scope TEXT NOT NULL,
  ledger_sequence BIGINT NOT NULL CHECK (ledger_sequence > 0),
  record_id TEXT NOT NULL,
  record_kind TEXT NOT NULL,
  transaction_time TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL,
  PRIMARY KEY (namespace, scope, ledger_sequence),
  UNIQUE (namespace, record_id)
)`;

const ENSURE_COUNTER = `INSERT INTO woyengi_ledger_counters
  (namespace, scope, next_sequence) VALUES ($1, $2, 1)
  ON CONFLICT (namespace, scope) DO NOTHING`;
const LOCK_COUNTER = `SELECT next_sequence FROM woyengi_ledger_counters
  WHERE namespace = $1 AND scope = $2 FOR UPDATE`;
const STORE_RECORD = `INSERT INTO woyengi_ledger_records
  (namespace, scope, ledger_sequence, record_id, record_kind, transaction_time, record)
  VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb)`;
const ADVANCE_COUNTER = `UPDATE woyengi_ledger_counters
  SET next_sequence = $3 WHERE namespace = $1 AND scope = $2`;
const LOAD_RECORDS = `SELECT record FROM woyengi_ledger_records
  WHERE namespace = $1 ORDER BY scope ASC, ledger_sequence ASC`;
const LOAD_SCOPE = `SELECT record FROM woyengi_ledger_records
  WHERE namespace = $1 AND scope = $2 ORDER BY ledger_sequence ASC`;
const LOAD_ID = `SELECT record FROM woyengi_ledger_records
  WHERE namespace = $1 AND record_id = $2 ORDER BY ledger_sequence ASC`;

/**
 * Privileged, idempotent schema creation. Run as a migration before giving an
 * application role SELECT/INSERT/UPDATE grants; never invoke from request code.
 */
export async function migratePostgresCanonicalLedger(pool: PostgresPool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(CREATE_COUNTERS);
    await client.query(CREATE_RECORDS);
  } finally {
    client.release();
  }
}

/**
 * Stateless, database-authoritative PostgreSQL append-only ledger.
 *
 * Transaction-scoped counter row locks serialize writers for each scope.
 * Independent processes may use distinct Postgres pools; neither an in-memory
 * counter nor a filesystem lock is used for DB identity/causal order.
 *
 * This provider is asynchronous and intentionally does NOT implement the
 * synchronous LocalCanonicalLedger API. Composing Work/Workspace/session domain
 * journals with it requires an async repository adapter (a separate step).
 */
export class PostgresCanonicalLedger<RecordType extends LedgerRecord = LedgerRecord> {
  readonly #pool: PostgresPool;
  readonly #namespace: string;

  private constructor(input: PostgresLedgerOpenInput) {
    this.#pool = input.pool;
    this.#namespace = input.namespace;
  }

  static open<RecordType extends LedgerRecord = LedgerRecord>(
    input: PostgresLedgerOpenInput,
  ): PostgresCanonicalLedger<RecordType> {
    if (typeof input.namespace !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/.test(input.namespace)) {
      throw new TypeError("PostgreSQL ledger namespace must be a bounded safe identifier");
    }
    return new PostgresCanonicalLedger<RecordType>(input);
  }

  async append(record: RecordType): Promise<void> {
    await this.appendBatch([record]);
  }

  async appendBatch(records: readonly RecordType[]): Promise<void> {
    if (records.length === 0) return;
    const parsed = records.map((record) => {
      validateRecord(record);
      return {
        record,
        scope: record.workspaceId ?? GLOBAL_SCOPE,
      };
    });
    const sortedScopes = [...new Set(parsed.map((entry) => entry.scope))].sort();

    const client = await this.#pool.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;
      const next = new Map<string, number>();
      // Lock scopes in deterministic order so independent multi-scope batch
      // writers do not deadlock when acquiring counter row locks.
      for (const scope of sortedScopes) {
        await client.query(ENSURE_COUNTER, [this.#namespace, scope]);
        const result = await client.query(LOCK_COUNTER, [this.#namespace, scope]);
        if (result.rows.length !== 1) throw new Error(`PostgreSQL ledger counter missing: ${scope}`);
        const sequence = sequenceNumber(result.rows[0]?.next_sequence);
        next.set(scope, sequence);
      }

      const assigned = parsed.map(({ record, scope }) => {
        const sequence = next.get(scope);
        if (sequence === undefined || !Number.isSafeInteger(sequence + 1)) {
          throw new Error("PostgreSQL causal sequence exhausted");
        }
        next.set(scope, sequence + 1);
        return { record, scope, sequence };
      });

      // Inserting IDs in stable order reduces unique-index lock inversions
      // between overlapping transactions. Causal order remains input order.
      for (const { record, scope, sequence } of [...assigned].sort((a, b) => a.record.id.localeCompare(b.record.id))) {
        const stored = { ...structuredClone(record), ledgerSequence: sequence };
        await client.query(STORE_RECORD, [
          this.#namespace,
          scope,
          sequence,
          record.id,
          record.kind,
          new Date(record.transactionTime.from).toISOString(),
          JSON.stringify(stored),
        ]);
      }
      for (const scope of sortedScopes) {
        await client.query(ADVANCE_COUNTER, [this.#namespace, scope, next.get(scope)]);
      }
      await client.query("COMMIT");
      inTransaction = false;
    } catch (error) {
      if (inTransaction) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the primary failure; a broken connection must be discarded
          // by the supplied database driver.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async load(input: PostgresLedgerLoadInput = {}): Promise<readonly RecordType[]> {
    if (input.workspaceId !== undefined) requireId("workspace scope", input.workspaceId);
    const client = await this.#pool.connect();
    try {
      const result = input.workspaceId === undefined
        ? await client.query(LOAD_RECORDS, [this.#namespace])
        : await client.query(LOAD_SCOPE, [this.#namespace, input.workspaceId]);
      return Object.freeze(result.rows.map((row) => normalizeStoredRecord<RecordType>(row.record)));
    } finally {
      client.release();
    }
  }

  async get(id: string): Promise<RecordType | undefined> {
    requireId("record id", id);
    const client = await this.#pool.connect();
    try {
      const result = await client.query(LOAD_ID, [this.#namespace, id]);
      if (result.rows.length > 1) throw new Error(`duplicate PostgreSQL canonical record id: ${id}`);
      return result.rows.length === 0 ? undefined : normalizeStoredRecord<RecordType>(result.rows[0]?.record);
    } finally {
      client.release();
    }
  }
}

function validateRecord(record: LedgerRecord): void {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("PostgreSQL ledger record must be an object");
  }
  requireId("record id", record.id);
  requireId("record kind", record.kind);
  if (record.workspaceId !== undefined) requireId("workspace scope", record.workspaceId);
  if (record.ledgerSequence !== undefined) throw new Error("ledger sequence is assigned by durable storage");
  if (!record.transactionTime || typeof record.transactionTime.from !== "string"
    || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(record.transactionTime.from)
    || !Number.isFinite(Date.parse(record.transactionTime.from))) {
    throw new TypeError("transaction timestamp requires a valid explicit offset");
  }
  // A structured clone / JSON roundtrip must not silently drop special
  // values and later violate replay. Validate JSON serialization before SQL.
  const serialized = JSON.stringify(record);
  if (serialized === undefined) throw new TypeError("ledger record is not JSON serializable");
}

function normalizeStoredRecord<R extends LedgerRecord>(value: unknown): R {
  const record = (typeof value === "string" ? JSON.parse(value) as unknown : value) as LedgerRecord;
  if (!record || typeof record !== "object") throw new Error("invalid stored PostgreSQL record");
  requireId("record id", record.id);
  requireId("record kind", record.kind);
  if (record.workspaceId !== undefined) requireId("workspace scope", record.workspaceId);
  sequenceNumber(record.ledgerSequence);
  if (record.transactionTime === undefined
    || !Number.isFinite(Date.parse(record.transactionTime.from))) {
    throw new Error("invalid stored transaction time");
  }
  return deepFreeze(structuredClone(record) as R);
}

function sequenceNumber(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("invalid PostgreSQL causal sequence");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("invalid PostgreSQL causal sequence");
  return number;
}

function requireId(name: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) {
    throw new TypeError(`${name} must be a nonempty bounded string`);
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
