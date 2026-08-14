import { mkdir } from "node:fs/promises";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";

import { createLifecycleTransition, type CanonicalRecord, type ClaimRecord, type LifecycleTransitionRecord, type RecordKind, type StateValue } from "../../../packages/core/src/index.ts";
import { createPlatformEvent, type PlatformEvent } from "../../../packages/event-bus/src/index.ts";
import type { LedgerRecord } from "../../../packages/ledger/src/index.ts";
import { ClaimLedger } from "../../../packages/state/src/index.ts";
import { IdempotencyConflictError, LocalCanonicalLedger, LocalIdempotencyStore, sha256 } from "../../../packages/storage/src/index.ts";
import { createInProcessPlatformRuntime, IN_PROCESS_PLATFORM_OPERATIONS, type PlatformModuleName } from "../../runtime/index.ts";
import { PlatformApi, PlatformApiError } from "./index.ts";
import { createBearerAuthenticator, SlidingWindowRateLimiter } from "./security.ts";

const token = requiredEnvironment("WOYENGI_API_TOKEN");
const dataDirectory = resolve(process.env.WOYENGI_DATA_DIR ?? "./.woyengi-data");
await mkdir(dataDirectory, { recursive: true });
type StoredRecord = LedgerRecord & Readonly<Record<string, StateValue>>;
interface IngestInput { readonly principal: string; readonly idempotencyKey: string; readonly body: StateValue; readonly traceId: string }
interface StateInput { readonly principal: string; readonly entityId: string; readonly limit: number; readonly cursor?: string; readonly validAt: string; readonly recordedAt: string; readonly traceId: string }
interface ReconstructionInput { readonly principal: string; readonly body: StateValue; readonly traceId: string }
interface ControlInput { readonly principal: string; readonly action: string; readonly idempotencyKey: string; readonly body: StateValue; readonly traceId: string }
interface SubscriptionInput { readonly principal: string; readonly subscriptionId: string; readonly limit: number; readonly cursor?: string; readonly traceId: string }
const ledger = await LocalCanonicalLedger.open<StoredRecord>(join(dataDirectory, "ledger", "records.json"));
const idempotency = await LocalIdempotencyStore.open(join(dataDirectory, "idempotency", "requests.json"));
const inFlight = new Map<string, { readonly fingerprint: string; readonly promise: Promise<StateValue> }>();
const authenticate = createBearerAuthenticator({ token, principal: "user:local-operator" });
const rateLimiter = new SlidingWindowRateLimiter({ maximumRequests: numericEnvironment("WOYENGI_RATE_LIMIT_PER_MINUTE", 120), windowMilliseconds: 60_000, maximumKeys: 10_000 });
const localAuthorize = () => ({ allowed: true, rationale: "authenticated local operator" });
const runtime = createInProcessPlatformRuntime({
  event: async (input) => handleSubscribe(input as SubscriptionInput),
  ingestion: async (input) => handleIngest(input as IngestInput),
  policy: async () => localAuthorize(),
  reconstruction: async (input) => handleReconstruct(input as ReconstructionInput),
  state: async (input) => handleState(input as StateInput),
  sync: async () => ({ mode: "object-specific-merge-policies", locality: "local" }),
  verification: async (input) => handleControl(input as ControlInput),
});

const api = new PlatformApi({
  operational: dependencyStatus,
  rateLimit: (input) => rateLimiter.allow(input),
  authenticate,
  authorize: localAuthorize,
  ingest: (input) => invokeState("ingestion", input),
  state: (input) => invokeState("state", input),
  reconstruct: (input) => invokeState("reconstruction", input),
  control: (input) => invokeState("verification", input),
  subscribe: (input) => invokeState("event", input),
});

