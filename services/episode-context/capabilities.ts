import { ContextGateway, type EpisodeCapabilityCandidate, type EpisodeContextRequest } from "../../packages/context-gateway/src/index.ts";
import { PostgresCanonicalLedger, type PostgresPool } from "../postgres-storage/index.ts";
import { instant, rationale, requireId } from "./validate.ts";

interface CapabilityBase {
  readonly id: string;
  readonly workspaceId: string;
  readonly ledgerSequence?: number;
  readonly transactionTime: { readonly from: string };
  readonly actorPrincipalId: string;
}
export interface CapabilityPublished extends CapabilityBase {
  readonly kind: "episode.capability.published";
  readonly candidate: EpisodeCapabilityCandidate;
  readonly authorityReference: string;
  readonly rationale: string;
}
export interface CapabilityRevoked extends CapabilityBase {
  readonly kind: "episode.capability.revoked";
  readonly capabilityId: string;
  readonly reason: string;
}
export type EpisodeCapabilityOperation = CapabilityPublished | CapabilityRevoked;

export interface EpisodeCapabilityAuthorityRequest {
  readonly operation: "READ" | "PUBLISH" | "REVOKE";
  readonly actorPrincipalId: string;
  readonly workspaceId: string;
  readonly workInstanceId: string;
  readonly workEpisodeId: string;
}
export type TrustedEpisodeCapabilityPolicy = (request: EpisodeCapabilityAuthorityRequest) => Promise<boolean>;

function secure(value: unknown): void {
  if (typeof value === "string") {
    if (/secret:|credential-ref:|capability-grant:/i.test(value)) {
      throw new Error("capability contains raw secret or credential/grant reference");
    }
    return;
  }
  if (Array.isArray(value)) { for (const x of value) secure(x); return; }
  if (value && typeof value === "object") {
    for (const [key, content] of Object.entries(value)) {
      if (/(?:secret|password|passphrase|token|credential|bearer|private[-_]?key|grant)/i.test(key)) {
        throw new Error("capability contains raw secret or credential/grant data");
      }
      secure(content);
    }
  }
}

function validateCandidate(candidate: EpisodeCapabilityCandidate): void {
  if (!candidate || typeof candidate !== "object") throw new Error("missing episode capability");
  requireId("capability", candidate.id, "episode-capability:");
  requireId("workspace", candidate.workspaceId, "workspace:");
  requireId("work instance", candidate.workInstanceId, "work-instance:");
  requireId("work episode", candidate.workEpisodeId, "work-episode:");
  if (!["provider", "resource", "authority", "budget", "policy"].includes(candidate.kind)) {
    throw new Error("unsupported episode capability kind");
  }
  const vt = instant("capability valid-time", candidate.validTime?.from);
  if (candidate.validTime.to !== undefined
    && instant("capability valid end", candidate.validTime.to) <= vt) {
    throw new Error("invalid capability valid interval");
  }
  const tx = instant("capability transaction-time", candidate.transactionTime?.from);
  if (candidate.transactionTime.to !== undefined
    && instant("capability transaction end", candidate.transactionTime.to) <= tx) {
    throw new Error("invalid capability transaction interval");
  }
  if (candidate.revokedAt !== undefined) {
    throw new Error("publication cannot self-declare capability revocation");
  }
  if (candidate.details === null || typeof candidate.details !== "object"
    || Array.isArray(candidate.details)) {
    throw new Error("capability needs structured nonempty details");
  }
  secure(candidate.details);
}

function validateOperation(op: EpisodeCapabilityOperation): void {
  if (!op || (op.kind !== "episode.capability.published"
    && op.kind !== "episode.capability.revoked")) {
    throw new Error("unsupported canonical episode capability operation");
  }
  requireId("operation", op.id, "episode-capability-operation:");
  requireId("workspace", op.workspaceId, "workspace:");
  requireId("actor", op.actorPrincipalId, "principal:");
  const timestamp = instant("operation timestamp", op.transactionTime?.from);
  const keys = ["id", "kind", "workspaceId", "ledgerSequence", "transactionTime", "actorPrincipalId"];
  if (op.kind === "episode.capability.published") {
    keys.push("candidate", "authorityReference", "rationale");
    validateCandidate(op.candidate);
    requireId("authority reference", op.authorityReference, "decision:");
    rationale("publication rationale", op.rationale);
    if (op.workspaceId !== op.candidate.workspaceId
      || op.id !== "episode-capability-operation:published:" + op.candidate.id
      || timestamp !== instant("candidate recorded", op.candidate.transactionTime.from)) {
      throw new Error("published capability identity/scope/time mismatch");
    }
  } else {
    keys.push("capabilityId", "reason");
    requireId("capability", op.capabilityId, "episode-capability:");
    rationale("capability revocation reason", op.reason);
    if (op.id !== "episode-capability-operation:revoked:" + op.capabilityId) {
      throw new Error("invalid capability revocation identity");
    }
  }
  if (Object.keys(op).some(k => !keys.includes(k))) {
    throw new Error("unexpected canonical capability fields");
  }
}

