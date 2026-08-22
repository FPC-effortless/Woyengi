type OpaqueId<Kind extends string> = string & { readonly __kind: Kind };

export type ComputeNodeId = OpaqueId<"ComputeNodeId">;
export type ComputeLeaseId = OpaqueId<"ComputeLeaseId">;
export type WorkloadId = OpaqueId<"WorkloadId">;
export type ComputeExecutionId = OpaqueId<"ComputeExecutionId">;
export type WorkspaceId = OpaqueId<"WorkspaceId">;
export type PrincipalId = OpaqueId<"PrincipalId">;

export type ComputeValue =
  | null
  | boolean
  | number
  | string
  | readonly ComputeValue[]
  | { readonly [key: string]: ComputeValue };

export interface MonetaryAmount {
  readonly amount: number;
  readonly currency: string;
}

export interface ComputeBudget {
  readonly maxDurationMs: number;
  readonly maxOutputBytes: number;
  readonly maxCost: MonetaryAmount;
}

export interface WorkloadSpec {
  readonly id: string;
  readonly workspaceId: string;
  readonly requestedByPrincipalId: string;
  readonly operation: string;
  readonly input: ComputeValue;
  readonly requiredCapabilities: readonly string[];
  readonly budget: ComputeBudget;
  readonly authorityReference: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

interface NormalizedWorkloadSpec extends Omit<WorkloadSpec, "id" | "workspaceId" | "requestedByPrincipalId"> {
  readonly id: WorkloadId;
  readonly workspaceId: WorkspaceId;
  readonly requestedByPrincipalId: PrincipalId;
}

export interface ComputeNode {
  readonly id: ComputeNodeId;
  readonly workspaceId: WorkspaceId;
  readonly capabilities: readonly string[];
  readonly version: number;
  readonly registeredAt: string;
  readonly lastHeartbeatAt: string;
  readonly heartbeatExpiresAt: string;
}

export interface ComputeLease {
  readonly id: ComputeLeaseId;
  readonly workspaceId: WorkspaceId;
  readonly nodeId: ComputeNodeId;
  readonly workloadId: WorkloadId;
  readonly requiredCapabilities: readonly string[];
  readonly leasedAt: string;
  readonly expiresAt: string;
}

interface LeaseState {
  readonly lease: ComputeLease;
  consumedBy?: ComputeExecutionId;
}

export interface ExecutionUsage {
  readonly durationMs: number;
  readonly outputBytes: number;
  readonly cost: MonetaryAmount;
}

export interface WorkloadExecutionRequest {
  readonly executionId: ComputeExecutionId;
  readonly workload: NormalizedWorkloadSpec;
  readonly node: ComputeNode;
  readonly lease: ComputeLease;
  readonly budget: ComputeBudget;
  readonly startedAt: string;
}

export interface WorkloadExecutionObservation {
  readonly outcome: "succeeded" | "failed";
  readonly output?: ComputeValue;
  readonly usage: ExecutionUsage;
  readonly finishedAt: string;
}

export interface WorkloadExecutor {
  execute(request: WorkloadExecutionRequest): Promise<WorkloadExecutionObservation>;
}

export interface ComputeAuthorityRequest {
  readonly operation: "EXECUTE_WORKLOAD";
  readonly workspaceId: WorkspaceId;
  readonly principalId: PrincipalId;
  readonly workloadId: WorkloadId;
  readonly nodeId: ComputeNodeId;
  readonly authorityReference: string;
}

export interface UsageReceipt {
  readonly contract: "woyengi.compute-usage.v1";
  readonly id: ComputeExecutionId;
  readonly workloadId: WorkloadId;
  readonly workspaceId: WorkspaceId;
  readonly requestedByPrincipalId: PrincipalId;
  readonly nodeId: ComputeNodeId;
  readonly leaseId: ComputeLeaseId;
  readonly idempotencyKey: string;
  readonly authorityReference: string;
  readonly status: "succeeded" | "failed" | "budget-exceeded";
  readonly output?: ComputeValue;
  readonly usage: ExecutionUsage;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly observationOnly: true;
  readonly semanticMutation: false;
}

export class ComputeNodeRegistry {
  readonly #nodes = new Map<string, ComputeNode>();
  readonly #leases = new Map<string, LeaseState>();

