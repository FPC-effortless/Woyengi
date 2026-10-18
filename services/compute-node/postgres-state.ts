import type {
  ComputeNodeStatePort, HostedAuthorityDecision, HostedAuthorityRequest,
  HostedComputeNodeHeartbeat, HostedComputeNodeRegistration, HostedComputeNodeSession,
  HostedComputeObservation, HostedLeaseRequest, HostedWorkloadLease,
} from "./index.ts";
import { PostgresCanonicalLedger, type PostgresPool } from "../postgres-storage/index.ts";
import { PostgresHostedObservationJournal } from "./postgres-observations.ts";

interface StateBase {
  readonly id: string;
  readonly transactionTime: { readonly from: string };
  readonly ledgerSequence?: number;
}
interface Registered extends StateBase {
  readonly kind: "compute.node.registered";
  readonly registration: HostedComputeNodeRegistration;
  readonly session: HostedComputeNodeSession;
}
interface Heartbeat extends StateBase {
  readonly kind: "compute.node.heartbeat";
  readonly session: HostedComputeNodeSession;
}
interface Queued extends StateBase {
  readonly kind: "compute.lease.queued";
  readonly lease: HostedWorkloadLease;
}
interface Issued extends StateBase {
  readonly kind: "compute.lease.issued";
  readonly leaseId: string;
  readonly nodeId: string;
}
export type HostedComputeStateOperation = Registered | Heartbeat | Queued | Issued;
interface NodeState {
  readonly registration: HostedComputeNodeRegistration;
  session: HostedComputeNodeSession;
}
interface State {
  readonly nodes: Map<string, NodeState>;
  readonly queued: Map<string, HostedWorkloadLease>;
  readonly issued: Set<string>;
}
class NoLeaseAvailable extends Error {}