function replay(history: readonly EpisodeCapabilityOperation[]): {
  readonly published: Map<string, CapabilityPublished>;
  readonly revoked: Map<string, CapabilityRevoked>;
} {
  const published = new Map<string, CapabilityPublished>();
  const revoked = new Map<string, CapabilityRevoked>();
  const seen = new Set<string>();
  let sequence = 0;
  for (const event of history) {
    validateOperation(event);
    if (event.ledgerSequence !== ++sequence || seen.has(event.id)) {
      throw new Error("invalid episode capability causal sequence or duplicate operation");
    }
    seen.add(event.id);
    if (event.kind === "episode.capability.published") {
      if (published.has(event.candidate.id)) throw new Error("episode capability already published");
      published.set(event.candidate.id, event);
    } else {
      const source = published.get(event.capabilityId);
      if (!source || revoked.has(event.capabilityId)
        || source.workspaceId !== event.workspaceId
        || instant("revocation", event.transactionTime.from)
          < instant("publication", source.transactionTime.from)) {
        throw new Error("unknown, duplicate or backdated episode capability revocation");
      }
      revoked.set(event.capabilityId, event);
    }
  }
  return { published, revoked };
}

/**
 * A privileged server-side source of bounded episode capabilities.
 * Authority to publish and revoke comes from independently trusted IAM,
 * never from the agent or an authorityReference alone.
 */
export class PostgresEpisodeCapabilityJournal {
  readonly #ledger: PostgresCanonicalLedger<EpisodeCapabilityOperation>;
  readonly #authorize: TrustedEpisodeCapabilityPolicy;

  private constructor(ledger: PostgresCanonicalLedger<EpisodeCapabilityOperation>,
    authorize: TrustedEpisodeCapabilityPolicy) {
    this.#ledger = ledger;
    this.#authorize = authorize;
  }

  static open(input: {
    readonly pool: PostgresPool;
    readonly namespace?: string;
    readonly authorize: TrustedEpisodeCapabilityPolicy;
  }): PostgresEpisodeCapabilityJournal {
    if (typeof input.authorize !== "function") {
      throw new TypeError("trusted capability authorization policy required");
    }
    return new PostgresEpisodeCapabilityJournal(
      PostgresCanonicalLedger.open({
        pool: input.pool, namespace: input.namespace ?? "episode-capabilities",
      }), input.authorize,
    );
  }

  /** Operator diagnostic, not a public API. */
  async history(input: { readonly workspaceId: string }): Promise<readonly EpisodeCapabilityOperation[]> {
    requireId("workspace", input.workspaceId, "workspace:");
    const history = await this.#ledger.load({ workspaceId: input.workspaceId });
    replay(history);
    return history;
  }