  register(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly capabilities: readonly string[];
    readonly registeredAt: string;
    readonly heartbeatTtlMs: number;
  }): ComputeNode {
    const id = prefixed("compute node id", input.id, "compute-node:") as ComputeNodeId;
    if (this.#nodes.has(id)) throw new Error(`compute node already exists: ${id}`);
    const registeredAt = normalizeInstant(input.registeredAt);
    const node: ComputeNode = deepFreeze({
      id,
      workspaceId: prefixed("workspace id", input.workspaceId, "workspace:") as WorkspaceId,
      capabilities: normalizeCapabilities(input.capabilities),
      version: 1,
      registeredAt,
      lastHeartbeatAt: registeredAt,
      heartbeatExpiresAt: addMilliseconds(registeredAt, positiveInteger("heartbeatTtlMs", input.heartbeatTtlMs)),
    });
    this.#nodes.set(id, node);
    return node;
  }

  heartbeat(input: {
    readonly workspaceId: string;
    readonly nodeId: string;
    readonly expectedVersion: number;
    readonly recordedAt: string;
    readonly heartbeatTtlMs: number;
  }): ComputeNode {
    const node = this.#node(input.workspaceId, input.nodeId);
    if (input.expectedVersion !== node.version) {
      throw new Error(`compute node version conflict: expected ${input.expectedVersion}, actual ${node.version}`);
    }
    const recordedAt = normalizeInstant(input.recordedAt);
    if (Date.parse(recordedAt) < Date.parse(node.lastHeartbeatAt)) {
      throw new Error(`compute node heartbeat time cannot move backward: ${node.id}`);
    }
    if (Date.parse(recordedAt) > Date.parse(node.heartbeatExpiresAt)) {
      throw new Error(`compute node heartbeat lease expired: ${node.id}`);
    }
    const updated: ComputeNode = deepFreeze({
      ...node,
      version: node.version + 1,
      lastHeartbeatAt: recordedAt,
      heartbeatExpiresAt: addMilliseconds(recordedAt, positiveInteger("heartbeatTtlMs", input.heartbeatTtlMs)),
    });
    this.#nodes.set(node.id, updated);
    return updated;
  }

  discover(input: {
    readonly workspaceId: string;
    readonly requiredCapabilities: readonly string[];
    readonly at: string;
  }): readonly ComputeNode[] {
    const workspaceId = prefixed("workspace id", input.workspaceId, "workspace:");
    const required = normalizeCapabilities(input.requiredCapabilities);
    const at = normalizeInstant(input.at);
    return deepFreeze(
      [...this.#nodes.values()]
        .filter(
          (node) =>
            node.workspaceId === workspaceId &&
            Date.parse(at) <= Date.parse(node.heartbeatExpiresAt) &&
            required.every((capability) => node.capabilities.includes(capability)),
        )
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
  }

  lease(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly nodeId: string;
    readonly workloadId: string;
    readonly requiredCapabilities: readonly string[];
    readonly leasedAt: string;
    readonly ttlMs: number;
  }): ComputeLease {
    const id = prefixed("compute lease id", input.id, "compute-lease:") as ComputeLeaseId;
    if (this.#leases.has(id)) throw new Error(`compute lease already exists: ${id}`);
    const node = this.#node(input.workspaceId, input.nodeId);
    const leasedAt = normalizeInstant(input.leasedAt);
    if (Date.parse(leasedAt) > Date.parse(node.heartbeatExpiresAt)) {
      throw new Error(`compute node heartbeat lease expired: ${node.id}`);
    }
    const capabilities = normalizeCapabilities(input.requiredCapabilities);
    assertCapabilities(node, capabilities);
    const lease: ComputeLease = deepFreeze({
      id,
      workspaceId: node.workspaceId,
      nodeId: node.id,
      workloadId: prefixed("workload id", input.workloadId, "workload:") as WorkloadId,
      requiredCapabilities: capabilities,
      leasedAt,
      expiresAt: addMilliseconds(leasedAt, positiveInteger("ttlMs", input.ttlMs)),
    });
    this.#leases.set(id, { lease });
    return lease;
  }

  consume(input: {
    readonly leaseId: string;
    readonly workspaceId: string;
    readonly workloadId: string;
    readonly executionId: string;
    readonly at: string;
  }): { readonly lease: ComputeLease; readonly node: ComputeNode } {
    const { state, node } = this.#allocation(input);
    state.consumedBy = prefixed("compute execution id", input.executionId, "compute-execution:") as ComputeExecutionId;
    return deepFreeze({ lease: state.lease, node });
  }

  inspectLease(input: {
    readonly leaseId: string;
    readonly workspaceId: string;
    readonly workloadId: string;
    readonly at: string;
  }): { readonly lease: ComputeLease; readonly node: ComputeNode } {
    const { state, node } = this.#allocation(input);
    return deepFreeze({ lease: state.lease, node });
  }

  #allocation(input: {
    readonly leaseId: string;
    readonly workspaceId: string;
    readonly workloadId: string;
    readonly at: string;
  }): { readonly state: LeaseState; readonly node: ComputeNode } {
    const leaseId = prefixed("compute lease id", input.leaseId, "compute-lease:");
    const state = this.#leases.get(leaseId);
    if (state === undefined) throw new Error(`compute lease does not exist: ${leaseId}`);
    const workspaceId = prefixed("workspace id", input.workspaceId, "workspace:");
    const workloadId = prefixed("workload id", input.workloadId, "workload:");
    if (state.lease.workspaceId !== workspaceId) throw new Error("compute lease is outside workspace");
    if (state.lease.workloadId !== workloadId) throw new Error("compute lease belongs to a different workload");
    const at = normalizeInstant(input.at);
    if (Date.parse(at) > Date.parse(state.lease.expiresAt)) throw new Error(`compute lease expired: ${leaseId}`);
    if (state.consumedBy !== undefined) throw new Error(`compute lease already consumed: ${leaseId}`);
    const node = this.#node(workspaceId, state.lease.nodeId);
    if (Date.parse(at) > Date.parse(node.heartbeatExpiresAt)) {
      throw new Error(`compute node heartbeat lease expired: ${node.id}`);
    }
    assertCapabilities(node, state.lease.requiredCapabilities);
    return { state, node };
  }

  #node(workspaceIdValue: string, nodeIdValue: string): ComputeNode {
    const workspaceId = prefixed("workspace id", workspaceIdValue, "workspace:");
    const nodeId = prefixed("compute node id", nodeIdValue, "compute-node:");
    const node = this.#nodes.get(nodeId);
    if (node === undefined) throw new Error(`compute node does not exist: ${nodeId}`);
    if (node.workspaceId !== workspaceId) throw new Error("compute node is outside workspace");
    return node;
  }
}

