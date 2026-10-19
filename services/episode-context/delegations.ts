import { PostgresCanonicalLedger, type PostgresPool,
  type PostgresWorkJournal, type PostgresWorkspaceJournal,
} from "../postgres-storage/index.ts";
import type {
  EpisodeAgentDelegationRequest, EpisodeAgentDelegationDecision,
  TrustedEpisodeAgentDelegation,
} from "./work-authority.ts";

type AgentContextOperation = "READ" | "PROPOSE";
interface DelegationGrant {
  readonly grantId: string;
  readonly workspaceId: string;
  readonly workInstanceId: string;
  readonly workEpisodeId: string;
  readonly agentPrincipalId: string;
  readonly sponsorPrincipalId: string;
  readonly operations: readonly AgentContextOperation[];
  readonly issuedAt: string;
  readonly expiresAt: string;
}
interface EventBase {
  readonly id: string;
  readonly workspaceId: string;
  readonly transactionTime: { readonly from: string };
  readonly ledgerSequence?: number;
}
export interface AgentDelegationIssued extends EventBase {
  readonly kind: "agent.delegation.issued";
  readonly grant: DelegationGrant;
  readonly issuerPrincipalId: string;
  readonly authorityReference: string;
  readonly rationale: string;
}
export interface AgentDelegationRevoked extends EventBase {
  readonly kind: "agent.delegation.revoked";
  readonly grantId: string;
  readonly revokedByPrincipalId: string;
  readonly reason: string;
}
export type AgentDelegationOperation = AgentDelegationIssued | AgentDelegationRevoked;

const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_OPERATIONS = new Set(["READ", "PROPOSE"]);

