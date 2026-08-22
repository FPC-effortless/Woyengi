import type {
  ComputeBudget,
  ComputeLease,
  ComputeNode,
  ComputeValue,
  ExecutionUsage,
  WorkloadExecutionObservation,
  WorkloadExecutionRequest,
  WorkloadExecutor,
  WorkloadSpec,
} from "../../packages/compute/src/index.ts";
import type { ExecutionCorrelation, ReconciliationStrategy } from "../../packages/effects/src/index.ts";

export interface HostedComputeNodeRegistration {
  readonly nodeId: string;
  readonly version: string;
  readonly workspaceIds: readonly string[];
  readonly capabilities: readonly string[];
  readonly budgetLimit: ComputeBudget;
  readonly heartbeatTtlMs: number;
  readonly registeredAt: string;
}

export interface HostedComputeNodeSession {
  readonly sessionId: string;
  readonly nodeId: string;
  readonly acceptedAt: string;
  readonly heartbeatExpiresAt: string;
}

export interface HostedComputeNodeHeartbeat {
  readonly sessionId: string;
  readonly nodeId: string;
  readonly recordedAt: string;
}

export interface HostedExpectedEffectReference {
  readonly id: string;
  readonly effectClass: "RUNTIME" | "SEMANTIC" | "EXTERNAL";
}

export interface HostedReconciliationPlan {
  readonly id: string;
  readonly strategy: ReconciliationStrategy;
  readonly required: boolean;
}

export interface HostedWorkloadEnvelope {
  readonly executionId: string;
  readonly correlation: ExecutionCorrelation;
  readonly principalId: string;
  readonly authorityReference: string;
  readonly budget: ComputeBudget;
  readonly idempotencyKey: string;
  readonly workload: WorkloadSpec;
  readonly expectedEffect: HostedExpectedEffectReference;
  readonly reconciliation: HostedReconciliationPlan;
  readonly startedAt: string;
}

export interface HostedWorkloadLease {
  readonly id: string;
  readonly nodeId: string;
  readonly sessionId: string;
  readonly leasedAt: string;
  readonly expiresAt: string;
  readonly envelope: HostedWorkloadEnvelope;
}

export interface HostedAuthorityRequest {
  readonly operation: "EXECUTE_HOSTED_WORKLOAD";
  readonly nodeId: string;
  readonly providerId: string;
  readonly envelope: HostedWorkloadEnvelope;
}

export interface HostedAuthorityDecision {
  readonly allowed: boolean;
  readonly decisionReference: string;
  readonly reason: string;
}

export interface HostedLeaseRequest {
  readonly nodeId: string;
  readonly sessionId: string;
  readonly workspaceIds: readonly string[];
  readonly capabilities: readonly string[];
  readonly requestedAt: string;
}

export interface HostedObservationReconciliation {
  readonly id: string;
  readonly strategy: ReconciliationStrategy;
  readonly required: boolean;
  readonly status: "PENDING";
}

export interface HostedComputeObservation {
  readonly contract: "woyengi.hosted-compute-observation.v1";
  readonly id: string;
  readonly executionId: string;
  readonly correlation: ExecutionCorrelation;
  readonly nodeId: string;
  readonly sessionId: string;
  readonly leaseId: string;
  readonly providerId: string;
  readonly workloadId: string;
  readonly principalId: string;
  readonly authorityReference: string;
  readonly budget: ComputeBudget;
  readonly idempotencyKey: string;
  readonly expectedEffectId: string;
  readonly expectedEffectClass: HostedExpectedEffectReference["effectClass"];
  readonly reconciliation: HostedObservationReconciliation;
  readonly status: "succeeded" | "failed" | "budget-exceeded";
  readonly output?: ComputeValue;
  readonly usage: ExecutionUsage;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly observationOnly: true;
  readonly acceptedTruth: false;
  readonly semanticMutation: false;
}

export interface ComputeNodeStatePort {
  register(registration: HostedComputeNodeRegistration): Promise<HostedComputeNodeSession>;
  heartbeat(heartbeat: HostedComputeNodeHeartbeat): Promise<HostedComputeNodeSession>;
  nextLease(request: HostedLeaseRequest): Promise<HostedWorkloadLease | undefined>;
  authorize(request: HostedAuthorityRequest): Promise<HostedAuthorityDecision>;
  publishObservation(observation: HostedComputeObservation): Promise<void>;
}

