import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { StateValue } from "../../core/src/index.ts";
import { LocalCanonicalLedger } from "../../storage/src/index.ts";

export interface PlatformEvent {
  readonly id: string;
  readonly kind: "platform-event";
  readonly workspaceId?: string;
  readonly ledgerSequence?: number;
  readonly topic: string;
  readonly aggregateId: string;
  readonly causedBy: string;
  readonly payload: StateValue;
  readonly transactionTime: { readonly from: string };
}

export interface Subscription {
  readonly id: string;
  readonly topicPrefixes: readonly string[];
}

export interface EventDelivery {
  readonly deliveryId: string;
  readonly subscriptionId: string;
  readonly event: PlatformEvent;
}

export function createPlatformEvent(input: {
  readonly id: string;
  readonly topic: string;
  readonly aggregateId: string;
  readonly causedBy: string;
  readonly payload: StateValue;
  readonly recordedAt: string;
}): PlatformEvent {
  return deepFreeze({
    id: prefixed("platform event id", input.id, "platform-event:"),
    kind: "platform-event" as const,
    topic: dotted("event topic", input.topic),
    aggregateId: namespaced("aggregate id", input.aggregateId),
    causedBy: namespaced("causedBy", input.causedBy),
    payload: input.payload,
    transactionTime: { from: normalizeInstant(input.recordedAt) },
  });
}

export class LocalEventBus {
  readonly #ledger: LocalCanonicalLedger<PlatformEvent>;
  readonly #cursorPath: string;
  readonly #cursors: Map<string, string>;
  #cursorQueue: Promise<void> = Promise.resolve();

  private constructor(
    ledger: LocalCanonicalLedger<PlatformEvent>,
    cursorPath: string,
    cursors: Readonly<Record<string, string>>,
  ) {
    this.#ledger = ledger;
    this.#cursorPath = cursorPath;
    this.#cursors = new Map(Object.entries(cursors));
  }

  static async open(root: string): Promise<LocalEventBus> {
    await mkdir(root, { recursive: true });
    const ledger = await LocalCanonicalLedger.open<PlatformEvent>(join(root, "events.json"));
    const cursorPath = join(root, "cursors.json");
    const cursors = await readCursors(cursorPath);
    return new LocalEventBus(ledger, cursorPath, cursors);
  }

  async publish(event: PlatformEvent): Promise<void> {
    await this.#ledger.append(event);
  }

  async pending(subscription: Subscription): Promise<readonly EventDelivery[]> {
    const normalized = normalizeSubscription(subscription);
    const all = this.#ledger.query();
    const cursor = this.#cursors.get(normalized.id);
    const afterSequence = cursor === undefined
      ? 0
      : /^\d+$/.test(cursor)
        ? Number(cursor)
        : all.find((event) => event.id === cursor)?.ledgerSequence ?? -1;
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error(`event cursor is invalid for ${normalized.id}`);
    const candidates = all
      .filter((event) => (event.ledgerSequence ?? 0) > afterSequence)
      .filter((event) => normalized.topicPrefixes.some((prefix) => event.topic.startsWith(prefix)))
      .map((event) => delivery(normalized.id, event));
    return Object.freeze(candidates);
  }

  async consume(
    subscription: Subscription,
    handler: (delivery: EventDelivery) => Promise<void>,
  ): Promise<void> {
    const normalized = normalizeSubscription(subscription);
    for (const item of await this.pending(normalized)) {
      await handler(item);
      const sequence = item.event.ledgerSequence;
      if (sequence === undefined) throw new Error(`event has no causal ledger sequence: ${item.event.id}`);
      await this.#commitCursor(normalized.id, String(sequence));
    }
  }

  async #commitCursor(subscriptionId: string, eventId: string): Promise<void> {
    const run = async (): Promise<void> => {
      const next = Object.fromEntries(this.#cursors);
      next[subscriptionId] = eventId;
      await atomicWrite(this.#cursorPath, next);
      this.#cursors.set(subscriptionId, eventId);
    };
    const result = this.#cursorQueue.then(run);
    this.#cursorQueue = result.catch(() => undefined);
    return result;
  }
}

function normalizeSubscription(value: Subscription): Subscription {
  const prefixes = [...new Set(value.topicPrefixes.map((prefix) => requiredText("topic prefix", prefix)))].sort();
  if (prefixes.length === 0) throw new TypeError("subscription topicPrefixes must not be empty");
  return { id: prefixed("subscription id", value.id, "subscription:"), topicPrefixes: prefixes };
}

function delivery(subscriptionId: string, event: PlatformEvent): EventDelivery {
  return deepFreeze({
    deliveryId: `delivery:${encodeURIComponent(subscriptionId)}:${encodeURIComponent(event.id)}`,
    subscriptionId,
    event,
  });
}

async function readCursors(path: string): Promise<Readonly<Record<string, string>>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("event cursors must be a JSON object");
    }
    return parsed as Record<string, string>;
  } catch (error) {
    if (isMissing(error)) return {};
    throw error;
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
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
function dotted(name: string, value: string): string {
  const normalized = requiredText(name, value);
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(normalized)) {
    throw new TypeError(`${name} must use dotted lower-case segments`);
  }
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
