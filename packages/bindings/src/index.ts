export interface GraphReference {
  readonly graphId: string;
  readonly recordId: string;
}

export interface BindingRecord {
  readonly id: string;
  readonly kind: "binding";
  readonly from: GraphReference;
  readonly to: GraphReference;
  readonly type: string;
  readonly validTime: { readonly from: string; readonly to?: string };
  readonly transactionTime: { readonly from: string };
}

export interface BindingTraceStep {
  readonly bindingId: string;
  readonly depth: number;
  readonly direction: "outgoing" | "incoming";
  readonly decision: "traversed" | "denied" | "out-of-time" | "already-visited";
  readonly from: GraphReference;
  readonly to: GraphReference;
}

export interface BindingTraversal {
  readonly start: GraphReference;
  readonly records: readonly GraphReference[];
  readonly trace: readonly BindingTraceStep[];
}

export function createBinding(input: {
  readonly id: string;
  readonly from: GraphReference;
  readonly to: GraphReference;
  readonly type: string;
  readonly validTime: { readonly from: string; readonly to?: string };
  readonly recordedAt: string;
}): BindingRecord {
  const from = reference(input.from);
  const to = reference(input.to);
  if (key(from) === key(to)) throw new Error("binding cannot connect a record to itself");
  const validFrom = normalizeInstant(input.validTime.from);
  const validTo = input.validTime.to === undefined ? undefined : normalizeInstant(input.validTime.to);
  if (validTo !== undefined && validTo <= validFrom) throw new RangeError("binding valid interval must increase");
  return deepFreeze({
    id: prefixed("binding id", input.id, "binding:"),
    kind: "binding" as const,
    from,
    to,
    type: namespaced("binding type", input.type),
    validTime: validTo === undefined ? { from: validFrom } : { from: validFrom, to: validTo },
    transactionTime: { from: normalizeInstant(input.recordedAt) },
  });
}

export class BindingGraph {
  readonly #bindings = new Map<string, BindingRecord>();

  append(binding: BindingRecord): void {
    if (this.#bindings.has(binding.id)) throw new Error(`binding already exists: ${binding.id}`);
    this.#bindings.set(binding.id, binding);
  }

  traverse(input: {
    readonly start: GraphReference;
    readonly direction: "outgoing" | "incoming" | "both";
    readonly maxDepth: number;
    readonly validAt: string;
    readonly recordedAt: string;
    readonly authorize: (reference: GraphReference) => boolean;
  }): BindingTraversal {
    if (!Number.isInteger(input.maxDepth) || input.maxDepth < 0) {
      throw new RangeError("maxDepth must be a non-negative integer");
    }
    const start = reference(input.start);
    const validAt = normalizeInstant(input.validAt);
    const recordedAt = normalizeInstant(input.recordedAt);
    const visited = new Set<string>([key(start)]);
    const records: GraphReference[] = [];
    const trace: BindingTraceStep[] = [];
    let frontier = [start];

    for (let depth = 1; depth <= input.maxDepth && frontier.length > 0; depth += 1) {
      const next: GraphReference[] = [];
      for (const current of frontier.sort(compareReferences)) {
        const candidates = this.#edgesFor(current, input.direction);
        for (const candidate of candidates) {
          const inTime = contains(candidate.binding.validTime, validAt) && candidate.binding.transactionTime.from <= recordedAt;
          const targetKey = key(candidate.target);
          let decision: BindingTraceStep["decision"];
          if (!inTime) decision = "out-of-time";
          else if (!input.authorize(candidate.target)) decision = "denied";
          else if (visited.has(targetKey)) decision = "already-visited";
          else decision = "traversed";
          trace.push({
            bindingId: candidate.binding.id,
            depth,
            direction: candidate.direction,
            decision,
            from: current,
            to: candidate.target,
          });
          if (decision === "traversed") {
            visited.add(targetKey);
            records.push(candidate.target);
            next.push(candidate.target);
          }
        }
      }
      frontier = next;
    }
    return deepFreeze({ start, records, trace });
  }

  #edgesFor(referenceValue: GraphReference, direction: "outgoing" | "incoming" | "both") {
    return [...this.#bindings.values()]
      .flatMap((binding) => {
        const candidates: {
          binding: BindingRecord;
          target: GraphReference;
          direction: "outgoing" | "incoming";
        }[] = [];
        if ((direction === "outgoing" || direction === "both") && key(binding.from) === key(referenceValue)) {
          candidates.push({ binding, target: binding.to, direction: "outgoing" });
        }
        if ((direction === "incoming" || direction === "both") && key(binding.to) === key(referenceValue)) {
          candidates.push({ binding, target: binding.from, direction: "incoming" });
        }
        return candidates;
      })
      .sort((left, right) => left.binding.id.localeCompare(right.binding.id));
  }
}

function contains(interval: BindingRecord["validTime"], instant: string): boolean {
  return interval.from <= instant && (interval.to === undefined || instant < interval.to);
}

function reference(value: GraphReference): GraphReference {
  return {
    graphId: prefixed("graph id", value.graphId, "graph:"),
    recordId: namespaced("record id", value.recordId),
  };
}

function key(value: GraphReference): string {
  return `${value.graphId}\u0000${value.recordId}`;
}

function compareReferences(left: GraphReference, right: GraphReference): number {
  return left.graphId.localeCompare(right.graphId) || left.recordId.localeCompare(right.recordId);
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