function date(label: string, value: string): number {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid offset-aware timestamp`);
  }
  return Date.parse(value);
}
function id(label: string, value: string, prefix: string): void {
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > 512
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.slice(prefix.length))) {
    throw new TypeError(`${label} requires a ${prefix} identifier`);
  }
}
function plain(value: unknown): string {
  // Node's hosted runtime canonicalizes RFC3339 instants to .000Z. A
  // registered-at timestamp or lease envelope is semantically unchanged by
  // that formatting; compare instants canonically instead of byte-for-byte.
  if (typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value))) {
    return JSON.stringify(new Date(value).toISOString());
  }
  if (Array.isArray(value)) return "[" + value.map(plain).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ":" + plain(item)).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}
function same(a: unknown, b: unknown): boolean { return plain(a) === plain(b); }
function bound(label: string, x: number, upper: number): void {
  if (!Number.isFinite(x) || x < 0 || x > upper) throw new TypeError(`${label} outside allowed range`);
}
function validateRegistration(r: HostedComputeNodeRegistration): void {
  if (!r || typeof r !== "object") throw new TypeError("missing compute registration");
  id("node", r.nodeId, "compute-node:");
  if (!/^\d+\.\d+\.\d+$/.test(r.version)) throw new TypeError("invalid node version");
  if (!Array.isArray(r.workspaceIds) || r.workspaceIds.length === 0
    || !Array.isArray(r.capabilities) || r.capabilities.length === 0) {
    throw new TypeError("compute node requires explicit workspaces and capabilities");
  }
  for (const w of r.workspaceIds) id("workspace", w, "workspace:");
  for (const c of r.capabilities) if (!/^[a-z][a-z0-9_-]*:[A-Za-z0-9._:-]+$/.test(c)) {
    throw new TypeError("invalid compute capability");
  }
  bound("heartbeat TTL", r.heartbeatTtlMs, 3_600_000);
  if (r.heartbeatTtlMs < 1000 || !Number.isSafeInteger(r.heartbeatTtlMs)) {
    throw new TypeError("heartbeat TTL out of bounds");
  }
  date("registration timestamp", r.registeredAt);
  validateBudget(r.budgetLimit);
}
function validateBudget(b: HostedWorkloadLease["envelope"]["budget"]): void {
  if (!b || !b.maxCost || typeof b.maxCost.currency !== "string"
    || !/^[A-Z]{3}$/.test(b.maxCost.currency)) throw new TypeError("invalid budget");
  bound("budget duration", b.maxDurationMs, 86_400_000);
  bound("budget output", b.maxOutputBytes, 50_000_000);
  bound("budget cost", b.maxCost.amount, 1_000_000_000);
}
function validateLease(l: HostedWorkloadLease): void {
  if (!l || typeof l !== "object" || !l.envelope || !l.envelope.workload
    || !l.envelope.correlation) throw new TypeError("missing governed workload");
  id("lease", l.id, "compute-lease:");
  id("node", l.nodeId, "compute-node:");
  id("session", l.sessionId, "compute-node-session:");
  id("execution", l.envelope.executionId, "compute-execution:");
  id("principal", l.envelope.principalId, "principal:");
  id("workspace", l.envelope.correlation.workspaceId, "workspace:");
  id("workload", l.envelope.workload.id, "workload:");
  if (l.envelope.workload.workspaceId !== l.envelope.correlation.workspaceId
    || l.envelope.workload.requestedByPrincipalId !== l.envelope.principalId
    || l.envelope.workload.authorityReference !== l.envelope.authorityReference
    || l.envelope.workload.idempotencyKey !== l.envelope.idempotencyKey
    || !same(l.envelope.budget, l.envelope.workload.budget)) {
    throw new Error("hosted workload authority/scope correlation mismatch");
  }
  if (!l.envelope.authorityReference || !l.envelope.idempotencyKey) {
    throw new TypeError("missing hosted authority reference");
  }
  if (!Array.isArray(l.envelope.workload.requiredCapabilities)
    || l.envelope.workload.requiredCapabilities.length === 0) {
    throw new TypeError("compute workload requires scoped capabilities");
  }
  validateBudget(l.envelope.budget);
  id("effect", l.envelope.expectedEffect?.id, "expected-effect:");
  id("reconciliation", l.envelope.reconciliation?.id, "reconciliation:");
  if (l.envelope.expectedEffect.effectClass === "EXTERNAL"
    && l.envelope.reconciliation.required !== true) {
    throw new Error("external effects require reconciliation");
  }
  if (date("lease expiry", l.expiresAt) <= date("lease start", l.leasedAt)
    || date("envelope start", l.envelope.startedAt) > date("lease expiry", l.expiresAt)) {
    throw new Error("invalid lease validity");
  }
}
function replay(history: readonly HostedComputeStateOperation[]): State {
  const nodes = new Map<string, NodeState>();
  const queued = new Map<string, HostedWorkloadLease>();
  const issued = new Set<string>();
  const operations = new Set<string>();
  let sequence = 0;
  for (const record of history) {
    if (!record || ![
      "compute.node.registered", "compute.node.heartbeat",
      "compute.lease.queued", "compute.lease.issued",
    ].includes(record.kind)) throw new Error("unsupported canonical hosted compute state operation");
    if (record.ledgerSequence !== sequence + 1) throw new Error("invalid hosted compute causal sequence");
    sequence = record.ledgerSequence;
    date("canonical transaction time", record.transactionTime?.from);
    if (operations.has(record.id)) throw new Error("duplicate canonical compute operation");
    operations.add(record.id);
    const fields = ["id", "kind", "ledgerSequence", "transactionTime"];
    if (record.kind === "compute.node.registered") fields.push("registration", "session");
    if (record.kind === "compute.node.heartbeat") fields.push("session");
    if (record.kind === "compute.lease.queued") fields.push("lease");
    if (record.kind === "compute.lease.issued") fields.push("leaseId", "nodeId");
    if (Object.keys(record).some(k => !fields.includes(k))) throw new Error("unexpected compute state fields");
    switch (record.kind) {
      case "compute.node.registered":
        validateRegistration(record.registration);
        if (nodes.has(record.registration.nodeId)
          || record.session.nodeId !== record.registration.nodeId
          || date("session expiry", record.session.heartbeatExpiresAt)
            <= date("session accepted", record.session.acceptedAt)) {
          throw new Error("duplicate or corrupt compute node registration");
        }
        nodes.set(record.registration.nodeId, {
          registration: record.registration, session: record.session,
        });
        break;
      case "compute.node.heartbeat": {
        const current = nodes.get(record.session.nodeId);
        if (!current || current.session.sessionId !== record.session.sessionId
          || date("session accepted", record.session.acceptedAt)
          <= date("session accepted", current.session.acceptedAt)) {
          throw new Error("unexpected compute node heartbeat");
        }
        current.session = record.session;
        break;
      }
      case "compute.lease.queued":
        validateLease(record.lease);
        if (queued.has(record.lease.id) || [...queued.values()].some(
          l => l.envelope.executionId === record.lease.envelope.executionId)) {
          throw new Error("duplicate hosted compute lease or execution");
        }
        if (!nodes.has(record.lease.nodeId)) throw new Error("unknown compute node lease target");
        queued.set(record.lease.id, record.lease);
        break;
      case "compute.lease.issued":
        if (issued.has(record.leaseId)
          || queued.get(record.leaseId)?.nodeId !== record.nodeId) {
          throw new Error("unknown or duplicate compute lease claim");
        }
        issued.add(record.leaseId);
        break;
    }
  }
  return { nodes, queued, issued };
}
function active(state: State, nodeId: string, sessionId: string, at: number): NodeState | undefined {
  const node = state.nodes.get(nodeId);
  return node && node.session.sessionId === sessionId
    && at >= date("session accepted", node.session.acceptedAt)
    && at < date("session expiry", node.session.heartbeatExpiresAt)
    ? node : undefined;
}
function matching(l: HostedWorkloadLease, n: NodeState): boolean {
  const w = l.envelope.workload;
  const budget = l.envelope.budget;
  const limit = n.registration.budgetLimit;
  return n.registration.workspaceIds.includes(l.envelope.correlation.workspaceId)
    && w.requiredCapabilities.every(c => n.registration.capabilities.includes(c))
    && budget.maxDurationMs <= limit.maxDurationMs
    && budget.maxOutputBytes <= limit.maxOutputBytes
    && budget.maxCost.currency === limit.maxCost.currency
    && budget.maxCost.amount <= limit.maxCost.amount;
}

export interface HostedComputeStatePolicy {
  (request: HostedAuthorityRequest): Promise<HostedAuthorityDecision>;
}

/**
 * One SQL-serialized state authority for node registrations, heartbeats,
 * trusted operator queueing and exclusive leases. No cached queue controls
 * state: every decision replays a global ledger inside a row-lock transaction.
 *
 * The supplied policy must perform independently trusted authorization,
 * including AgentPrincipal grant checks; a caller-provided authorityReference
 * is never sufficient by itself.
 */
export class PostgresHostedComputeStatePort implements ComputeNodeStatePort {
  readonly #ledger: PostgresCanonicalLedger<HostedComputeStateOperation>;
  readonly #receipts: PostgresHostedObservationJournal;
  readonly #providerId: string;
  readonly #policy: HostedComputeStatePolicy;
  readonly #now: () => number;

  private constructor(input: {
    readonly ledger: PostgresCanonicalLedger<HostedComputeStateOperation>;
    readonly receipts: PostgresHostedObservationJournal;
    readonly providerId: string;
    readonly authorize: HostedComputeStatePolicy;
    readonly now: () => number;
  }) {
    this.#ledger = input.ledger;
    this.#receipts = input.receipts;
    this.#providerId = input.providerId;
    this.#policy = input.authorize;
    this.#now = input.now;
  }

  static open(input: {
    readonly pool: PostgresPool;
    readonly namespace?: string;
    readonly receipts: PostgresHostedObservationJournal;
    readonly providerId: string;
    readonly authorize: HostedComputeStatePolicy;
    readonly now?: () => number;
  }): PostgresHostedComputeStatePort {
    id("provider", input.providerId, "provider:");
    if (typeof input.authorize !== "function") throw new TypeError("trusted compute policy required");
    return new PostgresHostedComputeStatePort({
      ledger: PostgresCanonicalLedger.open({
        pool: input.pool, namespace: input.namespace ?? "hosted-compute-state",
      }),
      receipts: input.receipts, providerId: input.providerId,
      authorize: input.authorize, now: input.now ?? Date.now,
    });
  }

  /** Operator-only canonical history, never an unscoped public endpoint. */
  async history(): Promise<readonly HostedComputeStateOperation[]> {
    const history = await this.#ledger.load();
    replay(history);
    return history;
  }

  async register(registration: HostedComputeNodeRegistration): Promise<HostedComputeNodeSession> {
    validateRegistration(registration);
    const history = await this.history();
    const existing = replay(history).nodes.get(registration.nodeId);
    if (existing) {
      if (!same(existing.registration, registration)) throw new Error("compute node registration conflict");
      return existing.session;
    }
    const suffix = registration.nodeId.slice("compute-node:".length);
    const session: HostedComputeNodeSession = {
      sessionId: "compute-node-session:" + suffix,
      nodeId: registration.nodeId, acceptedAt: registration.registeredAt,
      heartbeatExpiresAt: new Date(date("registeredAt", registration.registeredAt)
        + registration.heartbeatTtlMs).toISOString(),
    };
    const record: Registered = {
      id: "compute-state:node:" + suffix, kind: "compute.node.registered",
      transactionTime: { from: registration.registeredAt },
      registration: structuredClone(registration), session,
    };
    await this.#ledger.appendValidated({
      decide: prior => {
        if (replay(prior).nodes.has(registration.nodeId)) throw new Error("compute node registration conflict");
        return { record, result: undefined };
      },
    });
    return session;
  }

  async heartbeat(input: HostedComputeNodeHeartbeat): Promise<HostedComputeNodeSession> {
    id("node", input.nodeId, "compute-node:");
    id("node session", input.sessionId, "compute-node-session:");
    const at = date("heartbeat", input.recordedAt);
    return this.#ledger.appendValidated({
      decide: history => {
        const state = replay(history);
        const node = active(state, input.nodeId, input.sessionId, at);
        if (!node) throw new Error("compute node heartbeat denied: inactive session");
        if (at <= date("previous heartbeat", node.session.acceptedAt)) {
          throw new Error("compute node heartbeat must advance");
        }
        const updated: HostedComputeNodeSession = {
          ...node.session, acceptedAt: input.recordedAt,
          heartbeatExpiresAt: new Date(at + node.registration.heartbeatTtlMs).toISOString(),
        };
        const record: Heartbeat = {
          id: "compute-state:heartbeat:" + input.nodeId.slice("compute-node:".length)
            + ":" + String(history.length + 1),
          kind: "compute.node.heartbeat", transactionTime: { from: input.recordedAt },
          session: updated,
        };
        return { record, result: updated };
      },
    });
  }

  /**
   * Privileged state-server queueing only. The required policy is consulted
   * before committing. HTTP compute-node routes cannot queue work.
   */
  async queueLease(lease: HostedWorkloadLease): Promise<void> {
    validateLease(lease);
    const request: HostedAuthorityRequest = {
      operation: "EXECUTE_HOSTED_WORKLOAD", nodeId: lease.nodeId,
      providerId: this.#providerId, envelope: lease.envelope,
    };
    const decision = await this.#policy(request);
    if (!decision.allowed || decision.decisionReference !== lease.envelope.authorityReference) {
      throw new Error("hosted workload authority denied");
    }
    const record: Queued = {
      id: "compute-state:queued:" + lease.id, kind: "compute.lease.queued",
      transactionTime: { from: lease.leasedAt }, lease: structuredClone(lease),
    };
    await this.#ledger.appendValidated({
      decide: history => {
        const state = replay(history);
        const node = state.nodes.get(lease.nodeId);
        if (!node || node.session.sessionId !== lease.sessionId
          || !matching(lease, node)) {
          throw new Error("hosted workload node, scope, or budget mismatch");
        }
        if (state.queued.has(lease.id)) throw new Error("duplicate hosted compute lease");
        return { record, result: undefined };
      },
    });
  }

  async nextLease(request: HostedLeaseRequest): Promise<HostedWorkloadLease | undefined> {
    id("node", request.nodeId, "compute-node:");
    id("node session", request.sessionId, "compute-node-session:");
    const at = date("lease request", request.requestedAt);
    if (!Array.isArray(request.workspaceIds) || !Array.isArray(request.capabilities)) {
      throw new TypeError("compute node must declare workspaces and capabilities");
    }
    const choose = (state: State): HostedWorkloadLease | undefined => {
      const node = active(state, request.nodeId, request.sessionId, at);
      if (!node) return undefined;
      if (!same([...request.workspaceIds].sort(), [...node.registration.workspaceIds].sort())
        || !same([...request.capabilities].sort(), [...node.registration.capabilities].sort())) return undefined;
      return [...state.queued.values()].find(lease =>
        lease.nodeId === request.nodeId && lease.sessionId === request.sessionId
        && !state.issued.has(lease.id)
        && at >= date("lease start", lease.leasedAt)
        && at < date("lease expiry", lease.expiresAt)
        && matching(lease, node));
    };
    if (!choose(replay(await this.history()))) return undefined;
    try {
      return await this.#ledger.appendValidated({
        decide: history => {
          const lease = choose(replay(history));
          if (!lease) throw new NoLeaseAvailable("no unclaimed eligible hosted lease");
          const record: Issued = {
            id: "compute-state:issued:" + lease.id, kind: "compute.lease.issued",
            transactionTime: { from: request.requestedAt },
            leaseId: lease.id, nodeId: request.nodeId,
          };
          return { record, result: lease };
        },
      });
    } catch (error) {
      if (error instanceof NoLeaseAvailable) return undefined;
      throw error;
    }
  }

  async authorize(input: HostedAuthorityRequest): Promise<HostedAuthorityDecision> {
    const state = replay(await this.history());
    const lease = [...state.queued.values()].find(value =>
      value.nodeId === input.nodeId
      && value.envelope.executionId === input.envelope.executionId);
    if (!lease || !state.issued.has(lease.id) || !same(lease.envelope, input.envelope)) {
      throw new Error("compute execution not issued or authoritative envelope mismatch");
    }
    if (input.providerId !== this.#providerId
      || !active(state, lease.nodeId, lease.sessionId, this.#now())) {
      throw new Error("compute execution provider or session denied");
    }
    const result = await this.#policy(input);
    return result.allowed && result.decisionReference === lease.envelope.authorityReference
      ? result
      : { allowed: false, decisionReference: lease.envelope.authorityReference,
        reason: "trusted compute authority denied" };
  }

  async publishObservation(observation: HostedComputeObservation): Promise<void> {
    const state = replay(await this.history());
    const lease = state.queued.get(observation.leaseId);
    if (!lease || !state.issued.has(lease.id)) throw new Error("unknown or unissued compute lease");
    const e = lease.envelope;
    if (observation.nodeId !== lease.nodeId || observation.sessionId !== lease.sessionId
      || observation.executionId !== e.executionId
      || observation.providerId !== this.#providerId
      || observation.workloadId !== e.workload.id
      || observation.principalId !== e.principalId
      || observation.authorityReference !== e.authorityReference
      || observation.idempotencyKey !== e.idempotencyKey
      || !same(observation.correlation, e.correlation)
      || !same(observation.budget, e.budget)
      || observation.expectedEffectId !== e.expectedEffect.id
      || observation.expectedEffectClass !== e.expectedEffect.effectClass
      || observation.reconciliation.id !== e.reconciliation.id
      || observation.reconciliation.strategy !== e.reconciliation.strategy
      || observation.reconciliation.required !== e.reconciliation.required
      || observation.observationOnly !== true || observation.acceptedTruth !== false
      || observation.semanticMutation !== false || observation.reconciliation.status !== "PENDING") {
      throw new Error("compute observation does not match issued lease");
    }
    await this.#receipts.publishObservation(observation);
  }
}
