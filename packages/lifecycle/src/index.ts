import type { ProvenanceGraph, ProvenanceNode } from "../../provenance/src/index.ts";

export interface SourceInvalidationRecord {
  readonly id: string;
  readonly kind: "source-invalidation";
  readonly sourceId: string;
  readonly principal: string;
  readonly reason: string;
  readonly retention: { readonly mode: "logical-invalidation" | "physical-erasure"; readonly rationale: string };
  readonly affected: readonly string[];
  readonly transactionTime: { readonly from: string };
}

export interface DeletionCoordinatorPorts {
  readonly authorize: (input: {
    readonly principal: string;
    readonly sourceId: string;
    readonly operation: "RETRACT";
  }) => { readonly allowed: boolean; readonly rationale: string };
  readonly retention: (input: {
    readonly sourceId: string;
    readonly at: string;
  }) => { readonly mode: "logical-invalidation" | "physical-erasure"; readonly rationale: string };
  readonly removeFromIndexes: (ids: readonly string[]) => Promise<void>;
  readonly deleteObject: (sourceId: string) => Promise<void>;
  readonly append: (record: SourceInvalidationRecord) => Promise<void>;
  readonly publish: (event: {
    readonly topic: "source.invalidated";
    readonly sourceId: string;
    readonly affected: readonly string[];
  }) => Promise<void>;
}

export class DeletionCoordinator {
  readonly #ports: DeletionCoordinatorPorts;

  constructor(ports: DeletionCoordinatorPorts) {
    this.#ports = ports;
  }

  async deleteSource(input: {
    readonly id: string;
    readonly principal: string;
    readonly sourceId: string;
    readonly reason: string;
    readonly recordedAt: string;
    readonly provenanceGraph: ProvenanceGraph;
  }) {
    const id = prefixed("source invalidation id", input.id, "source-invalidation:");
    const principal = namespaced("principal", input.principal);
    const sourceId = namespaced("source id", input.sourceId);
    const recordedAt = normalizeInstant(input.recordedAt);
    const permission = this.#ports.authorize({ principal, sourceId, operation: "RETRACT" });
    if (!permission.allowed) throw new Error(`source deletion denied: ${permission.rationale}`);
    const retention = this.#ports.retention({ sourceId, at: recordedAt });
    const impact = input.provenanceGraph.invalidate(sourceId, {
      id: `invalidation:${id.slice("source-invalidation:".length)}`,
      reason: requiredText("deletion reason", input.reason),
      recordedAt,
    });
    const affected = impact.affected.map((node) => node.id);
    const allUnsupported = [sourceId, ...affected];
    await this.#ports.removeFromIndexes(allUnsupported);
    if (retention.mode === "physical-erasure") await this.#ports.deleteObject(sourceId);
    const record = deepFreeze({
      id,
      kind: "source-invalidation" as const,
      sourceId,
      principal,
      reason: requiredText("deletion reason", input.reason),
      retention: {
        mode: retention.mode,
        rationale: requiredText("retention rationale", retention.rationale),
      },
      affected,
      transactionTime: { from: recordedAt },
    });
    await this.#ports.append(record);
    await this.#ports.publish({ topic: "source.invalidated", sourceId, affected });
    return deepFreeze({
      record,
      disposition:
        retention.mode === "physical-erasure"
          ? ("physically-erased" as const)
          : ("logically-invalidated" as const),
      affectedByKind: groupByKind(impact.affected),
    });
  }
}

function groupByKind(nodes: readonly ProvenanceNode[]): Readonly<Record<string, readonly string[]>> {
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    const values = groups.get(node.kind) ?? [];
    values.push(node.id);
    groups.set(node.kind, values);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, ids]) => [kind, ids.sort()]),
  );
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
