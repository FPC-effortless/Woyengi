import { createPlatformEvent, type PlatformEvent } from "../../event-bus/src/index.ts";
import { sha256 } from "../../storage/src/index.ts";

export type IngestionSourceKind =
  | "document"
  | "application-event"
  | "api-payload"
  | "agent-proposal"
  | "human-action";

export interface IngestionStoragePolicy {
  readonly locality: "local-only" | "cloud-allowed" | "cloud-required" | "ephemeral";
  readonly allowedRegions: readonly string[];
  readonly allowedAgents: readonly string[];
  readonly encryption: string;
}

export interface IngestionEnvelope {
  readonly id: string;
  readonly kind: "ingestion-envelope";
  readonly idempotencyKey: string;
  readonly source: {
    readonly kind: IngestionSourceKind;
    readonly id: string;
    readonly principal: string;
  };
  readonly mediaType: string;
  readonly contentHash: string;
  readonly storageLocator: string;
  readonly storagePolicy: IngestionStoragePolicy;
  readonly lifecycle: "provisional";
  readonly transactionTime: { readonly from: string };
}

export interface IngestionReceipt {
  readonly envelope: IngestionEnvelope;
  readonly duplicate: boolean;
}

export interface IngestionPorts {
  readonly append: (record: IngestionEnvelope) => Promise<void>;
  readonly put: (hash: string, bytes: Uint8Array) => Promise<void>;
  readonly publish: (event: PlatformEvent) => Promise<void>;
}

export class IngestionFabric {
  readonly #ports: IngestionPorts;
  readonly #receipts = new Map<string, IngestionEnvelope>();
  readonly #inFlight = new Map<string, Promise<IngestionReceipt>>();

  constructor(ports: IngestionPorts) {
    this.#ports = ports;
  }

  async ingest(input: {
    readonly id: string;
    readonly idempotencyKey: string;
    readonly source: IngestionEnvelope["source"];
    readonly mediaType: string;
    readonly content: Uint8Array;
    readonly storagePolicy: IngestionStoragePolicy;
    readonly recordedAt: string;
  }): Promise<IngestionReceipt> {
    const idempotencyKey = namespaced("idempotency key", input.idempotencyKey);
    const existing = this.#receipts.get(idempotencyKey);
    if (existing !== undefined) return deepFreeze({ envelope: existing, duplicate: true });
    const running = this.#inFlight.get(idempotencyKey);
    if (running !== undefined) {
      const receipt = await running;
      return deepFreeze({ envelope: receipt.envelope, duplicate: true });
    }
    const execution = this.#ingestNew(input, idempotencyKey);
    this.#inFlight.set(idempotencyKey, execution);
    try {
      return await execution;
    } finally {
      this.#inFlight.delete(idempotencyKey);
    }
  }

  async #ingestNew(
    input: {
      readonly id: string;
      readonly source: IngestionEnvelope["source"];
      readonly mediaType: string;
      readonly content: Uint8Array;
      readonly storagePolicy: IngestionStoragePolicy;
      readonly recordedAt: string;
    },
    idempotencyKey: string,
  ): Promise<IngestionReceipt> {
    const contentHash = sha256(input.content);
    const envelope = deepFreeze({
      id: prefixed("ingestion id", input.id, "ingestion:"),
      kind: "ingestion-envelope" as const,
      idempotencyKey,
      source: {
        kind: input.source.kind,
        id: namespaced("source id", input.source.id),
        principal: namespaced("source principal", input.source.principal),
      },
      mediaType: requiredText("media type", input.mediaType),
      contentHash,
      storageLocator: `object://${contentHash}`,
      storagePolicy: normalizePolicy(input.storagePolicy),
      lifecycle: "provisional" as const,
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    await this.#ports.put(contentHash, input.content);
    await this.#ports.append(envelope);
    await this.#ports.publish(
      createPlatformEvent({
        id: `platform-event:${envelope.id.slice("ingestion:".length)}-ingested`,
        topic: "ingestion.accepted",
        aggregateId: envelope.id,
        causedBy: idempotencyKey,
        payload: { envelopeId: envelope.id, sourceKind: envelope.source.kind },
        recordedAt: envelope.transactionTime.from,
      }),
    );
    this.#receipts.set(idempotencyKey, envelope);
    return deepFreeze({ envelope, duplicate: false });
  }
}

function normalizePolicy(value: IngestionStoragePolicy): IngestionStoragePolicy {
  return {
    locality: value.locality,
    allowedRegions: unique("allowed regions", value.allowedRegions),
    allowedAgents: unique("allowed agents", value.allowedAgents),
    encryption: requiredText("encryption policy", value.encryption),
  };
}
function unique(name: string, values: readonly string[]): string[] {
  const result = values.map((value) => requiredText(name, value));
  if (new Set(result).size !== result.length) throw new Error(`${name} must not contain duplicates`);
  return result.sort();
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
function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