export interface HostedComputeNodeOptions {
  readonly statePort: ComputeNodeStatePort;
  readonly providerId: string;
  readonly workloadProvider: WorkloadExecutor;
}

interface IdempotentExecution {
  readonly fingerprint: string;
  readonly observation: Promise<HostedComputeObservation>;
}

export class HostedComputeNodeRuntime {
  readonly #statePort: ComputeNodeStatePort;
  readonly #providerId: string;
  readonly #workloadProvider: WorkloadExecutor;
  readonly #executions = new Map<string, IdempotentExecution>();
  #registration?: HostedComputeNodeRegistration;
  #session?: HostedComputeNodeSession;

  constructor(options: HostedComputeNodeOptions) {
    this.#statePort = options.statePort;
    this.#providerId = prefixed("hosted compute provider id", options.providerId, "provider:");
    this.#workloadProvider = options.workloadProvider;
  }

  async connect(input: HostedComputeNodeRegistration): Promise<HostedComputeNodeSession> {
    if (this.#session !== undefined) throw new Error(`compute node is already connected: ${this.#session.nodeId}`);
    const registration = normalizeRegistration(input);
    const session = normalizeSession(await this.#statePort.register(registration));
    if (session.nodeId !== registration.nodeId) throw new Error("compute node registration returned a different node");
    if (Date.parse(session.heartbeatExpiresAt) <= Date.parse(session.acceptedAt)) throw new Error("compute node session heartbeat is already expired");
    this.#registration = registration;
    this.#session = session;
    return session;
  }

  async heartbeat(recordedAtValue: string): Promise<HostedComputeNodeSession> {
    const { registration, session } = this.#connected();
    const recordedAt = normalizeInstant(recordedAtValue);
    if (Date.parse(recordedAt) > Date.parse(session.heartbeatExpiresAt)) throw new Error(`compute node session heartbeat expired: ${session.sessionId}`);
    const updated = normalizeSession(await this.#statePort.heartbeat(deepFreeze({
      sessionId: session.sessionId,
      nodeId: registration.nodeId,
      recordedAt,
    })));
    if (updated.sessionId !== session.sessionId || updated.nodeId !== registration.nodeId) {
      throw new Error("compute node heartbeat returned a different session");
    }
    this.#session = updated;
    return updated;
  }

  async runNext(requestedAtValue: string): Promise<HostedComputeObservation | undefined> {
    const { registration, session } = this.#connected();
    const requestedAt = normalizeInstant(requestedAtValue);
    if (Date.parse(requestedAt) > Date.parse(session.heartbeatExpiresAt)) throw new Error(`compute node session heartbeat expired: ${session.sessionId}`);
    const leaseInput = await this.#statePort.nextLease(deepFreeze({
      nodeId: registration.nodeId,
      sessionId: session.sessionId,
      workspaceIds: registration.workspaceIds,
      capabilities: registration.capabilities,
      requestedAt,
    }));
    if (leaseInput === undefined) return undefined;
    const lease = normalizeLease(leaseInput);
    validateLease(lease, registration, session, requestedAt);
    const envelope = lease.envelope;

    let decision: HostedAuthorityDecision;
    try {
      decision = normalizeAuthorityDecision(await this.#statePort.authorize(deepFreeze({
        operation: "EXECUTE_HOSTED_WORKLOAD" as const,
        nodeId: registration.nodeId,
        providerId: this.#providerId,
        envelope,
      })));
    } catch {
      throw new Error(`hosted compute authority denied: ${envelope.executionId}`);
    }
    if (!decision.allowed || decision.decisionReference !== envelope.authorityReference) {
      throw new Error(`hosted compute authority denied: ${envelope.executionId}`);
    }

    const key = `${envelope.correlation.workspaceId}\u0000${envelope.idempotencyKey}`;
    const fingerprint = stableStringify(envelope);
    const existing = this.#executions.get(key);
    let observation: Promise<HostedComputeObservation>;
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) throw new Error(`hosted compute idempotency conflict: ${envelope.idempotencyKey}`);
      observation = existing.observation;
    } else {
      observation = this.#executeProvider(registration, session, lease);
      this.#executions.set(key, { fingerprint, observation });
    }
    const result = await observation;
    await this.#statePort.publishObservation(result);
    return result;
  }

  #connected(): { readonly registration: HostedComputeNodeRegistration; readonly session: HostedComputeNodeSession } {
    if (this.#registration === undefined || this.#session === undefined) throw new Error("compute node is not connected");
    return { registration: this.#registration, session: this.#session };
  }

  async #executeProvider(
    registration: HostedComputeNodeRegistration,
    session: HostedComputeNodeSession,
    lease: HostedWorkloadLease,
  ): Promise<HostedComputeObservation> {
    const envelope = lease.envelope;
    const node = deepFreeze({
      id: registration.nodeId,
      workspaceId: envelope.correlation.workspaceId,
      capabilities: registration.capabilities,
      version: 1,
      registeredAt: registration.registeredAt,
      lastHeartbeatAt: session.acceptedAt,
      heartbeatExpiresAt: session.heartbeatExpiresAt,
    }) as ComputeNode;
    const computeLease = deepFreeze({
      id: lease.id,
      workspaceId: envelope.correlation.workspaceId,
      nodeId: registration.nodeId,
      workloadId: envelope.workload.id,
      requiredCapabilities: envelope.workload.requiredCapabilities,
      leasedAt: lease.leasedAt,
      expiresAt: lease.expiresAt,
    }) as ComputeLease;
    const request = deepFreeze({
      executionId: envelope.executionId,
      workload: envelope.workload,
      node,
      lease: computeLease,
      budget: envelope.budget,
      startedAt: envelope.startedAt,
    }) as WorkloadExecutionRequest;
    const providerObservation = normalizeProviderObservation(await this.#workloadProvider.execute(request));
    const budgetExceeded = exceedsBudget(providerObservation.usage, envelope.budget);
    const suffix = envelope.executionId.slice("compute-execution:".length);
    return deepFreeze({
      contract: "woyengi.hosted-compute-observation.v1" as const,
      id: `compute-node-observation:${suffix}`,
      executionId: envelope.executionId,
      correlation: envelope.correlation,
      nodeId: registration.nodeId,
      sessionId: session.sessionId,
      leaseId: lease.id,
      providerId: this.#providerId,
      workloadId: envelope.workload.id,
      principalId: envelope.principalId,
      authorityReference: envelope.authorityReference,
      budget: envelope.budget,
      idempotencyKey: envelope.idempotencyKey,
      expectedEffectId: envelope.expectedEffect.id,
      expectedEffectClass: envelope.expectedEffect.effectClass,
      reconciliation: {
        id: envelope.reconciliation.id,
        strategy: envelope.reconciliation.strategy,
        required: envelope.reconciliation.required,
        status: "PENDING" as const,
      },
      status: budgetExceeded ? ("budget-exceeded" as const) : providerObservation.outcome,
      ...(providerObservation.output === undefined ? {} : { output: cloneValue(providerObservation.output) }),
      usage: providerObservation.usage,
      startedAt: envelope.startedAt,
      finishedAt: providerObservation.finishedAt,
      observationOnly: true as const,
      acceptedTruth: false as const,
      semanticMutation: false as const,
    });
  }
}

