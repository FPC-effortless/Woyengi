import type { StateValue } from "../../core/src/index.ts";

export interface StoragePolicy {
  readonly locality: "local-only" | "cloud-allowed" | "cloud-required" | "ephemeral";
  readonly allowedDevices: readonly string[];
  readonly allowedRegions: readonly string[];
  readonly allowedAgents: readonly string[];
  readonly encryption: string;
  readonly retention: string;
  readonly expiresAt: string;
}

export interface SyncOperation {
  readonly id: string;
  readonly kind: "sync-operation";
  readonly objectId: string;
  readonly objectKind: string;
  readonly replicaId: string;
  readonly parents: readonly string[];
  readonly changes: Readonly<Record<string, StateValue>>;
  readonly storagePolicy: StoragePolicy;
  readonly transactionTime: { readonly from: string };
}

export type MergePolicy = "mergeable-map" | "authoritative";

export function defineStoragePolicy(input: StoragePolicy): StoragePolicy {
  return deepFreeze({
    locality: input.locality,
    allowedDevices: unique("allowed devices", input.allowedDevices),
    allowedRegions: unique("allowed regions", input.allowedRegions),
    allowedAgents: unique("allowed agents", input.allowedAgents),
    encryption: requiredText("encryption policy", input.encryption),
    retention: requiredText("retention policy", input.retention),
    expiresAt: normalizeInstant(input.expiresAt),
  });
}

export function createSyncOperation(input: {
  readonly id: string;
  readonly objectId: string;
  readonly objectKind: string;
  readonly replicaId: string;
  readonly parents: readonly string[];
  readonly changes: Readonly<Record<string, StateValue>>;
  readonly recordedAt: string;
  readonly storagePolicy: StoragePolicy;
}): SyncOperation {
  if (Object.keys(input.changes).length === 0) throw new TypeError("sync changes must not be empty");
  return deepFreeze({
    id: prefixed("sync operation id", input.id, "sync-op:"),
    kind: "sync-operation" as const,
    objectId: namespaced("sync object id", input.objectId),
    objectKind: requiredText("sync object kind", input.objectKind),
    replicaId: namespaced("replica id", input.replicaId),
    parents: unique("sync parents", input.parents.map((parent) => prefixed("sync parent", parent, "sync-op:"))),
    changes: sortedRecord(input.changes),
    storagePolicy: defineStoragePolicy(input.storagePolicy),
    transactionTime: { from: normalizeInstant(input.recordedAt) },
  });
}

export class SyncEngine {
  readonly #policies: Readonly<Record<string, MergePolicy>>;

  constructor(policies: Readonly<Record<string, MergePolicy>>) {
    this.#policies = { ...policies };
  }

  synchronize(
    input: readonly SyncOperation[],
    target: {
      readonly kind: "local" | "cloud";
      readonly deviceId: string;
      readonly region: string;
      readonly agentId: string;
      readonly at: string;
    },
  ) {
    const at = normalizeInstant(target.at);
    const accepted: SyncOperation[] = [];
    const rejected: { operationId: string; reason: string }[] = [];
    for (const operation of [...input].sort(compareOperations)) {
      const denial = policyDenial(operation.storagePolicy, target, at);
      if (denial === undefined) accepted.push(operation);
      else rejected.push({ operationId: operation.id, reason: denial });
    }
    const groups = new Map<string, SyncOperation[]>();
    for (const operation of accepted) {
      const group = groups.get(operation.objectId) ?? [];
      group.push(operation);
      groups.set(operation.objectId, group);
    }
    const objects: { id: string; kind: string; state: Readonly<Record<string, StateValue>>; operationIds: readonly string[] }[] = [];
    const conflicts: {
      objectId: string;
      objectKind: string;
      status: "requires-explicit-resolution";
      candidates: readonly string[];
    }[] = [];
    for (const [objectId, operations] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const kinds = new Set(operations.map((operation) => operation.objectKind));
      if (kinds.size !== 1) throw new Error(`object kind changed across synchronization history: ${objectId}`);
      const objectKind = operations[0]?.objectKind as string;
      const policy = this.#policies[objectKind];
      if (policy === undefined) throw new Error(`merge policy is not registered for ${objectKind}`);
      if (policy === "authoritative") {
        const heads = authoritativeHeads(operations);
        if (heads.length > 1) {
          conflicts.push({
            objectId,
            objectKind,
            status: "requires-explicit-resolution",
            candidates: heads.map((operation) => operation.id),
          });
          continue;
        }
      }
      const state: Record<string, StateValue> = {};
      for (const operation of operations.sort(compareOperations)) {
        for (const [key, value] of Object.entries(operation.changes)) state[key] = value;
      }
      objects.push({
        id: objectId,
        kind: objectKind,
        state: sortedRecord(state),
        operationIds: operations.map((operation) => operation.id).sort(),
      });
    }
    return deepFreeze({
      objects,
      conflicts,
      rejected: rejected.sort((left, right) => left.operationId.localeCompare(right.operationId)),
    });
  }
}

function authoritativeHeads(operations: readonly SyncOperation[]): SyncOperation[] {
  const parentIds = new Set(operations.flatMap((operation) => operation.parents));
  return operations.filter((operation) => !parentIds.has(operation.id)).sort(compareOperations);
}

function policyDenial(
  policy: StoragePolicy,
  target: { readonly kind: "local" | "cloud"; readonly deviceId: string; readonly region: string; readonly agentId: string },
  at: string,
): string | undefined {
  if (policy.locality === "local-only" && target.kind === "cloud") return "local-only";
  if (policy.locality === "cloud-required" && target.kind === "local") return "cloud-required";
  if (policy.locality === "ephemeral" && target.kind === "cloud") return "ephemeral";
  if (at >= policy.expiresAt) return "expired";
  if (policy.allowedDevices.length > 0 && !policy.allowedDevices.includes(target.deviceId)) return "device-not-allowed";
  if (policy.allowedRegions.length > 0 && !policy.allowedRegions.includes(target.region)) return "region-not-allowed";
  if (policy.allowedAgents.length > 0 && !policy.allowedAgents.includes(target.agentId)) return "agent-not-allowed";
  return undefined;
}

function compareOperations(left: SyncOperation, right: SyncOperation): number {
  return left.transactionTime.from.localeCompare(right.transactionTime.from) || left.id.localeCompare(right.id);
}
function sortedRecord(value: Readonly<Record<string, StateValue>>): Readonly<Record<string, StateValue>> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
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