export class LocalComputeProvider {
  readonly #nodes: ComputeNodeRegistry;
  readonly #executor: WorkloadExecutor;
  readonly #authorize: (request: ComputeAuthorityRequest) => boolean | Promise<boolean>;
  readonly #limits: ComputeBudget;
  readonly #idempotency = new Map<string, { readonly fingerprint: string; readonly result: Promise<UsageReceipt> }>();
  readonly #workloads = new Map<string, string>();

  constructor(input: {
    readonly nodes: ComputeNodeRegistry;
    readonly executor: WorkloadExecutor;
    readonly authorize: (request: ComputeAuthorityRequest) => boolean | Promise<boolean>;
    readonly limits: ComputeBudget;
  }) {
    this.#nodes = input.nodes;
    this.#executor = input.executor;
    this.#authorize = input.authorize;
    this.#limits = normalizeBudget(input.limits);
  }

  execute(input: {
    readonly executionId: string;
    readonly workload: WorkloadSpec;
    readonly leaseId: string;
    readonly startedAt: string;
  }): Promise<UsageReceipt> {
    const executionId = prefixed("compute execution id", input.executionId, "compute-execution:") as ComputeExecutionId;
    const workload = normalizeWorkload(input.workload);
    const leaseId = prefixed("compute lease id", input.leaseId, "compute-lease:");
    const startedAt = normalizeInstant(input.startedAt);
    const key = `${workload.workspaceId}\u0000${workload.idempotencyKey}`;
    const fingerprint = stableStringify({ executionId, workload, leaseId, startedAt });
    const existing = this.#idempotency.get(key);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new Error(`idempotency key reused with different compute request: ${workload.idempotencyKey}`));
      }
      return existing.result;
    }
    const workloadKey = `${workload.workspaceId}\u0000${workload.id}`;
    if (this.#workloads.has(workloadKey)) {
      return Promise.reject(new Error(`duplicate workload execution denied: ${workload.id}`));
    }

    const result = this.#run({ executionId, workload, leaseId, startedAt });
    this.#idempotency.set(key, { fingerprint, result });
    this.#workloads.set(workloadKey, key);
    void result.catch(() => {
      if (this.#idempotency.get(key)?.result === result) this.#idempotency.delete(key);
      if (this.#workloads.get(workloadKey) === key) this.#workloads.delete(workloadKey);
    });
    return result;
  }

  async #run(input: {
    readonly executionId: ComputeExecutionId;
    readonly workload: NormalizedWorkloadSpec;
    readonly leaseId: string;
    readonly startedAt: string;
  }): Promise<UsageReceipt> {
    assertBudgetWithin(input.workload.budget, this.#limits, "provider limits");
    const candidate = this.#nodes.inspectLease({
      leaseId: input.leaseId,
      workspaceId: input.workload.workspaceId,
      workloadId: input.workload.id,
      at: input.startedAt,
    });
    const authorityRequest: ComputeAuthorityRequest = deepFreeze({
      operation: "EXECUTE_WORKLOAD" as const,
      workspaceId: input.workload.workspaceId,
      principalId: input.workload.requestedByPrincipalId,
      workloadId: input.workload.id,
      nodeId: candidate.node.id,
      authorityReference: input.workload.authorityReference,
    });
    let authorized = false;
    try {
      authorized = (await this.#authorize(authorityRequest)) === true;
    } catch {
      authorized = false;
    }
    if (!authorized) throw new Error(`compute authority denied: ${input.workload.id}`);

    const allocated = this.#nodes.consume({
      leaseId: input.leaseId,
      workspaceId: input.workload.workspaceId,
      workloadId: input.workload.id,
      executionId: input.executionId,
      at: input.startedAt,
    });

    const observation = normalizeObservation(
      await this.#executor.execute(
        deepFreeze({
          executionId: input.executionId,
          workload: input.workload,
          node: allocated.node,
          lease: allocated.lease,
          budget: input.workload.budget,
          startedAt: input.startedAt,
        }),
      ),
    );
    const budgetExceeded = exceedsBudget(observation.usage, input.workload.budget);
    return deepFreeze({
      contract: "woyengi.compute-usage.v1" as const,
      id: input.executionId,
      workloadId: input.workload.id,
      workspaceId: input.workload.workspaceId,
      requestedByPrincipalId: input.workload.requestedByPrincipalId,
      nodeId: allocated.node.id,
      leaseId: allocated.lease.id,
      idempotencyKey: input.workload.idempotencyKey,
      authorityReference: input.workload.authorityReference,
      status: budgetExceeded ? ("budget-exceeded" as const) : observation.outcome,
      ...(!budgetExceeded && observation.output !== undefined ? { output: cloneValue(observation.output) } : {}),
      usage: observation.usage,
      startedAt: input.startedAt,
      finishedAt: observation.finishedAt,
      observationOnly: true as const,
      semanticMutation: false as const,
    });
  }
}

