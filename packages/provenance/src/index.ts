export interface ProvenanceNode {
  readonly id: string;
  readonly kind: string;
  readonly derivedFrom: readonly string[];
}

export interface InvalidationInput {
  readonly id: string;
  readonly reason: string;
  readonly recordedAt: string;
}

export interface InvalidationImpact {
  readonly id: string;
  readonly sourceId: string;
  readonly reason: string;
  readonly transactionTime: { readonly from: string };
  readonly affected: readonly ProvenanceNode[];
}

export class ProvenanceGraph {
  readonly #nodes: ReadonlyMap<string, ProvenanceNode>;
  readonly #downstream: ReadonlyMap<string, readonly string[]>;
  readonly #topological: readonly ProvenanceNode[];
  readonly #invalidated = new Set<string>();

  private constructor(
    nodes: ReadonlyMap<string, ProvenanceNode>,
    downstream: ReadonlyMap<string, readonly string[]>,
    topological: readonly ProvenanceNode[],
  ) {
    this.#nodes = nodes;
    this.#downstream = downstream;
    this.#topological = topological;
  }

  static build(input: readonly ProvenanceNode[]): ProvenanceGraph {
    const nodes = new Map<string, ProvenanceNode>();
    for (const item of input) {
      const node = deepFreeze({
        id: requiredText("provenance node id", item.id),
        kind: requiredText("provenance node kind", item.kind),
        derivedFrom: [...new Set(item.derivedFrom)].sort(),
      });
      if (nodes.has(node.id)) throw new Error(`duplicate provenance node: ${node.id}`);
      nodes.set(node.id, node);
    }

    const downstream = new Map<string, string[]>();
    const indegree = new Map<string, number>();
    for (const node of nodes.values()) {
      indegree.set(node.id, node.derivedFrom.length);
      for (const parent of node.derivedFrom) {
        if (!nodes.has(parent)) {
          throw new Error(`missing provenance reference ${parent} for ${node.id}`);
        }
        const children = downstream.get(parent) ?? [];
        children.push(node.id);
        downstream.set(parent, children);
      }
    }
    for (const children of downstream.values()) children.sort();

    const ready = [...nodes.keys()].filter((id) => indegree.get(id) === 0).sort();
    const ordered: ProvenanceNode[] = [];
    while (ready.length > 0) {
      const id = ready.shift() as string;
      ordered.push(nodes.get(id) as ProvenanceNode);
      for (const child of downstream.get(id) ?? []) {
        const remaining = (indegree.get(child) as number) - 1;
        indegree.set(child, remaining);
        if (remaining === 0) {
          ready.push(child);
          ready.sort();
        }
      }
    }
    if (ordered.length !== nodes.size) {
      const cyclic = [...nodes.keys()].filter((id) => (indegree.get(id) ?? 0) > 0).sort();
      throw new Error(`provenance cycle detected: ${cyclic.join(", ")}`);
    }

    return new ProvenanceGraph(nodes, downstream, Object.freeze(ordered));
  }

  invalidate(sourceId: string, input: InvalidationInput): InvalidationImpact {
    this.#assertNode(sourceId);
    const affected = this.traceDownstream(sourceId);
    this.#invalidated.add(sourceId);
    return deepFreeze({
      id: namespaced("invalidation id", input.id, "invalidation:"),
      sourceId,
      reason: requiredText("invalidation reason", input.reason),
      transactionTime: { from: normalizeInstant(input.recordedAt) },
      affected,
    });
  }

  traceUpstream(id: string): readonly ProvenanceNode[] {
    this.#assertNode(id);
    const ancestors = new Set<string>();
    const visit = (nodeId: string): void => {
      for (const parent of (this.#nodes.get(nodeId) as ProvenanceNode).derivedFrom) {
        if (!ancestors.has(parent)) {
          ancestors.add(parent);
          visit(parent);
        }
      }
    };
    visit(id);
    return Object.freeze(this.#topological.filter((node) => ancestors.has(node.id)));
  }

  traceDownstream(id: string): readonly ProvenanceNode[] {
    this.#assertNode(id);
    const descendants = new Set<string>();
    const pending = [...(this.#downstream.get(id) ?? [])];
    while (pending.length > 0) {
      const child = pending.shift() as string;
      if (descendants.has(child)) continue;
      descendants.add(child);
      pending.push(...(this.#downstream.get(child) ?? []));
    }
    return Object.freeze(this.#topological.filter((node) => descendants.has(node.id)));
  }

  supportStatus(id: string): "supported" | "unsupported" {
    this.#assertNode(id);
    if (this.#invalidated.has(id)) return "unsupported";
    return this.traceUpstream(id).some((node) => this.#invalidated.has(node.id))
      ? "unsupported"
      : "supported";
  }

  #assertNode(id: string): void {
    if (!this.#nodes.has(id)) throw new Error(`provenance node does not exist: ${id}`);
  }
}

function namespaced(name: string, value: string, prefix: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${name} must start with ${prefix}`);
  return normalized;
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`timestamp must include an explicit UTC offset: ${value}`);
  }
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
