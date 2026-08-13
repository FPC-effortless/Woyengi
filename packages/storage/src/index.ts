import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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

export class LocalCanonicalLedger<RecordType extends LedgerRecord = LedgerRecord>
  implements DurableLedgerPort<RecordType>
{
  readonly #path: string;
  readonly #records = new Map<string, RecordType>();
  #writeQueue: Promise<void> = Promise.resolve();

  private constructor(path: string, records: readonly RecordType[]) {
    this.#path = path;
    for (const record of records) {
      if (this.#records.has(record.id)) throw new Error(`canonical record already exists: ${record.id}`);
      this.#records.set(record.id, deepFreeze(record));
    }
  }

  static async open<RecordType extends LedgerRecord = LedgerRecord>(
    path: string,
  ): Promise<LocalCanonicalLedger<RecordType>> {
    const records = await readJsonRecords<RecordType>(path);
    return new LocalCanonicalLedger(path, records);
  }

  async append(record: RecordType): Promise<void> {
    const run = async (): Promise<void> => {
      if (this.#records.has(record.id)) throw new Error(`canonical record already exists: ${record.id}`);
      const stored = deepFreeze(structuredClone(record));
      const next = [...this.#records.values(), stored].sort(compareRecords);
      await atomicWriteJson(this.#path, next);
      this.#records.set(stored.id, stored);
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
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("local ledger must contain a JSON array");
    return parsed as RecordType[];
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

function compareRecords(left: LedgerRecord, right: LedgerRecord): number {
  return left.transactionTime.from.localeCompare(right.transactionTime.from) || left.id.localeCompare(right.id);
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