function normalizeWorkload(input: WorkloadSpec): NormalizedWorkloadSpec {
  return deepFreeze({
    id: prefixed("workload id", input.id, "workload:") as WorkloadId,
    workspaceId: prefixed("workspace id", input.workspaceId, "workspace:") as WorkspaceId,
    requestedByPrincipalId: prefixed("principal id", input.requestedByPrincipalId, "principal:") as PrincipalId,
    operation: namespaced("workload operation", input.operation),
    input: cloneValue(input.input),
    requiredCapabilities: normalizeCapabilities(input.requiredCapabilities),
    budget: normalizeBudget(input.budget),
    authorityReference: namespaced("authority reference", input.authorityReference),
    idempotencyKey: namespaced("idempotency key", input.idempotencyKey),
    createdAt: normalizeInstant(input.createdAt),
  });
}

function normalizeBudget(input: ComputeBudget): ComputeBudget {
  return deepFreeze({
    maxDurationMs: nonNegativeNumber("maxDurationMs", input.maxDurationMs),
    maxOutputBytes: nonNegativeInteger("maxOutputBytes", input.maxOutputBytes),
    maxCost: normalizeMoney(input.maxCost),
  });
}

function normalizeObservation(input: WorkloadExecutionObservation): WorkloadExecutionObservation {
  if (input.outcome !== "succeeded" && input.outcome !== "failed") throw new TypeError("invalid execution outcome");
  return deepFreeze({
    outcome: input.outcome,
    ...(input.output === undefined ? {} : { output: cloneValue(input.output) }),
    usage: {
      durationMs: nonNegativeNumber("usage durationMs", input.usage.durationMs),
      outputBytes: nonNegativeInteger("usage outputBytes", input.usage.outputBytes),
      cost: normalizeMoney(input.usage.cost),
    },
    finishedAt: normalizeInstant(input.finishedAt),
  });
}

