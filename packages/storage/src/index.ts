import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { StateValue } from "../../core/src/index.ts";
import type { LedgerQuery, LedgerRecord } from "../../ledger/src/index.ts";

export interface DurableLedgerPort<RecordType extends LedgerRecord = LedgerRecord> {
  append(record: RecordType): Promise<void>;
  get(id: string): RecordType | undefined;
  query(query?: LedgerQuery): readonly RecordType[];
}

export interface ObjectStorePort {
  put(contentHash: string, bytes: Uint8Array): Promise<void>;
  get(contentHash: string): Promise<Uint8Array | undefined>;
}

export interface GraphStorePort<Node = unknown, Edge = unknown> {
  replace(graphId: string, nodes: readonly Node[], edges: readonly Edge[]): Promise<void>;
}

export interface SearchIndexPort<Document = unknown> {
  replace(indexId: string, documents: readonly Document[]): Promise<void>;
  search(indexId: string, query: string): Promise<readonly string[]>;
}

export interface VectorIndexPort<Vector = readonly number[]> {
  replace(indexId: string, vectors: Readonly<Record<string, Vector>>): Promise<void>;
  nearest(indexId: string, vector: Vector, limit: number): Promise<readonly string[]>;
}

export interface CachePort<Value = unknown> {
  get(key: string): Promise<Value | undefined>;
  set(key: string, value: Value, expiresAt?: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface IdempotencyEntry {
  readonly key: string;
  readonly fingerprint: string;
  readonly result: StateValue;
  readonly recordedAt: string;
}

export class IdempotencyConflictError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`idempotency key was already used with a different request: ${key}`);
    this.name = "IdempotencyConflictError";
    this.key = key;
  }
}

export class LocalIdempotencyStore {
  readonly #path: string;
  readonly #entries = new Map<string, IdempotencyEntry>();
  #writeQueue: Promise<void> = Promise.resolve();