function id(label: string, value: unknown, prefix: string): void {
  if (typeof value !== "string" || !value.startsWith(prefix)
    || value.length > 512 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.slice(prefix.length))) {
    throw new TypeError(`${label} must be a bounded ${prefix} identifier`);
  }
}
function time(label: string, value: unknown): number {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} requires an offset-aware timestamp`);
  }
  return Date.parse(value);
}
function note(label: string, value: unknown): void {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) {
    throw new TypeError(`${label} must be nonempty and bounded`);
  }
}
function validateGrant(grant: DelegationGrant): void {
  if (!grant || typeof grant !== "object"
    || Object.keys(grant).some(key => ![
      "grantId", "workspaceId", "workInstanceId", "workEpisodeId",
      "agentPrincipalId", "sponsorPrincipalId", "operations", "issuedAt", "expiresAt",
    ].includes(key))) throw new Error("unexpected agent delegation grant fields");
  id("grant", grant.grantId, "agent-delegation:");
  id("workspace", grant.workspaceId, "workspace:");
  id("Work instance", grant.workInstanceId, "work-instance:");
  id("Work episode", grant.workEpisodeId, "work-episode:");
  id("agent", grant.agentPrincipalId, "principal:");
  id("human sponsor", grant.sponsorPrincipalId, "principal:");
  if (grant.agentPrincipalId === grant.sponsorPrincipalId) {
    throw new Error("delegation sponsor cannot be same principal as agent");
  }
  if (!Array.isArray(grant.operations) || grant.operations.length === 0
    || grant.operations.length > 2
    || new Set(grant.operations).size !== grant.operations.length
    || !grant.operations.every(op => ALLOWED_OPERATIONS.has(op))) {
    throw new Error("agent delegation operations must be bounded READ or PROPOSE");
  }
  const start = time("delegation issuedAt", grant.issuedAt);
  const end = time("delegation expiresAt", grant.expiresAt);
  if (end <= start || end - start > MAX_DURATION_MS) {
    throw new Error("agent delegation expiry must be after issuance and within seven days");
  }
}
function validateEvent(event: AgentDelegationOperation): void {
  if (!event || (event.kind !== "agent.delegation.issued"
    && event.kind !== "agent.delegation.revoked")) {
    throw new Error("unsupported canonical agent delegation operation");
  }
  id("delegation event", event.id, "agent-delegation-operation:");
  id("workspace", event.workspaceId, "workspace:");
  time("transaction time", event.transactionTime?.from);
  const keys = ["id", "kind", "workspaceId", "transactionTime", "ledgerSequence"];
  if (event.kind === "agent.delegation.issued") {
    keys.push("grant", "issuerPrincipalId", "authorityReference", "rationale");
    validateGrant(event.grant);
    id("issuer", event.issuerPrincipalId, "principal:");
    id("authority", event.authorityReference, "decision:");
    note("delegation rationale", event.rationale);
    if (event.workspaceId !== event.grant.workspaceId
      || event.issuerPrincipalId !== event.grant.sponsorPrincipalId
      || event.id !== "agent-delegation-operation:issued:" + event.grant.grantId
      || time("transaction time", event.transactionTime.from)
        !== time("grant issuance", event.grant.issuedAt)) {
      throw new Error("agent delegation issuance identity/scope/time mismatch");
    }
  } else {
    keys.push("grantId", "revokedByPrincipalId", "reason");
    id("grant", event.grantId, "agent-delegation:");
    id("revoker", event.revokedByPrincipalId, "principal:");
    note("revocation reason", event.reason);
    if (event.id !== "agent-delegation-operation:revoked:" + event.grantId) {
      throw new Error("agent delegation revocation identity mismatch");
    }
  }
  if (Object.keys(event).some(key => !keys.includes(key))) {
    throw new Error("unexpected canonical agent delegation event field");
  }
}
function replay(history: readonly AgentDelegationOperation[]): {
  readonly issued: Map<string, AgentDelegationIssued>;
  readonly revoked: Set<string>;
} {
  const issued = new Map<string, AgentDelegationIssued>();
  const revoked = new Set<string>();
  const ids = new Set<string>();
  let sequence = 0;
  for (const event of history) {
    validateEvent(event);
    if (event.ledgerSequence !== ++sequence || ids.has(event.id)) {
      throw new Error("invalid agent delegation causal sequence or duplicate event");
    }
    ids.add(event.id);
    if (event.kind === "agent.delegation.issued") {
      if (issued.has(event.grant.grantId)) throw new Error("duplicate agent delegation grant");
      issued.set(event.grant.grantId, event);
    } else {
      const grant = issued.get(event.grantId);
      if (!grant || revoked.has(event.grantId)
        || grant.workspaceId !== event.workspaceId
        || event.revokedByPrincipalId !== grant.grant.sponsorPrincipalId
        || time("revocation time", event.transactionTime.from)
          < time("issuance time", grant.transactionTime.from)) {
        throw new Error("unknown, duplicate or unauthorized agent delegation revocation");
      }
      revoked.add(event.grantId);
    }
  }
  return { issued, revoked };
}
function intersect(grant: DelegationGrant, other: DelegationGrant): boolean {
  return grant.agentPrincipalId === other.agentPrincipalId
    && grant.workInstanceId === other.workInstanceId
    && grant.workEpisodeId === other.workEpisodeId
    && grant.operations.some(operation => other.operations.includes(operation))
    && time("grant expiration", grant.expiresAt) > time("other issuance", other.issuedAt)
    && time("other expiration", other.expiresAt) > time("grant issuance", grant.issuedAt);
}

/**
 * Immutable, Work-bound, human-sponsored AgentPrincipal *context* grants.
 * Grants never confer executor/provider rights, external side effects or
 * permission to promote proposals into governing canonical truth.
 *
 * The caller must be authenticated independently. No public agent-facing
 * issue/revoke RPC is provided. Revocation is replayed on every resolve;
 * separate PostgreSQL connections observe the same committed grant history.
 */
export class PostgresEpisodeDelegationJournal {
  readonly #ledger: PostgresCanonicalLedger<AgentDelegationOperation>;
  readonly #workspaces: PostgresWorkspaceJournal;
  readonly #work: PostgresWorkJournal;
  readonly #now: () => number;

  private constructor(input: {
    readonly ledger: PostgresCanonicalLedger<AgentDelegationOperation>;
    readonly workspaces: PostgresWorkspaceJournal;
    readonly work: PostgresWorkJournal;
    readonly now: () => number;
  }) {
    this.#ledger = input.ledger;
    this.#workspaces = input.workspaces;
    this.#work = input.work;
    this.#now = input.now;
  }

  static open(input: {
    readonly pool: PostgresPool;
    readonly namespace?: string;
    readonly workspaces: PostgresWorkspaceJournal;
    readonly work: PostgresWorkJournal;
    readonly now?: () => number;
  }): PostgresEpisodeDelegationJournal {
    return new PostgresEpisodeDelegationJournal({
      ledger: PostgresCanonicalLedger.open({
        pool: input.pool, namespace: input.namespace ?? "agent-episode-delegations",
      }),
      workspaces: input.workspaces, work: input.work,
      now: input.now ?? Date.now,
    });
  }

  /** Privileged operator audit; not an unscoped agent-readable endpoint. */
  async history(input: { readonly workspaceId: string }): Promise<readonly AgentDelegationOperation[]> {
    id("workspace", input.workspaceId, "workspace:");
    const history = await this.#ledger.load({ workspaceId: input.workspaceId });
    replay(history);
    return history;
  }

  async #validateSponsor(grant: DelegationGrant): Promise<void> {
    const snapshot = await this.#workspaces.snapshot();
    const registrations = snapshot.history()
      .filter(op => op.kind === "principal.registered");
    const agent = registrations.find(op => op.principal.id === grant.agentPrincipalId);
    if (!agent || agent.principal.kind !== "agent") {
      throw new Error("agent delegation target must be a registered AgentPrincipal");
    }
    const sponsor = registrations.find(op => op.principal.id === grant.sponsorPrincipalId);
    if (!sponsor || sponsor.principal.kind !== "human") {
      throw new Error("agent delegation sponsor must be registered human");
    }
    const instance = await this.#work.workInstance({
      principalId: grant.sponsorPrincipalId,
      workspaceId: grant.workspaceId, id: grant.workInstanceId,
    });
    if (instance.status !== "active"
      || !(instance.roles.workOwners.includes(sponsor.principal.id)
        || instance.roles.decisionAuthorities.includes(sponsor.principal.id))) {
      throw new Error("agent delegation sponsor lacks governing Work role");
    }
    const history = await this.#work.history({
      principalId: grant.sponsorPrincipalId, workspaceId: grant.workspaceId,
    });
    if (!history.some(op => op.kind === "work-episode.started"
      && op.workInstanceId === grant.workInstanceId
      && op.episode.id === grant.workEpisodeId
      && op.episode.status === "active")) {
      throw new Error("agent delegation Work episode is outside active sponsor scope");
    }
  }

  /** Trusted human Work owner/decision authority only. */
  async issue(input: DelegationGrant & {
    readonly issuerPrincipalId: string;
    readonly authorityReference: string;
    readonly rationale: string;
  }): Promise<void> {
    validateGrant(input);
    id("issuer", input.issuerPrincipalId, "principal:");
    id("authority reference", input.authorityReference, "decision:");
    note("issuance rationale", input.rationale);
    if (input.issuerPrincipalId !== input.sponsorPrincipalId) {
      throw new Error("agent delegation issuer must be the sponsoring human");
    }
    if (time("issuedAt", input.issuedAt) > this.#now()) {
      throw new Error("agent delegation cannot be future issued");
    }
    if (time("expiresAt", input.expiresAt) <= this.#now()) {
      throw new Error("cannot issue already expired agent delegation");
    }
    await this.#validateSponsor(input);
    const grant: DelegationGrant = {
      grantId: input.grantId, workspaceId: input.workspaceId,
      workInstanceId: input.workInstanceId, workEpisodeId: input.workEpisodeId,
      agentPrincipalId: input.agentPrincipalId,
      sponsorPrincipalId: input.sponsorPrincipalId,
      operations: [...input.operations], issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    };
    const record: AgentDelegationIssued = {
      id: "agent-delegation-operation:issued:" + grant.grantId,
      kind: "agent.delegation.issued",
      workspaceId: grant.workspaceId,
      transactionTime: { from: new Date(time("issuedAt", grant.issuedAt)).toISOString() },
      issuerPrincipalId: input.issuerPrincipalId,
      authorityReference: input.authorityReference,
      rationale: input.rationale.trim(), grant,
    };
    await this.#ledger.appendValidated({
      workspaceId: grant.workspaceId,
      decide: history => {
        const state = replay(history);
        if (state.issued.has(grant.grantId)) throw new Error("agent delegation already issued");
        if ([...state.issued.values()].some(prior => !state.revoked.has(prior.grant.grantId)
          && intersect(grant, prior.grant))) {
          throw new Error("overlapping active agent delegation scope denied");
        }
        return { record, result: undefined };
      },
    });
  }

  /** Trusted human sponsor only. Revocation does not delete prior facts. */
  async revoke(input: {
    readonly grantId: string; readonly workspaceId: string;
    readonly revokedByPrincipalId: string; readonly recordedAt: string;
    readonly reason: string;
  }): Promise<AgentDelegationRevoked> {
    id("grant", input.grantId, "agent-delegation:");
    id("workspace", input.workspaceId, "workspace:");
    id("revoker", input.revokedByPrincipalId, "principal:");
    note("revocation reason", input.reason);
    const at = time("revocation recordedAt", input.recordedAt);
    if (at > this.#now()) throw new Error("future-dated delegation revocation denied");
    const record: AgentDelegationRevoked = {
      id: "agent-delegation-operation:revoked:" + input.grantId,
      kind: "agent.delegation.revoked", workspaceId: input.workspaceId,
      transactionTime: { from: new Date(at).toISOString() },
      grantId: input.grantId, revokedByPrincipalId: input.revokedByPrincipalId,
      reason: input.reason.trim(),
    };
    const prior = replay(await this.history({ workspaceId: input.workspaceId }));
    const issued = prior.issued.get(input.grantId);
    if (!issued || issued.grant.sponsorPrincipalId !== input.revokedByPrincipalId) {
      throw new Error("agent delegation revoker must be original human sponsor");
    }
    await this.#validateSponsor(issued.grant);
    await this.#ledger.appendValidated({
      workspaceId: input.workspaceId,
      decide: history => {
        const state = replay(history);
        const original = state.issued.get(input.grantId);
        if (!original) throw new Error("unknown agent delegation grant");
        if (state.revoked.has(input.grantId)) throw new Error("agent delegation already revoked");
        if (original.grant.sponsorPrincipalId !== input.revokedByPrincipalId) {
          throw new Error("agent delegation revoker denied");
        }
        if (at < time("grant issuedAt", original.grant.issuedAt)) {
          throw new Error("agent delegation revocation precedes issuance");
        }
        return { record, result: record };
      },
    });
    return record;
  }

  /** Direct adapter for createWorkBoundEpisodePolicies.authorizeAgentDelegation. */
  async resolve(request: EpisodeAgentDelegationRequest): Promise<EpisodeAgentDelegationDecision | undefined> {
    id("agent", request.agentPrincipalId, "principal:");
    id("workspace", request.workspaceId, "workspace:");
    id("Work instance", request.workInstanceId, "work-instance:");
    id("Work episode", request.workEpisodeId, "work-episode:");
    if (!ALLOWED_OPERATIONS.has(request.operation)) return undefined;
    const state = replay(await this.history({ workspaceId: request.workspaceId }));
    const now = this.#now();
    const active = [...state.issued.values()].filter(event =>
      !state.revoked.has(event.grant.grantId)
      && event.grant.agentPrincipalId === request.agentPrincipalId
      && event.grant.workInstanceId === request.workInstanceId
      && event.grant.workEpisodeId === request.workEpisodeId
      && event.grant.operations.includes(request.operation)
      && now >= time("grant issuedAt", event.grant.issuedAt)
      && now < time("grant expiresAt", event.grant.expiresAt));
    if (active.length > 1) throw new Error("ambiguous active agent delegation scope");
    if (active.length === 0) return undefined;
    const grant = active[0]?.grant;
    if (!grant) return undefined;
    await this.#validateSponsor(grant);
    return { sponsorPrincipalId: grant.sponsorPrincipalId };
  }
}

// The delegated context port is deliberately structural, but keep this
// compile-time assertion so later interface changes cannot silently widen
// grant operations into external execution rights.
const _conforms: TrustedEpisodeAgentDelegation = async request => {
  void request;
  return undefined;
};
void _conforms;