  async #allow(request: EpisodeCapabilityAuthorityRequest): Promise<void> {
    requireId("actor", request.actorPrincipalId, "principal:");
    requireId("workspace", request.workspaceId, "workspace:");
    requireId("work instance", request.workInstanceId, "work-instance:");
    requireId("work episode", request.workEpisodeId, "work-episode:");
    if (await this.#authorize(request) !== true) {
      throw new Error("episode capability " + request.operation.toLowerCase() + " denied by trusted policy");
    }
  }

  async publish(input: {
    readonly actorPrincipalId: string;
    readonly candidate: EpisodeCapabilityCandidate;
    readonly authorityReference: string;
    readonly recordedAt: string;
    readonly rationale: string;
  }): Promise<void> {
    validateCandidate(input.candidate);
    requireId("authority reference", input.authorityReference, "decision:");
    rationale("publication rationale", input.rationale);
    const at = instant("published time", input.recordedAt);
    if (at !== instant("capability transaction time", input.candidate.transactionTime.from)) {
      throw new Error("capability publication timestamp mismatch");
    }
    const c = input.candidate;
    await this.#allow({
      operation: "PUBLISH", actorPrincipalId: input.actorPrincipalId,
      workspaceId: c.workspaceId, workInstanceId: c.workInstanceId, workEpisodeId: c.workEpisodeId,
    });
    // Gateway validation protects its consumer's scope, syntax and secret
    // filtering independently. This journal does not infer a grant or policy.
    const record: CapabilityPublished = {
      id: "episode-capability-operation:published:" + c.id,
      kind: "episode.capability.published",
      workspaceId: c.workspaceId,
      transactionTime: { from: new Date(at).toISOString() },
      actorPrincipalId: input.actorPrincipalId,
      candidate: structuredClone(c),
      authorityReference: input.authorityReference,
      rationale: input.rationale.trim(),
    };
    await this.#ledger.appendValidated({
      workspaceId: c.workspaceId,
      decide: history => {
        if (replay(history).published.has(c.id)) throw new Error("episode capability already published");
        return { record, result: undefined };
      },
    });
  }

  async revoke(input: {
    readonly actorPrincipalId: string;
    readonly workspaceId: string;
    readonly capabilityId: string;
    readonly recordedAt: string;
    readonly reason: string;
  }): Promise<void> {
    requireId("workspace", input.workspaceId, "workspace:");
    requireId("capability", input.capabilityId, "episode-capability:");
    rationale("revocation reason", input.reason);
    const at = instant("revocation time", input.recordedAt);
    const prior = replay(await this.history({ workspaceId: input.workspaceId }));
    const publication = prior.published.get(input.capabilityId);
    if (!publication) throw new Error("unknown episode capability");
    const c = publication.candidate;
    await this.#allow({
      operation: "REVOKE", actorPrincipalId: input.actorPrincipalId,
      workspaceId: input.workspaceId, workInstanceId: c.workInstanceId, workEpisodeId: c.workEpisodeId,
    });
    const record: CapabilityRevoked = {
      id: "episode-capability-operation:revoked:" + c.id,
      kind: "episode.capability.revoked", workspaceId: input.workspaceId,
      transactionTime: { from: new Date(at).toISOString() },
      actorPrincipalId: input.actorPrincipalId, capabilityId: c.id,
      reason: input.reason.trim(),
    };
    await this.#ledger.appendValidated({
      workspaceId: input.workspaceId,
      decide: history => {
        const state = replay(history);
        if (!state.published.has(c.id)) throw new Error("unknown episode capability");
        if (state.revoked.has(c.id)) throw new Error("episode capability already revoked");
        if (at < instant("published at", state.published.get(c.id)?.transactionTime.from)) {
          throw new Error("cannot backdate capability revocation");
        }
        return { record, result: undefined };
      },
    });
  }

  async query(input: {
    readonly actorPrincipalId: string;
    readonly request: EpisodeContextRequest;
  }): Promise<readonly EpisodeCapabilityCandidate[]> {
    const r = input.request;
    if (input.actorPrincipalId !== r.principalId) throw new Error("capability reader principal mismatch");
    const tx = instant("capability read transaction time", r.transactionAt);
    instant("capability read valid time", r.validAt);
    await this.#allow({
      operation: "READ", actorPrincipalId: input.actorPrincipalId,
      workspaceId: r.workspaceId, workInstanceId: r.workInstanceId, workEpisodeId: r.workEpisodeId,
    });
    const current = replay(await this.history({ workspaceId: r.workspaceId }));
    return [...current.published.values()]
      .filter(op => op.candidate.workInstanceId === r.workInstanceId
        && op.candidate.workEpisodeId === r.workEpisodeId
        && instant("capability publication time", op.transactionTime.from) <= tx)
      .map(op => {
        const revoked = current.revoked.get(op.candidate.id);
        const revokedAt = revoked?.transactionTime.from;
        return {
          ...structuredClone(op.candidate),
          ...(revokedAt !== undefined && instant("capability revocation", revokedAt) <= tx
            ? { revokedAt } : {}),
        };
      });
  }
}