const server = await api.listen({ hostname: process.env.WOYENGI_HOST ?? "127.0.0.1", port: Number(process.env.WOYENGI_PORT ?? 8080) });
process.stdout.write(`Woyengi Platform API listening on ${server.url}\n`);
let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`Received ${signal}; closing Platform API.\n`);
  await server.close();
  process.exitCode = 0;
}
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length < 16) throw new Error(`${name} must be set to at least 16 characters`);
  return value;
}
function numericEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) throw new Error(`${name} must be a positive integer`);
  return numeric;
}
function asObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function asStateObject(value: StateValue, name: string): Readonly<Record<string, StateValue>> {
  if (value === null || typeof value !== "object" || isStateArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}
function isStateArray(value: StateValue): value is readonly StateValue[] { return Array.isArray(value); }
function asLedgerRecord(value: StateValue): StoredRecord {
  const object = asObject(value, "canonical record");
  if (typeof object.id !== "string" || typeof object.kind !== "string") throw new TypeError("canonical record requires string id and kind");
  const transactionTime = asObject(object.transactionTime, "transaction time");
  if (typeof transactionTime.from !== "string") throw new TypeError("canonical record requires transactionTime.from");
  return object as unknown as StoredRecord;
}

async function invokeState(module: PlatformModuleName, input: unknown): Promise<StateValue> {
  return await runtime.invoke(module, IN_PROCESS_PLATFORM_OPERATIONS[module], input) as StateValue;
}

async function handleIngest({ body, principal, idempotencyKey }: IngestInput): Promise<StateValue> {
  return idempotent({ principal, family: "ingest", key: idempotencyKey, body }, async () => {
    const object = asStateObject(body, "ingestion body");
    const records = Array.isArray(object.records) ? object.records : [object];
    const ids: string[] = [];
    for (const item of records) {
      const record = asLedgerRecord(item);
      await appendCanonical(record);
      await appendEvent(record, idempotencyKey);
      ids.push(record.id);
    }
    return { accepted: ids };
  });
}

async function handleState({ entityId, limit, cursor, validAt, recordedAt }: StateInput): Promise<StateValue> {
  return entityState(entityId, limit, cursor, validAt, recordedAt);
}

async function handleReconstruct({ body, principal, traceId }: ReconstructionInput): Promise<StateValue> {
  const object = asStateObject(body, "reconstruction body");
  const subject = typeof object.subject === "string" ? object.subject : undefined;
  const now = new Date().toISOString();
  const asOf = object.asOf ?? object.as_of;
  const sharedAsOf = asOf === "now" || asOf === undefined ? now : requestInstant(asOf, "asOf");
  const validAt = object.validAt === undefined ? sharedAsOf : requestInstant(object.validAt, "validAt");
  const recordedAt = object.recordedAt === undefined ? sharedAsOf : requestInstant(object.recordedAt, "recordedAt");
  const records = relevantRecords(subject).filter((record) => record.transactionTime.from <= recordedAt);
  const projections = subject === undefined ? [] : projectClaims(subject, validAt, recordedAt);
  const selected = projections.flatMap((projection) => projection.selected === undefined ? [] : [projection.selected.claim]);
  const contradictions = projections.flatMap((projection) => projection.conflicts.map((conflict) => conflict.claim));
  const evidence = records.filter((record) => record.kind === "evidence");
  const events = records.filter((record) => record.kind === "event");
  const decisions = records.filter((record) => record.kind === "decision");
  const history = records.filter((record) => record.kind === "claim");
  const provenanceManifest = records.filter((record) => record.kind !== "platform-event").map((record) => record.id).sort();
  return {
    id: `reconstruction:${traceId.slice(traceId.indexOf(":") + 1)}`,
    kind: "reconstruction",
    transactionTime: { from: recordedAt },
    request: object.request ?? "",
    intent: object.intent ?? "reconstruct-state",
    principal,
    subjects: subject === undefined ? [] : [subject],
    currentState: selected,
    historicalState: history,
    relevantEvents: events,
    decisions,
    constraints: Array.isArray(object.constraints) ? object.constraints : [],
    procedures: [],
    evidence,
    contradictions,
    uncertainties: selected.length === 0 ? [{ reason: "no-governing-state" }] : [],
    authorityContext: { policy: "lifecycle-authority-valid-time-transaction-time-confidence" },
    permissionContext: { allowed: true, principal, rationale: "authenticated local operator" },
    provenanceManifest,
    recommendedContext: stableJson({ selected, contradictions, events, decisions }),
    trace: [
      { stage: "intent", detail: { subject: subject ?? null } },
      { stage: "permission", detail: { allowed: true } },
      { stage: "graph-activation", detail: { graphIds: ["graph:entity", "graph:evidence", "graph:temporal"] } },
      { stage: "retrieval", detail: { candidateCount: records.length } },
      { stage: "temporal-resolution", detail: { projectionCount: projections.length, validAt, recordedAt } },
      { stage: "authority-resolution", detail: { selectedCount: selected.length } },
      { stage: "evidence-evaluation", detail: { evidenceCount: evidence.length, contradictionCount: contradictions.length } },
      { stage: "context-assembly", detail: { currentStateCount: selected.length, historicalStateCount: history.length } },
    ],
  } as unknown as StateValue;
}

async function handleControl({ action, principal, traceId, body, idempotencyKey }: ControlInput): Promise<StateValue> {
  return idempotent({ principal, family: `control:${action}`, key: idempotencyKey, body }, async () => {
    if (["verify", "supersede", "retract"].includes(action)) {
      const object = asStateObject(body, "control body");
      const targetId = requiredString(object.targetId, "control targetId");
      if (ledger.get(targetId) === undefined) throw new PlatformApiError(404, "TARGET_NOT_FOUND", `Control target ${targetId} does not exist.`);
      const record = createLifecycleTransition({
        id: requiredString(object.id, "lifecycle transition id"),
        targetId,
        status: action === "verify" ? "verified" : action === "supersede" ? "superseded" : "retracted",
        reason: requiredString(object.reason, "control reason"),
        recordedAt: requiredString(object.recordedAt, "control recordedAt"),
        provenance: { derivedFrom: [{ kind: coreRecordKind(ledger.get(targetId)?.kind), id: targetId }], transformations: [`control:${action}`] },
        authority: { level: 100, basis: `authenticated local operator ${principal}` },
      }) as unknown as StoredRecord;
      await appendCanonical(record);
      await appendEvent(record, idempotencyKey);
      return { action, principal, traceId, accepted: true, record } as unknown as StateValue;
    }
    return { action, principal, traceId, accepted: true, proposal: body };
  });
}

async function handleSubscribe({ subscriptionId, limit, cursor }: SubscriptionInput): Promise<StateValue> {
  const events = ledger.query({ kinds: ["platform-event"] }).map((record) => record as unknown as PlatformEvent);
  const cursorIndex = cursor === undefined ? -1 : events.findIndex((event) => event.id === cursor);
  if (cursor !== undefined && cursorIndex < 0) throw new PlatformApiError(400, "INVALID_CURSOR", "Subscription cursor is not present in the event ledger.");
  const candidates = events.slice(cursorIndex + 1);
  const page = candidates.slice(0, limit);
  return { subscriptionId, events: page, nextCursor: candidates.length > page.length ? page.at(-1)?.id ?? null : null } as unknown as StateValue;
}

function entityState(entityId: string, limit: number, cursor: string | undefined, validAt: string, recordedAt: string): StateValue {
  const offset = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new PlatformApiError(400, "INVALID_CURSOR", "State cursor must be a non-negative integer offset.");
  const records = relevantRecords(entityId).filter((record) => record.transactionTime.from <= recordedAt);
  const page = records.slice(offset, offset + limit);
  return {
    entityId,
    records: page,
    projections: projectClaims(entityId, validAt, recordedAt),
    nextCursor: offset + page.length < records.length ? String(offset + page.length) : null,
  } as unknown as StateValue;
}

function relevantRecords(subject: string | undefined): StoredRecord[] {
  if (subject === undefined) return ledger.query().filter((record) => record.kind !== "platform-event");
  const direct = ledger.query().filter((record) => {
    if (record.kind === "platform-event") return false;
    if (record.id === subject || record.subject === subject) return true;
    if (Array.isArray(record.subjects) && record.subjects.includes(subject)) return true;
    if (record.fromEntityId === subject || record.toEntityId === subject) return true;
    if (Array.isArray(record.participants)) return record.participants.some((participant) => participant !== null && typeof participant === "object" && !Array.isArray(participant) && participant.entityId === subject);
    return false;
  });
  const referenced = new Set<string>(direct.flatMap((record) => [
    ...(Array.isArray(record.observationIds) ? record.observationIds.filter((id): id is string => typeof id === "string") : []),
    ...(Array.isArray(record.evidenceIds) ? record.evidenceIds.filter((id): id is string => typeof id === "string") : []),
  ]));
  return [...direct, ...ledger.query().filter((record) => referenced.has(record.id))]
    .filter((record, index, values) => values.findIndex((candidate) => candidate.id === record.id) === index)
    .sort((left, right) => left.transactionTime.from.localeCompare(right.transactionTime.from) || left.id.localeCompare(right.id));
}

function projectClaims(subject: string, validAt = new Date().toISOString(), recordedAt = new Date().toISOString()) {
  const claims = ledger.query().filter(isProjectableClaim);
  const claimIds = new Set<string>(claims.map((claim) => claim.id));
  const transitions = ledger.query().filter(isLifecycleTransition).filter((transition) => claimIds.has(transition.targetId));
  const replay = ClaimLedger.replay([...claims, ...transitions] as CanonicalRecord[]);
  const predicates = [...new Set(claims.filter((claim) => claim.subject === subject).map((claim) => claim.predicate))].sort();
  return predicates.map((predicate) => replay.projectAt({ subject, predicate, validAt, recordedAt }));
}

function isProjectableClaim(record: StoredRecord): record is StoredRecord & ClaimRecord {
  const validTime = record.validTime;
  const authority = record.authority;
  return record.kind === "claim"
    && typeof record.subject === "string"
    && typeof record.predicate === "string"
    && isStateObjectValue(validTime) && typeof validTime.from === "string"
    && isStateObjectValue(authority) && typeof authority.level === "number"
    && typeof record.confidence === "number"
    && typeof record.lifecycle === "string";
}

function isStateObjectValue(value: StateValue | undefined): value is Readonly<Record<string, StateValue>> {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

function isLifecycleTransition(record: StoredRecord): record is StoredRecord & LifecycleTransitionRecord {
  return record.kind === "lifecycle-transition" && typeof record.targetId === "string" && typeof record.status === "string";
}

function coreRecordKind(value: string | undefined): RecordKind {
  const kinds: readonly RecordKind[] = ["observation", "claim", "event", "relationship", "decision", "evidence", "authority-assessment", "lifecycle-transition", "artifact"];
  if (value === undefined || !kinds.includes(value as RecordKind)) throw new PlatformApiError(400, "INVALID_TARGET_KIND", "Control target is not a core canonical record kind.");
  return value as RecordKind;
}

function requiredString(value: StateValue | undefined, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new PlatformApiError(400, "INVALID_CONTROL", `${name} must be a non-empty string.`);
  return value.trim();
}

function requestInstant(value: StateValue, name: string): string {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new PlatformApiError(400, "INVALID_TIME", `${name} requires a timestamp with an explicit UTC offset.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new PlatformApiError(400, "INVALID_TIME", `${name} must be a valid timestamp.`);
  return date.toISOString();
}

async function idempotent(
  input: { readonly principal: string; readonly family: string; readonly key: string; readonly body: StateValue },
  execute: () => Promise<StateValue>,
): Promise<StateValue> {
  const key = `${input.principal}:${input.family}:${input.key}`;
  const fingerprint = sha256(new TextEncoder().encode(stableJson(input.body)));
  const existing = idempotency.get(key);
  if (existing !== undefined) {
    if (existing.fingerprint !== fingerprint) throw new PlatformApiError(409, "IDEMPOTENCY_CONFLICT", "The idempotency key was already used with a different request.");
    return existing.result;
  }
  const active = inFlight.get(key);
  if (active !== undefined) {
    if (active.fingerprint !== fingerprint) throw new PlatformApiError(409, "IDEMPOTENCY_CONFLICT", "The idempotency key is already processing a different request.");
    return active.promise;
  }
  const promise = (async () => {
    const result = await execute();
    try {
      return (await idempotency.put({ key, fingerprint, result, recordedAt: new Date().toISOString() })).result;
    } catch (error) {
      if (error instanceof IdempotencyConflictError) throw new PlatformApiError(409, "IDEMPOTENCY_CONFLICT", "The idempotency key was already used with a different request.");
      throw error;
    }
  })();
  inFlight.set(key, { fingerprint, promise });
  try { return await promise; } finally { inFlight.delete(key); }
}

async function appendCanonical(record: StoredRecord): Promise<void> {
  const existing = ledger.get(record.id);
  if (existing === undefined) {
    await ledger.append(record);
    return;
  }
  if (stableJson(existing) !== stableJson(record)) throw new PlatformApiError(409, "RECORD_CONFLICT", `Canonical record ${record.id} already exists with different content.`);
}

async function appendEvent(record: StoredRecord, causedBy: string): Promise<void> {
  const event = createPlatformEvent({
    id: `platform-event:record-created:${record.id}`,
    topic: `${topicSegment(record.kind)}.created`,
    aggregateId: record.id,
    causedBy: causedBy.includes(":") ? causedBy : `request:${causedBy}`,
    payload: { recordId: record.id, recordKind: record.kind },
    recordedAt: record.transactionTime.from,
  }) as unknown as StoredRecord;
  await appendCanonical(event);
}

function topicSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length === 0 || !/^[a-z]/.test(normalized) ? `record-${normalized || "unknown"}` : normalized;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function dependencyStatus(): Promise<{ readonly healthy: boolean; readonly ready: boolean; readonly checks: Readonly<Record<string, "up" | "down">> }> {
  const checks: Record<string, "up" | "down"> = { ledger: "up" };
  const postgres = process.env.WOYENGI_POSTGRES_URL;
  const objectStore = process.env.WOYENGI_OBJECT_STORE_ENDPOINT;
  const search = process.env.WOYENGI_SEARCH_ENDPOINT;
  if (postgres !== undefined) {
    try {
      const url = new URL(postgres);
      checks.database = await tcpAvailable(url.hostname, Number(url.port || 5432)) ? "up" : "down";
    } catch { checks.database = "down"; }
  }
  if (objectStore !== undefined) checks.objectStorage = await httpAvailable(`${objectStore.replace(/\/+$/, "")}/minio/health/live`) ? "up" : "down";
  if (search !== undefined) checks.search = await httpAvailable(`${search.replace(/\/+$/, "")}/health`) ? "up" : "down";
  return { healthy: true, ready: Object.values(checks).every((status) => status === "up"), checks };
}

async function httpAvailable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch { return false; }
}

async function tcpAvailable(host: string, port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return false;
  return await new Promise<boolean>((resolveConnection) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolveConnection(false); }, 1_500);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolveConnection(true); });
    socket.once("error", () => { clearTimeout(timer); resolveConnection(false); });
  });
}
