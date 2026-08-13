import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const REQUIRED_PLATFORM_MODULES = ["event", "ingestion", "policy", "reconstruction", "state", "sync", "verification"] as const;
export type PlatformModuleName = typeof REQUIRED_PLATFORM_MODULES[number];

export interface PlatformModuleContract {
  readonly name: PlatformModuleName;
  readonly contractVersion: string;
  readonly execute: (operation: string, input: unknown) => Promise<unknown>;
}

export class ModularPlatformRuntime {
  readonly #modules: ReadonlyMap<PlatformModuleName, PlatformModuleContract>;

  private constructor(modules: ReadonlyMap<PlatformModuleName, PlatformModuleContract>) {
    this.#modules = modules;
  }

  static compose(input: Partial<Record<PlatformModuleName, PlatformModuleContract>>): ModularPlatformRuntime {
    const modules = new Map<PlatformModuleName, PlatformModuleContract>();
    for (const name of REQUIRED_PLATFORM_MODULES) {
      const module = input[name];
      if (module === undefined) throw new Error(`required platform module is missing: ${name}`);
      if (module.name !== name) throw new Error(`module boundary mismatch: expected ${name}, received ${module.name}`);
      semanticVersion(module.contractVersion);
      modules.set(name, module);
    }
    return new ModularPlatformRuntime(modules);
  }

