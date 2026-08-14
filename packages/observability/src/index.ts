export const REQUIRED_QUALITY_METRICS = [
  "authority_correctness",
  "conflict_detection_recall",
  "entity_resolution_accuracy",
  "permission_leakage_rate",
  "provenance_coverage",
  "reconstruction_completeness",
  "reconstruction_precision",
  "state_freshness",
  "supersession_correctness",
  "temporal_state_accuracy",
  "verification_coverage",
] as const;

export type QualityMetricName = typeof REQUIRED_QUALITY_METRICS[number];
export type TelemetryAttributes = Readonly<Record<string, unknown>>;

export interface QualityMetric {
  readonly name: QualityMetricName;
  readonly correct: number;
  readonly total: number;
  readonly value: number;
}

export interface TraceSpan {
  readonly name: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly attributes: TelemetryAttributes;
}

export interface TraceRecord {
  readonly traceId: string;
  readonly requestId: string;
  readonly principal: string;
  readonly operation: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly status: "ok" | "error";
  readonly attributes: TelemetryAttributes;
  readonly spans: readonly TraceSpan[];
}

export interface AuditRecord {
  readonly id: string;
  readonly traceId: string;
  readonly requestId: string;
  readonly principal: string;
  readonly decision: string;
  readonly stateChangeId?: string;
  readonly reconstructionId?: string;
  readonly transactionTime: { readonly from: string };
  readonly detail: TelemetryAttributes;
}

const SENSITIVE = /^(?:authorization|.*(?:password|secret|token)|.*(?:api|access)[-_]?key|cookie|payload|content|body|prompt|document|transcript)$/i;

export class PlatformObservability {
  readonly #metrics = new Map<QualityMetricName, { correct: number; total: number }>();
  readonly #traces: TraceRecord[] = [];
  readonly #audits: AuditRecord[] = [];

  observe(name: QualityMetricName, input: { readonly correct: number; readonly total: number }): void {
    if (!REQUIRED_QUALITY_METRICS.includes(name)) throw new TypeError(`unknown quality metric: ${name}`);
    if (!Number.isSafeInteger(input.correct) || !Number.isSafeInteger(input.total) || input.correct < 0 || input.total < 1 || input.correct > input.total) {
      throw new TypeError("quality metric requires integer 0 <= correct <= total");
    }
    const current = this.#metrics.get(name) ?? { correct: 0, total: 0 };
    this.#metrics.set(name, { correct: current.correct + input.correct, total: current.total + input.total });
  }

  trace(input: {
    readonly traceId: string;
    readonly requestId: string;
    readonly principal: string;
    readonly operation: string;
    readonly startedAt: string;
    readonly attributes?: TelemetryAttributes;
  }): TraceBuilder {
    return new TraceBuilder(this, {
      traceId: namespaced("trace id", input.traceId),
      requestId: namespaced("request id", input.requestId),
      principal: namespaced("principal", input.principal),
      operation: requiredText("operation", input.operation),
      startedAt: normalizeInstant(input.startedAt),
      attributes: sanitize(input.attributes ?? {}) as TelemetryAttributes,
    });
  }

  audit(input: {
    readonly id: string;
    readonly traceId: string;
    readonly requestId: string;
    readonly principal: string;
    readonly decision: string;
    readonly stateChangeId?: string;
    readonly reconstructionId?: string;
    readonly recordedAt: string;
    readonly detail?: TelemetryAttributes;
  }): AuditRecord {
    const record = deepFreeze({
      id: namespaced("audit id", input.id),
      traceId: namespaced("trace id", input.traceId),
      requestId: namespaced("request id", input.requestId),
      principal: namespaced("principal", input.principal),
      decision: requiredText("decision", input.decision),
      ...(input.stateChangeId === undefined ? {} : { stateChangeId: namespaced("state change id", input.stateChangeId) }),
      ...(input.reconstructionId === undefined ? {} : { reconstructionId: namespaced("reconstruction id", input.reconstructionId) }),
      transactionTime: { from: normalizeInstant(input.recordedAt) },
      detail: sanitize(input.detail ?? {}) as TelemetryAttributes,
    });
    this.#audits.push(record);
    return record;
  }

  snapshot(): { readonly metrics: readonly QualityMetric[]; readonly traces: readonly TraceRecord[]; readonly audits: readonly AuditRecord[] } {
    const metrics = [...this.#metrics.entries()].map(([name, value]) => deepFreeze({ name, ...value, value: value.correct / value.total })).sort((left, right) => left.name.localeCompare(right.name));
    return deepFreeze({ metrics, traces: [...this.#traces], audits: [...this.#audits] });
  }

  _appendTrace(trace: TraceRecord): void {
    if (this.#traces.some((item) => item.traceId === trace.traceId)) throw new Error(`trace already exists: ${trace.traceId}`);
    this.#traces.push(trace);
  }
}

export class TraceBuilder {
  readonly #owner: PlatformObservability;
  readonly #base: Omit<TraceRecord, "endedAt" | "status" | "spans">;
  readonly #spans: TraceSpan[] = [];
  #ended = false;

  constructor(owner: PlatformObservability, base: Omit<TraceRecord, "endedAt" | "status" | "spans">) {
    this.#owner = owner;
    this.#base = base;
  }

  span(input: { readonly name: string; readonly startedAt: string; readonly endedAt: string; readonly attributes?: TelemetryAttributes }): void {
    if (this.#ended) throw new Error("trace has ended");
    const startedAt = normalizeInstant(input.startedAt);
    const endedAt = normalizeInstant(input.endedAt);
    if (endedAt < startedAt) throw new RangeError("span end must not precede start");
    this.#spans.push(deepFreeze({ name: requiredText("span name", input.name), startedAt, endedAt, attributes: sanitize(input.attributes ?? {}) as TelemetryAttributes }));
  }

  end(input: { readonly status: "ok" | "error"; readonly endedAt: string }): TraceRecord {
    if (this.#ended) throw new Error("trace has ended");
    const endedAt = normalizeInstant(input.endedAt);
    if (endedAt < this.#base.startedAt) throw new RangeError("trace end must not precede start");
    this.#ended = true;
    const trace = deepFreeze({ ...this.#base, endedAt, status: input.status, spans: [...this.#spans] });
    this.#owner._appendTrace(trace);
    return trace;
  }
}

function sanitize(value: unknown, key = ""): unknown {
  if (SENSITIVE.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [nestedKey, sanitize(nested, nestedKey)]));
  return value;
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

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return date.toISOString();
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