function normalizeRegistration(input: HostedComputeNodeRegistration): HostedComputeNodeRegistration {
  return deepFreeze({
    nodeId: prefixed("compute node id", input.nodeId, "compute-node:"),
    version: semanticVersion(input.version),
    workspaceIds: uniqueSorted("compute node workspaces", input.workspaceIds, (value) => prefixed("workspace id", value, "workspace:")),
    capabilities: uniqueSorted("compute node capabilities", input.capabilities, (value) => namespaced("compute capability", value)),
    budgetLimit: normalizeBudget(input.budgetLimit),
    heartbeatTtlMs: positiveInteger("heartbeatTtlMs", input.heartbeatTtlMs),
    registeredAt: normalizeInstant(input.registeredAt),
  });
}

function normalizeSession(input: HostedComputeNodeSession): HostedComputeNodeSession {
  return deepFreeze({
    sessionId: prefixed("compute node session id", input.sessionId, "compute-node-session:"),
    nodeId: prefixed("compute node id", input.nodeId, "compute-node:"),
    acceptedAt: normalizeInstant(input.acceptedAt),
    heartbeatExpiresAt: normalizeInstant(input.heartbeatExpiresAt),
  });
}

function normalizeLease(input: HostedWorkloadLease): HostedWorkloadLease {
  return deepFreeze({
    id: prefixed("compute lease id", input.id, "compute-lease:"),
    nodeId: prefixed("compute node id", input.nodeId, "compute-node:"),
    sessionId: prefixed("compute node session id", input.sessionId, "compute-node-session:"),
    leasedAt: normalizeInstant(input.leasedAt),
    expiresAt: normalizeInstant(input.expiresAt),
    envelope: normalizeEnvelope(input.envelope),
  });
}