  invoke(name: PlatformModuleName, operation: string, input: unknown): Promise<unknown> {
    return (this.#modules.get(name) as PlatformModuleContract).execute(requiredText("module operation", operation), input);
  }

  boundaries(): readonly { readonly name: PlatformModuleName; readonly contractVersion: string; readonly transport: "in-process" }[] {
    return Object.freeze(REQUIRED_PLATFORM_MODULES.map((name) => ({ name, contractVersion: (this.#modules.get(name) as PlatformModuleContract).contractVersion, transport: "in-process" as const })));
  }
}

export type JobStatus = "queued" | "running" | "retryable" | "completed" | "failed";
export interface WorkerJob {
  readonly id: string;
  readonly type: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly result?: unknown;
  readonly lastError?: string;
}

export interface JobStore {
  get(id: string): WorkerJob | undefined;
  findByIdempotencyKey(key: string): WorkerJob | undefined;
  save(job: WorkerJob): void;
  nextRunnable(): WorkerJob | undefined;
}

export class InMemoryJobStore implements JobStore {
  readonly #jobs = new Map<string, WorkerJob>();
  get(id: string): WorkerJob | undefined { return this.#jobs.get(id); }
  findByIdempotencyKey(key: string): WorkerJob | undefined { return [...this.#jobs.values()].find((job) => job.idempotencyKey === key); }
  save(job: WorkerJob): void { this.#jobs.set(job.id, deepFreeze(structuredClone(job))); }
  nextRunnable(): WorkerJob | undefined { return this.all().find((job) => job.status === "queued" || job.status === "retryable"); }
  all(): readonly WorkerJob[] { return Object.freeze([...this.#jobs.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))); }
}

export class LocalJobStore implements JobStore {
  readonly #path: string;
  readonly #jobs = new Map<string, WorkerJob>();

  private constructor(path: string, jobs: readonly WorkerJob[]) {
    this.#path = path;
    for (const job of jobs) {
      if (this.#jobs.has(job.id)) throw new Error(`duplicate durable job: ${job.id}`);
      this.#jobs.set(job.id, deepFreeze(job));
    }
  }

  static open(path: string): LocalJobStore {
    let jobs: WorkerJob[] = [];
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("durable job store must contain a JSON array");
      jobs = parsed as WorkerJob[];
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    return new LocalJobStore(path, jobs);
  }

  get(id: string): WorkerJob | undefined { return this.#jobs.get(id); }
  findByIdempotencyKey(key: string): WorkerJob | undefined { return this.all().find((job) => job.idempotencyKey === key); }
  nextRunnable(): WorkerJob | undefined { return this.all().find((job) => job.status === "queued" || job.status === "retryable"); }
  all(): readonly WorkerJob[] { return Object.freeze([...this.#jobs.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))); }
  save(job: WorkerJob): void {
    const stored = deepFreeze(structuredClone(job));
    const records = [...this.#jobs.values()].filter((item) => item.id !== stored.id).concat(stored).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    mkdirSync(dirname(this.#path), { recursive: true });
    const temporary = join(dirname(this.#path), `.${basename(this.#path)}.${randomUUID()}.tmp`);
    writeFileSync(temporary, `${JSON.stringify(records)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, this.#path);
    this.#jobs.set(stored.id, stored);
  }
}

export interface WorkerEvent {
  readonly topic: "job.queued" | "job.started" | "job.retryable" | "job.completed" | "job.failed";
  readonly jobId: string;
  readonly jobType: string;
  readonly attempts: number;
  readonly recordedAt: string;
}

export class PlatformWorker {
  readonly #store: JobStore;
  readonly #handlers: Readonly<Record<string, (payload: unknown) => Promise<unknown>>>;
  readonly #publish: (event: WorkerEvent) => Promise<void>;

  constructor(input: { readonly store: JobStore; readonly handlers: Readonly<Record<string, (payload: unknown) => Promise<unknown>>>; readonly publish: (event: WorkerEvent) => Promise<void> }) {
    this.#store = input.store;
    this.#handlers = input.handlers;
    this.#publish = input.publish;
  }

  async enqueue(input: { readonly id: string; readonly type: string; readonly idempotencyKey: string; readonly payload: unknown; readonly maxAttempts: number; readonly recordedAt: string }): Promise<WorkerJob> {
    const key = requiredText("idempotency key", input.idempotencyKey);
    const existing = this.#store.findByIdempotencyKey(key);
    if (existing !== undefined) return existing;
    const id = namespaced("job id", input.id);
    if (this.#store.get(id) !== undefined) throw new Error(`job already exists: ${id}`);
    if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 25) throw new TypeError("maxAttempts must be an integer from 1 through 25");
    const recordedAt = normalizeInstant(input.recordedAt);
    const job = deepFreeze({ id, type: requiredText("job type", input.type), idempotencyKey: key, payload: structuredClone(input.payload), status: "queued" as const, attempts: 0, maxAttempts: input.maxAttempts, createdAt: recordedAt, updatedAt: recordedAt });
    this.#store.save(job);
    await this.#emit("job.queued", job, recordedAt);
    return job;
  }

  async runNext(recordedAtValue: string): Promise<WorkerJob | undefined> {
    const recordedAt = normalizeInstant(recordedAtValue);
    const queued = this.#store.nextRunnable();
    if (queued === undefined) return undefined;
    const handler = this.#handlers[queued.type];
    if (handler === undefined) throw new Error(`worker handler is not registered: ${queued.type}`);
    const running: WorkerJob = { ...queued, status: "running", attempts: queued.attempts + 1, updatedAt: recordedAt };
    this.#store.save(running);
    await this.#emit("job.started", running, recordedAt);
    try {
      const result = await handler(structuredClone(running.payload));
      const completed: WorkerJob = { ...running, status: "completed", result: structuredClone(result), updatedAt: recordedAt };
      this.#store.save(completed);
      await this.#emit("job.completed", completed, recordedAt);
      return completed;
    } catch (error) {
      const status = running.attempts < running.maxAttempts ? "retryable" : "failed";
      const failed: WorkerJob = { ...running, status, lastError: safeError(error), updatedAt: recordedAt };
      this.#store.save(failed);
      await this.#emit(status === "retryable" ? "job.retryable" : "job.failed", failed, recordedAt);
      return failed;
    }
  }

  async #emit(topic: WorkerEvent["topic"], job: WorkerJob, recordedAt: string): Promise<void> {
    await this.#publish(deepFreeze({ topic, jobId: job.id, jobType: job.type, attempts: job.attempts, recordedAt }));
  }
}

function safeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : "unknown worker failure"; }
function isMissing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
function semanticVersion(value: string): string { const normalized = requiredText("contract version", value); if (!/^\d+\.\d+\.\d+$/.test(normalized)) throw new TypeError("contract version must be semantic"); return normalized; }
function namespaced(name: string, value: string): string { const normalized = requiredText(name, value); if (!normalized.includes(":")) throw new TypeError(`${name} must be namespace-qualified`); return normalized; }
function requiredText(name: string, value: string): string { const normalized = value.trim(); if (normalized.length === 0) throw new TypeError(`${name} must not be empty`); return normalized; }
function normalizeInstant(value: string): string { if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`); const date = new Date(value); if (Number.isNaN(date.getTime())) throw new TypeError(`invalid timestamp: ${value}`); return date.toISOString(); }
function deepFreeze<Value>(value: Value): Value { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const nested of Object.values(value)) deepFreeze(nested); Object.freeze(value); } return value; }
