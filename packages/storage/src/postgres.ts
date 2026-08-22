import { readFile } from "node:fs/promises";

import { Pool, type PoolClient, type PoolConfig } from "pg";

import type { StateValue } from "../../core/src/index.ts";
import type { LedgerQuery, LedgerRecord } from "../../ledger/src/index.ts";

import { IdempotencyConflictError } from "./index.ts";

export interface PostgresCanonicalLedgerOptions {
  readonly connectionString: string;
  readonly maximumConnections?: number;
}

interface CanonicalRow {
  readonly payload: unknown;
}

interface SequenceRow {
  readonly next_sequence: string | number;
}

export class PostgresCanonicalLedger<RecordType extends LedgerRecord = LedgerRecord> {
  readonly #pool: Pool;
  readonly #records = new Map<string, RecordType>();
  #writeQueue: Promise<void> = Promise.resolve();
  #closed = false;

  private constructor(pool: Pool, records: readonly RecordType[]) {
    this.#pool = pool;
    for (const record of records) {
      if (this.#records.has(record.id)) throw new Error(`canonical record already exists: ${record.id}`);
      this.#records.set(record.id, immutableRecord(record));
    }
  }

  static async open<RecordType extends LedgerRecord = LedgerRecord>(
    options: PostgresCanonicalLedgerOptions,
  ): Promise<PostgresCanonicalLedger<RecordType>> {
    const pool = new Pool(poolConfig(options));
    try {
      await migrate(pool);
      const result = await pool.query<CanonicalRow>(
        "SELECT payload FROM woyengi_canonical_records ORDER BY workspace_id, ledger_sequence",
      );
      return new PostgresCanonicalLedger(pool, result.rows.map((row) => canonicalPayload<RecordType>(row.payload)));
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async append(record: RecordType): Promise<void> {
    return this.appendBatch([record]);
  }

  async appendBatch(records: readonly RecordType[]): Promise<void> {
    this.#assertOpen();
    const run = async (): Promise<void> => {
      const canonical = records.map((record) => {
        if (record.ledgerSequence !== undefined) throw new Error("ledger sequence is assigned by durable storage");
        return structuredClone(record);
      });
      const identifiers = new Set<string>();
      for (const record of canonical) {
        if (identifiers.has(record.id) || this.#records.has(record.id)) {
          throw new Error(`canonical record already exists: ${record.id}`);
        }
        identifiers.add(record.id);
      }
      if (canonical.length === 0) return;

      const client = await this.#pool.connect();
      let stored: RecordType[] = [];
      try {
        await client.query("BEGIN");
        stored = await assignSequences(client, canonical);
        for (const record of stored) {
          await client.query(
            `INSERT INTO woyengi_canonical_records
              (record_id, workspace_id, kind, ledger_sequence, transaction_time, payload)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
              record.id,
              workspaceScope(record),
              record.kind,
              record.ledgerSequence,
              normalizeInstant(record.transactionTime.from),
              JSON.stringify(record),
            ],
          );
          if (record.kind === "idempotency-result") await insertIdempotency(client, record);
        }
        await client.query("COMMIT");
      } catch (error) {
        await rollback(client, error);
        throw translatePostgresError(error, canonical);
      } finally {
        client.release();
      }
      for (const record of stored) this.#records.set(record.id, immutableRecord(record));
    };
    const result = this.#writeQueue.then(run);
    this.#writeQueue = result.catch(() => undefined);
    return result;
  }

  get(id: string): RecordType | undefined {
    this.#assertOpen();
    return this.#records.get(id);
  }

  query(query: LedgerQuery = {}): readonly RecordType[] {
    this.#assertOpen();
    const from = query.from === undefined ? undefined : normalizeInstant(query.from);
    const until = query.until === undefined ? undefined : normalizeInstant(query.until);
    const kinds = query.kinds === undefined ? undefined : new Set(query.kinds);
    return Object.freeze(
      [...this.#records.values()]
        .filter((record) => kinds === undefined || kinds.has(record.kind))
        .filter((record) => from === undefined || record.transactionTime.from >= from)
        .filter((record) => until === undefined || record.transactionTime.from <= until)
        .sort(compareRecords),
    );
  }

  async ready(): Promise<boolean> {
    this.#assertOpen();
    try {
      await this.#pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#writeQueue;
    await this.#pool.end();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("PostgreSQL canonical ledger is closed");
  }
}

async function migrate(pool: Pool): Promise<void> {
  const migration = await readFile(new URL("../../../migrations/0001-postgres-canonical.sql", import.meta.url), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [1_467_569_444]);
    await client.query(migration);
    await client.query("COMMIT");
  } catch (error) {
    await rollback(client, error);
    throw error;
  } finally {
    client.release();
  }
}

async function assignSequences<RecordType extends LedgerRecord>(
  client: PoolClient,
  records: readonly RecordType[],
): Promise<RecordType[]> {
  const byWorkspace = new Map<string, RecordType[]>();
  for (const record of records) {
    const workspace = workspaceScope(record);
    const values = byWorkspace.get(workspace) ?? [];
    values.push(record);
    byWorkspace.set(workspace, values);
  }

  const stored: RecordType[] = [];
  for (const workspace of [...byWorkspace.keys()].sort()) {
    const values = byWorkspace.get(workspace) as RecordType[];
    await client.query(
      "INSERT INTO woyengi_workspace_sequences (workspace_id, next_sequence) VALUES ($1, 1) ON CONFLICT (workspace_id) DO NOTHING",
      [workspace],
    );
    const locked = await client.query<SequenceRow>(
      "SELECT next_sequence FROM woyengi_workspace_sequences WHERE workspace_id = $1 FOR UPDATE",
      [workspace],
    );
    const first = Number(locked.rows[0]?.next_sequence);
    if (!Number.isSafeInteger(first) || first < 1) throw new Error(`invalid PostgreSQL ledger sequence for ${workspace}`);
    values.forEach((record, index) => stored.push({ ...record, ledgerSequence: first + index }));
    await client.query(
      "UPDATE woyengi_workspace_sequences SET next_sequence = $2 WHERE workspace_id = $1",
      [workspace, first + values.length],
    );
  }
  return stored;
}

async function insertIdempotency(client: PoolClient, record: LedgerRecord): Promise<void> {
  const value = record as LedgerRecord & Readonly<Record<string, StateValue>>;
  const principal = requiredString(value.principal, "idempotency principal");
  const family = requiredString(value.family, "idempotency family");
  const key = requiredString(value.key, "idempotency key");
  const fingerprint = requiredString(value.fingerprint, "idempotency fingerprint");
  const result = value.result ?? null;
  await client.query(
    `INSERT INTO woyengi_idempotency_results
      (idempotency_id, workspace_id, principal_id, family, idempotency_key, fingerprint, result, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [record.id, workspaceScope(record), principal, family, key, fingerprint, JSON.stringify(result), normalizeInstant(record.transactionTime.from)],
  );
}

async function rollback(client: PoolClient, originalError: unknown): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    if (originalError === undefined) throw new Error("PostgreSQL rollback failed");
  }
}

function translatePostgresError(error: unknown, records: readonly LedgerRecord[]): unknown {
  if (postgresCode(error) !== "23505") return error;
  const constraint = postgresConstraint(error);
  if (constraint === "woyengi_idempotency_results_principal_id_family_idempotency_key_key") {
    const record = records.find((candidate) => candidate.kind === "idempotency-result");
    return new IdempotencyConflictError(record?.id ?? "unknown");
  }
  const identifier = records.find((record) => postgresDetail(error).includes(`(${record.id})`))?.id ?? records[0]?.id ?? "unknown";
  return new Error(`canonical record already exists: ${identifier}`);
}

function poolConfig(options: PostgresCanonicalLedgerOptions): PoolConfig {
  const connectionString = requiredText("PostgreSQL connection string", options.connectionString);
  const maximum = options.maximumConnections ?? 10;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 100) {
    throw new TypeError("maximum PostgreSQL connections must be an integer from 1 through 100");
  }
  return { connectionString, max: maximum, application_name: "woyengi-platform" };
}

function canonicalPayload<RecordType extends LedgerRecord>(value: unknown): RecordType {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("PostgreSQL canonical payload must be an object");
  const record = value as Partial<LedgerRecord>;
  if (typeof record.id !== "string" || typeof record.kind !== "string" || record.transactionTime === undefined) {
    throw new Error("PostgreSQL canonical payload is invalid");
  }
  if (!Number.isSafeInteger(record.ledgerSequence) || (record.ledgerSequence ?? 0) < 1) {
    throw new Error(`invalid PostgreSQL ledger sequence for ${record.id}`);
  }
  return immutableRecord(value as RecordType);
}

function immutableRecord<RecordType extends LedgerRecord>(record: RecordType): RecordType {
  return deepFreeze(structuredClone(record));
}

function compareRecords(left: LedgerRecord, right: LedgerRecord): number {
  const leftWorkspace = workspaceScope(left);
  const rightWorkspace = workspaceScope(right);
  if (leftWorkspace === rightWorkspace && left.ledgerSequence !== undefined && right.ledgerSequence !== undefined) {
    return left.ledgerSequence - right.ledgerSequence;
  }
  return leftWorkspace.localeCompare(rightWorkspace)
    || left.transactionTime.from.localeCompare(right.transactionTime.from)
    || left.id.localeCompare(right.id);
}

function workspaceScope(record: LedgerRecord): string {
  return record.workspaceId ?? "workspace:legacy-global";
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return date.toISOString();
}

function requiredString(value: StateValue | undefined, name: string): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  return requiredText(name, value);
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function postgresConstraint(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "constraint" in error && typeof error.constraint === "string" ? error.constraint : undefined;
}

function postgresDetail(error: unknown): string {
  return typeof error === "object" && error !== null && "detail" in error && typeof error.detail === "string" ? error.detail : "";
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