function normalizeEnvelope(input: HostedWorkloadEnvelope): HostedWorkloadEnvelope {
  const correlation = deepFreeze({
    workspaceId: prefixed("workspace id", input.correlation.workspaceId, "workspace:"),
    workInstanceId: prefixed("work instance id", input.correlation.workInstanceId, "work-instance:"),
    workEpisodeId: prefixed("work episode id", input.correlation.workEpisodeId, "work-episode:"),
    traceId: prefixed("trace id", input.correlation.traceId, "trace:"),
  });
  const budget = normalizeBudget(input.budget);
  const workload = normalizeWorkload(input.workload);
  const principalId = prefixed("principal id", input.principalId, "principal:");
  const authorityReference = namespaced("authority reference", input.authorityReference);
  const idempotencyKey = namespaced("idempotency key", input.idempotencyKey);
  if (workload.workspaceId !== correlation.workspaceId) throw new Error("hosted workload workspace correlation mismatch");
  if (workload.requestedByPrincipalId !== principalId) throw new Error("hosted workload principal correlation mismatch");
  if (workload.authorityReference !== authorityReference) throw new Error("hosted workload authority correlation mismatch");
  if (workload.idempotencyKey !== idempotencyKey) throw new Error("hosted workload idempotency correlation mismatch");
  if (stableStringify(workload.budget) !== stableStringify(budget)) throw new Error("hosted workload budget correlation mismatch");
  const effectClass = effectClassValue(input.expectedEffect.effectClass);
  const reconciliation = deepFreeze({
    id: prefixed("reconciliation id", input.reconciliation.id, "reconciliation:"),
    strategy: reconciliationStrategy(input.reconciliation.strategy),
    required: input.reconciliation.required,
  });
  if (effectClass === "EXTERNAL" && !reconciliation.required) throw new Error("external hosted workload requires reconciliation");
  return deepFreeze({
    executionId: prefixed("compute execution id", input.executionId, "compute-execution:"),
    correlation,
    principalId,
    authorityReference,
    budget,
    idempotencyKey,
    workload,
    expectedEffect: {
      id: prefixed("expected effect id", input.expectedEffect.id, "expected-effect:"),
      effectClass,
    },
    reconciliation,
    startedAt: normalizeInstant(input.startedAt),
  });
}

function normalizeWorkload(input: WorkloadSpec): WorkloadSpec {
  return deepFreeze({
    id: prefixed("workload id", input.id, "workload:"),
    workspaceId: prefixed("workspace id", input.workspaceId, "workspace:"),
    requestedByPrincipalId: prefixed("principal id", input.requestedByPrincipalId, "principal:"),
    operation: namespaced("workload operation", input.operation),
    input: cloneValue(input.input),
    requiredCapabilities: uniqueSorted("workload capabilities", input.requiredCapabilities, (value) => namespaced("compute capability", value)),
    budget: normalizeBudget(input.budget),
    authorityReference: namespaced("authority reference", input.authorityReference),
    idempotencyKey: namespaced("idempotency key", input.idempotencyKey),
    createdAt: normalizeInstant(input.createdAt),
  });
}

function validateLease(
  lease: HostedWorkloadLease,
  registration: HostedComputeNodeRegistration,
  session: HostedComputeNodeSession,
  requestedAt: string,
): void {
  if (lease.nodeId !== registration.nodeId || lease.sessionId !== session.sessionId) throw new Error("hosted compute lease scope mismatch");
  if (!registration.workspaceIds.includes(lease.envelope.correlation.workspaceId)) throw new Error("hosted compute lease workspace is not registered");
  if (Date.parse(lease.expiresAt) < Date.parse(lease.leasedAt) || Date.parse(requestedAt) > Date.parse(lease.expiresAt)) {
    throw new Error(`hosted compute lease expired: ${lease.id}`);
  }
  const missing = lease.envelope.workload.requiredCapabilities.filter((capability) => !registration.capabilities.includes(capability));
  if (missing.length > 0) throw new Error(`hosted compute node lacks capabilities: ${missing.join(", ")}`);
  assertBudgetWithin(lease.envelope.budget, registration.budgetLimit);
}