function normalizeMoney(input: MonetaryAmount): MonetaryAmount {
  const currency = requiredText("currency", input.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError("currency must be a three-letter code");
  return deepFreeze({ amount: nonNegativeNumber("amount", input.amount), currency });
}

function assertBudgetWithin(requested: ComputeBudget, limit: ComputeBudget, label: string): void {
  if (requested.maxCost.currency !== limit.maxCost.currency) throw new Error(`compute budget currency is outside ${label}`);
  if (
    requested.maxDurationMs > limit.maxDurationMs ||
    requested.maxOutputBytes > limit.maxOutputBytes ||
    requested.maxCost.amount > limit.maxCost.amount
  ) {
    throw new Error(`compute budget exceeds ${label}`);
  }
}

function exceedsBudget(usage: ExecutionUsage, budget: ComputeBudget): boolean {
  return (
    usage.durationMs > budget.maxDurationMs ||
    usage.outputBytes > budget.maxOutputBytes ||
    usage.cost.currency !== budget.maxCost.currency ||
    usage.cost.amount > budget.maxCost.amount
  );
}

function normalizeCapabilities(values: readonly string[]): readonly string[] {
  const normalized = [...new Set(values.map((value) => namespaced("compute capability", value)))].sort();
  if (normalized.length === 0) throw new TypeError("at least one compute capability is required");
  return Object.freeze(normalized);
}

function assertCapabilities(node: ComputeNode, required: readonly string[]): void {
  const missing = required.filter((capability) => !node.capabilities.includes(capability));
  if (missing.length > 0) throw new Error(`compute node lacks capabilities: ${missing.join(", ")}`);
}

function cloneValue(value: ComputeValue): ComputeValue {
  return structuredClone(value);
}

function addMilliseconds(instant: string, durationMs: number): string {
  return new Date(Date.parse(instant) + durationMs).toISOString();
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return value;
}

function nonNegativeNumber(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be non-negative and finite`);
  return value;
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return date.toISOString();
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