  private constructor(path: string, entries: readonly IdempotencyEntry[]) {
    this.#path = path;
    for (const entry of entries) {
      const normalized = normalizeIdempotencyEntry(entry);
      if (this.#entries.has(normalized.key)) throw new Error(`duplicate idempotency key: ${normalized.key}`);
      this.#entries.set(normalized.key, normalized);
    }
  }

  static async open(path: string): Promise<LocalIdempotencyStore> {
    return new LocalIdempotencyStore(path, await readJsonArray<IdempotencyEntry>(path, "idempotency store"));
  }

  get(key: string): IdempotencyEntry | undefined {
    return this.#entries.get(requiredText("idempotency key", key));
  }

  async put(entry: IdempotencyEntry): Promise<IdempotencyEntry> {
    const normalized = normalizeIdempotencyEntry(entry);
    let stored = normalized;
    const run = async (): Promise<void> => {
      const existing = this.#entries.get(normalized.key);
      if (existing !== undefined) {
        if (existing.fingerprint !== normalized.fingerprint) throw new IdempotencyConflictError(normalized.key);
        stored = existing;
        return;
      }
      const next = [...this.#entries.values(), normalized].sort((left, right) => left.key.localeCompare(right.key));
      await atomicWriteJson(this.#path, next);
      this.#entries.set(normalized.key, normalized);
    };
    const result = this.#writeQueue.then(run);
    this.#writeQueue = result.catch(() => undefined);
    await result;
    return stored;
  }
}

export class LocalCanonicalLedger<RecordType extends LedgerRecord = LedgerRecord>
  implements DurableLedgerPort<RecordType>
{
  readonly #path: string;
  readonly #records = new Map<string, RecordType>();
  readonly #nextSequenceByWorkspace = new Map<string, number>();
  #writeQueue: Promise<void> = Promise.resolve();

  private constructor(path: string, records: readonly RecordType[]) {
    this.#path = path;
    for (const rawRecord of records) {
      const workspace = workspaceScope(rawRecord);
      const previous = this.#nextSequenceByWorkspace.get(workspace) ?? 0;
      const sequence = rawRecord.ledgerSequence ?? previous + 1;
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence <= previous) {
        throw new Error(`invalid ledger sequence for ${rawRecord.id}`);
      }
      const record = deepFreeze({ ...structuredClone(rawRecord), ledgerSequence: sequence }) as RecordType;
      if (this.#records.has(record.id)) throw new Error(`canonical record already exists: ${record.id}`);
      this.#records.set(record.id, record);
      this.#nextSequenceByWorkspace.set(workspace, sequence);
    }
  }

  static async open<RecordType extends LedgerRecord = LedgerRecord>(
    path: string,
  ): Promise<LocalCanonicalLedger<RecordType>> {
    const records = await readJsonRecords<RecordType>(path);
    return new LocalCanonicalLedger(path, records);
  }

  async append(record: RecordType): Promise<void> {
    return this.appendBatch([record]);
  }

  async appendBatch(records: readonly RecordType[]): Promise<void> {
    const run = async (): Promise<void> => {
      const nextSequences = new Map(this.#nextSequenceByWorkspace);
      const stored = records.map((record) => {
        if (record.ledgerSequence !== undefined) throw new Error("ledger sequence is assigned by durable storage");
        const workspace = workspaceScope(record);
        const sequence = (nextSequences.get(workspace) ?? 0) + 1;
        nextSequences.set(workspace, sequence);
        return deepFreeze({ ...structuredClone(record), ledgerSequence: sequence }) as RecordType;
      });
      const ids = new Set<string>();
      for (const record of stored) {
        if (this.#records.has(record.id) || ids.has(record.id)) {
          throw new Error(`canonical record already exists: ${record.id}`);
        }
        ids.add(record.id);
      }
      if (stored.length === 0) return;
      const next = [...this.#records.values(), ...stored].sort(compareRecords);
      await atomicWriteJson(this.#path, next);
      for (const record of stored) this.#records.set(record.id, record);
      for (const [workspace, sequence] of nextSequences) this.#nextSequenceByWorkspace.set(workspace, sequence);
    };
    const result = this.#writeQueue.then(run);
    this.#writeQueue = result.catch(() => undefined);
    return result;
  }

  get(id: string): RecordType | undefined {
    return this.#records.get(id);
  }

  query(query: LedgerQuery = {}): readonly RecordType[] {
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
}

export class LocalObjectStore implements ObjectStorePort {
  readonly #root: string;

  private constructor(root: string) {
    this.#root = root;
  }

  static async open(root: string): Promise<LocalObjectStore> {
    await mkdir(root, { recursive: true });
    return new LocalObjectStore(root);
  }

  async put(contentHash: string, bytes: Uint8Array): Promise<void> {
    const expected = normalizeHash(contentHash);
    const actual = sha256(bytes);
    if (actual !== expected) throw new Error(`content hash mismatch: expected ${expected}, received ${actual}`);
    const path = this.#path(expected);
    await mkdir(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    await writeFile(temporary, bytes, { flag: "wx" });
    try {
      await rename(temporary, path);
    } catch (error) {
      const existing = await this.get(expected);
      if (existing === undefined || sha256(existing) !== expected) throw error;
    }
  }

  async get(contentHash: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(this.#path(normalizeHash(contentHash))));
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  #path(contentHash: string): string {
    const digest = contentHash.slice("sha256:".length);
    return join(this.#root, digest.slice(0, 2), digest.slice(2));
  }
}

export function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readJsonRecords<RecordType extends LedgerRecord>(path: string): Promise<RecordType[]> {
  return readJsonArray<RecordType>(path, "local ledger");
}

async function readJsonArray<Value>(path: string, name: string): Promise<Value[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) throw new Error(`${name} must contain a JSON array`);
    return parsed as Value[];
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function normalizeIdempotencyEntry(value: IdempotencyEntry): IdempotencyEntry {
  return deepFreeze({
    key: requiredText("idempotency key", value.key),
    fingerprint: normalizeHash(value.fingerprint),
    result: structuredClone(value.result),
    recordedAt: normalizeInstant(value.recordedAt),
  });
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
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

function normalizeHash(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) throw new TypeError("content hash must be a sha256 digest");
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

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export { PostgresCanonicalLedger, type PostgresCanonicalLedgerOptions } from "./postgres.ts";
