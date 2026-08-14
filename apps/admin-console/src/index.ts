export interface DiagnosticItem extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly status: string;
}

export interface DiagnosticSnapshot {
  readonly connectors: readonly DiagnosticItem[];
  readonly policies: readonly DiagnosticItem[];
  readonly verifiers: readonly DiagnosticItem[];
  readonly subscriptions: readonly DiagnosticItem[];
  readonly storage: readonly DiagnosticItem[];
  readonly failedJobs: readonly DiagnosticItem[];
  readonly generatedAt: string;
}

export interface AdminAuditRecord {
  readonly id: string;
  readonly kind: "admin-operation-audit";
  readonly requestId: string;
  readonly principal: string;
  readonly operation: "retry-failed-job";
  readonly targetId: string;
  readonly reason: string;
  readonly decision: "executed";
  readonly transactionTime: { readonly from: string };
}

export interface AdminDiagnosticsPorts {
  readonly authorize: (input: { readonly principal: string; readonly operation: "ADMIN"; readonly resourceId: string }) => { readonly allowed: boolean; readonly rationale: string };
  readonly inspect: () => Promise<Omit<DiagnosticSnapshot, "generatedAt">>;
  readonly retryJob: (id: string) => Promise<void>;
  readonly appendAudit: (record: AdminAuditRecord) => Promise<void>;
}

const SENSITIVE_KEYS = /^(?:authorization|api[-_]?key|password|secret|token|cookie|payload|content|body)$/i;

export class AdminDiagnostics {
  readonly #ports: AdminDiagnosticsPorts;

  constructor(ports: AdminDiagnosticsPorts) {
    this.#ports = ports;
  }

  async snapshot(input: { readonly principal: string; readonly recordedAt: string }): Promise<DiagnosticSnapshot> {
    const principal = namespaced("principal", input.principal);
    this.#authorize(principal, "diagnostics");
    const raw = await this.#ports.inspect();
    const redacted = redact(raw) as Omit<DiagnosticSnapshot, "generatedAt">;
    return deepFreeze({ ...redacted, generatedAt: normalizeInstant(input.recordedAt) });
  }

  async execute(input: {
    readonly principal: string;
    readonly operation: "retry-failed-job";
    readonly targetId: string;
    readonly confirmation: string;
    readonly reason: string;
    readonly recordedAt: string;
    readonly requestId: string;
  }): Promise<{ readonly status: "executed"; readonly audit: AdminAuditRecord }> {
    const principal = namespaced("principal", input.principal);
    const targetId = namespaced("target id", input.targetId);
    const requestId = namespaced("request id", input.requestId);
    this.#authorize(principal, targetId);
    const expected = `RETRY ${targetId}`;
    if (input.confirmation !== expected) throw new Error(`confirmation token must be exactly: ${expected}`);
    await this.#ports.retryJob(targetId);
    const audit = deepFreeze({
      id: `admin-audit:${requestId.slice(requestId.indexOf(":") + 1)}`,
      kind: "admin-operation-audit" as const,
      requestId,
      principal,
      operation: input.operation,
      targetId,
      reason: requiredText("reason", input.reason),
      decision: "executed" as const,
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    await this.#ports.appendAudit(audit);
    return deepFreeze({ status: "executed" as const, audit });
  }

  #authorize(principal: string, resourceId: string): void {
    const decision = this.#ports.authorize({ principal, operation: "ADMIN", resourceId });
    if (!decision.allowed) throw new Error(`admin access denied: ${decision.rationale}`);
  }
}

function redact(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEYS.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [nestedKey, redact(nested, nestedKey)]));
  }
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
