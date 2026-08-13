import type { CapabilityOperation } from "../../permissions/src/index.ts";

export interface GraphNodeType {
  readonly id: string;
  readonly recordKinds: readonly string[];
}

export interface GraphEdgeType {
  readonly id: string;
  readonly relationshipTypes: readonly string[];
}

export interface GraphDefinition {
  readonly id: string;
  readonly version: string;
  readonly domainPackage: string;
  readonly nodeTypes: readonly GraphNodeType[];
  readonly edgeTypes: readonly GraphEdgeType[];
  readonly invariants: readonly string[];
  readonly temporalBehavior: "atemporal" | "valid-time" | "bitemporal";
  readonly retention: string;
  readonly requiredOperations: readonly CapabilityOperation[];
  readonly verificationHooks: readonly string[];
}

export interface GraphRecord {
  readonly id: string;
  readonly kind: string;
  readonly transactionTime: { readonly from: string };
  readonly relationshipType?: string;
  readonly fromEntityId?: string;
  readonly toEntityId?: string;
}

export interface MaterializedGraph {
  readonly graphId: string;
  readonly graphVersion: string;
  readonly nodes: readonly { readonly id: string; readonly type: string; readonly record: GraphRecord }[];
  readonly edges: readonly {
    readonly id: string;
    readonly type: string;
    readonly from: string;
    readonly to: string;
    readonly record: GraphRecord;
  }[];
}

export function defineGraph(input: GraphDefinition): GraphDefinition {
  parseVersion(input.version);
  return deepFreeze({
    id: prefixed("graph id", input.id, "graph:"),
    version: input.version,
    domainPackage: requiredText("domain package", input.domainPackage),
    nodeTypes: definitions(input.nodeTypes, "node type", "recordKinds"),
    edgeTypes: input.edgeTypes.map((value) => ({
      id: namespaced("edge type id", value.id),
      relationshipTypes: uniqueRequired("relationship types", value.relationshipTypes),
    })),
    invariants: unique("invariants", input.invariants),
    temporalBehavior: input.temporalBehavior,
    retention: requiredText("retention", input.retention),
    requiredOperations: uniqueRequired("required operations", input.requiredOperations),
    verificationHooks: unique("verification hooks", input.verificationHooks),
  });
}

export class GraphRegistry {
  readonly #definitions = new Map<string, GraphDefinition[]>();

  register(definition: GraphDefinition): void {
    const history = this.#definitions.get(definition.id) ?? [];
    const current = history.at(-1);
    if (current !== undefined) {
      const currentVersion = parseVersion(current.version);
      const nextVersion = parseVersion(definition.version);
      if (compareVersions(nextVersion, currentVersion) <= 0) {
        throw new Error(`graph version must increase: ${definition.id}`);
      }
      if (nextVersion.major === currentVersion.major && !isBackwardCompatible(current, definition)) {
        throw new Error(`backward-incompatible graph change requires a major version: ${definition.id}`);
      }
    }
    history.push(definition);
    this.#definitions.set(definition.id, history);
  }

  active(id: string): GraphDefinition | undefined {
    return this.#definitions.get(id)?.at(-1);
  }

  rebuild(id: string, records: readonly GraphRecord[]): MaterializedGraph {
    const definition = this.active(id);
    if (definition === undefined) throw new Error(`graph is not registered: ${id}`);
    const nodes = records
      .flatMap((record) => {
        const nodeType = definition.nodeTypes.find((type) => type.recordKinds.includes(record.kind));
        return nodeType === undefined ? [] : [{ id: record.id, type: nodeType.id, record }];
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    const edges = records
      .flatMap((record) => {
        if (
          record.kind !== "relationship" ||
          record.relationshipType === undefined ||
          record.fromEntityId === undefined ||
          record.toEntityId === undefined
        ) {
          return [];
        }
        const edgeType = definition.edgeTypes.find((type) =>
          type.relationshipTypes.includes(record.relationshipType as string),
        );
        return edgeType === undefined
          ? []
          : [
              {
                id: record.id,
                type: edgeType.id,
                from: record.fromEntityId,
                to: record.toEntityId,
                record,
              },
            ];
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    return deepFreeze({ graphId: definition.id, graphVersion: definition.version, nodes, edges });
  }
}

function isBackwardCompatible(current: GraphDefinition, next: GraphDefinition): boolean {
  return (
    current.nodeTypes.every((existing) =>
      next.nodeTypes.some(
        (candidate) =>
          candidate.id === existing.id &&
          existing.recordKinds.every((kind) => candidate.recordKinds.includes(kind)),
      ),
    ) &&
    current.edgeTypes.every((existing) =>
      next.edgeTypes.some(
        (candidate) =>
          candidate.id === existing.id &&
          existing.relationshipTypes.every((kind) => candidate.relationshipTypes.includes(kind)),
      ),
    )
  );
}

function definitions(
  values: readonly GraphNodeType[],
  name: string,
  property: "recordKinds",
): GraphNodeType[] {
  return values.map((value) => ({
    id: namespaced(`${name} id`, value.id),
    [property]: uniqueRequired(property, value[property]),
  }));
}

interface Version { readonly major: number; readonly minor: number; readonly patch: number }

function parseVersion(value: string): Version {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (match === null) throw new TypeError(`version must use major.minor.patch: ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareVersions(left: Version, right: Version): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function unique<Value extends string>(name: string, values: readonly Value[]): Value[] {
  const result = values.map((value) => requiredText(name, value) as Value);
  if (new Set(result).size !== result.length) throw new Error(`${name} must not contain duplicates`);
  return result.sort();
}

function uniqueRequired<Value extends string>(name: string, values: readonly Value[]): Value[] {
  const result = unique(name, values);
  if (result.length === 0) throw new TypeError(`${name} must not be empty`);
  return result;
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