function normalizeAuthorityDecision(input: HostedAuthorityDecision): HostedAuthorityDecision {
  return deepFreeze({
    allowed: input.allowed === true,
    decisionReference: namespaced("authority decision reference", input.decisionReference),
    reason: requiredText("authority decision reason", input.reason),
  });
}

function normalizeProviderObservation(input: WorkloadExecutionObservation): WorkloadExecutionObservation {
  if (input.outcome !== "succeeded" && input.outcome !== "failed") throw new TypeError(`invalid workload outcome: ${input.outcome}`);
  return deepFreeze({
    outcome: input.outcome,
    ...(input.output === undefined ? {} : { output: cloneValue(input.output) }),
    usage: normalizeUsage(input.usage),
    finishedAt: normalizeInstant(input.finishedAt),
  });
}

function normalizeUsage(input: ExecutionUsage): ExecutionUsage {
  return deepFreeze({
    durationMs: nonNegative("usage durationMs", input.durationMs),
    outputBytes: nonNegativeInteger("usage outputBytes", input.outputBytes),
    cost: normalizeMoney(input.cost),
  });
}

function normalizeBudget(input: ComputeBudget): ComputeBudget {
  return deepFreeze({
    maxDurationMs: nonNegative("budget maxDurationMs", input.maxDurationMs),
    maxOutputBytes: nonNegativeInteger("budget maxOutputBytes", input.maxOutputBytes),
    maxCost: normalizeMoney(input.maxCost),
  });
}

function normalizeMoney(input: ComputeBudget["maxCost"]): ComputeBudget["maxCost"] {
  const currency = requiredText("currency", input.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError("currency must be a three-letter code");
  return deepFreeze({ amount: nonNegative("cost amount", input.amount), currency });
}

function assertBudgetWithin(requested: ComputeBudget, limit: ComputeBudget): void {
  if (
    requested.maxCost.currency !== limit.maxCost.currency ||
    requested.maxDurationMs > limit.maxDurationMs ||
    requested.maxOutputBytes > limit.maxOutputBytes ||
    requested.maxCost.amount > limit.maxCost.amount
  ) {
    throw new Error("hosted workload budget exceeds node limit");
  }
}

function exceedsBudget(usage: ExecutionUsage, budget: ComputeBudget): boolean {
  return usage.durationMs > budget.maxDurationMs
    || usage.outputBytes > budget.maxOutputBytes
    || usage.cost.currency !== budget.maxCost.currency
    || usage.cost.amount > budget.maxCost.amount;
}

function reconciliationStrategy(value: ReconciliationStrategy): ReconciliationStrategy {
  if (
    value !== "IN_PROCESS" && value !== "CANONICAL_READ" && value !== "IMMEDIATE_REREAD" &&
    value !== "EVENTUAL_OBSERVATION" && value !== "WEBHOOK" && value !== "HUMAN_CONFIRMATION"
  ) {
    throw new TypeError(`invalid reconciliation strategy: ${value}`);
  }
  return value;
}

function effectClassValue(value: HostedExpectedEffectReference["effectClass"]): HostedExpectedEffectReference["effectClass"] {
  if (value !== "RUNTIME" && value !== "SEMANTIC" && value !== "EXTERNAL") throw new TypeError(`invalid effect class: ${value}`);
  return value;
}

function uniqueSorted(name: string, values: readonly string[], normalize: (value: string) => string): readonly string[] {
  const normalized = [...new Set(values.map(normalize))].sort();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return Object.freeze(normalized);
}

function semanticVersion(value: string): string {
  const normalized = requiredText("semantic version", value);
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) throw new TypeError(`version must use major.minor.patch: ${normalized}`);
  return normalized;
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

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`);
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return instant.toISOString();
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return value;
}

function nonNegative(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be non-negative and finite`);
  return value;
}

function cloneValue(value: ComputeValue): ComputeValue {
  return structuredClone(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
