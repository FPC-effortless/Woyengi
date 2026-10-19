import {
  ContextGateway, type ContextSegmentRecord, type EpisodeContextRequest,
} from "../../packages/context-gateway/src/index.ts";
import type { PrincipalId } from "../../packages/workspace/src/index.ts";
import { PostgresCanonicalLedger, type PostgresPool } from "../postgres-storage/index.ts";
import {
  replay, type EpisodeKnowledgeOperation, type KnowledgePublished, type KnowledgeRevoked,
} from "./model.ts";
import { instant, rationale, requireId } from "./validate.ts";

export type { EpisodeKnowledgeOperation, KnowledgePublished, KnowledgeRevoked } from "./model.ts";
export { createEpisodeKnowledgeGateway } from "./gateway.ts";
export { PostgresEpisodeCapabilityJournal } from "./capabilities.ts";
export { createWorkBoundEpisodePolicies } from "./work-authority.ts";
export type { EpisodeAgentDelegationDecision, EpisodeAgentDelegationRequest, TrustedEpisodeAgentDelegation, WorkBoundEpisodePolicies } from "./work-authority.ts";
export type { EpisodeCapabilityOperation, TrustedEpisodeCapabilityPolicy, EpisodeCapabilityAuthorityRequest, CapabilityPublished, CapabilityRevoked } from "./capabilities.ts";

export interface EpisodeKnowledgeAuthorityRequest {
  readonly operation: "READ" | "PROPOSE" | "PUBLISH" | "REVOKE";
  readonly actorPrincipalId: string;
  readonly workspaceId: string;
  readonly workInstanceId: string;
  readonly workEpisodeId: string;
}
export type TrustedEpisodeKnowledgePolicy = (
  request: EpisodeKnowledgeAuthorityRequest,
) => Promise<boolean>;

async function normalizeForStorage(
  segment: ContextSegmentRecord, actorPrincipalId: string,
): Promise<ContextSegmentRecord> {
  if (segment.revokedAt !== undefined) {
    throw new Error("new knowledge publication cannot self-declare revocation");
  }
  const request: EpisodeContextRequest = {
    principalId: actorPrincipalId as PrincipalId,
    workspaceId: segment.workspaceId, workInstanceId: segment.workInstanceId,
    workEpisodeId: segment.workEpisodeId, purpose: "canonical episode knowledge validation",
    validAt: segment.validTime.from, transactionAt: segment.transactionTime.from,
  };
  // Reuse constitutional ContextGateway validation: scope, time, secret/grant
  // scanning and immutable normalized source/provenance. The actual trusted
  // permission check is performed separately by the journal's policy.
  const gateway = new ContextGateway({
    capabilitySource: { query: async () => [] },
    knowledgeSource: { query: async () => [], append: async () => {} },
    evaluateWrite: () => ({ allowed: true, rationale: "canonical validation only" }),
  });
  const { authorityFilter: _ignored, ...normalized } = await gateway.writeContextSegment({
    request, segment,
  });
  return normalized;
}

/** Trusted server-side adapter; never expose raw journal methods to agents. */
export class PostgresEpisodeKnowledgeJournal {
  readonly #ledger: PostgresCanonicalLedger<EpisodeKnowledgeOperation>;
  readonly #authorize: TrustedEpisodeKnowledgePolicy;
  private constructor(
    ledger: PostgresCanonicalLedger<EpisodeKnowledgeOperation>,
    authorize: TrustedEpisodeKnowledgePolicy,
  ) {
    this.#ledger = ledger;
    this.#authorize = authorize;
  }

  static open(input: {
    readonly pool: PostgresPool;
    readonly namespace?: string;
    readonly authorize: TrustedEpisodeKnowledgePolicy;
  }): PostgresEpisodeKnowledgeJournal {
    if (typeof input.authorize !== "function") {
      throw new TypeError("trusted episode knowledge authorization policy required");
    }
    return new PostgresEpisodeKnowledgeJournal(
      PostgresCanonicalLedger.open({
        pool: input.pool, namespace: input.namespace ?? "episode-knowledge",
      }), input.authorize,
    );
  }

  /** Privileged diagnostic history; no unscoped HTTP route may expose it. */
  async history(input: { readonly workspaceId: string }): Promise<readonly EpisodeKnowledgeOperation[]> {
    requireId("workspace", input.workspaceId, "workspace:");
    const history = await this.#ledger.load({ workspaceId: input.workspaceId });
    replay(history);
    return history;
  }

  async #allow(input: EpisodeKnowledgeAuthorityRequest): Promise<void> {
    requireId("actor", input.actorPrincipalId, "principal:");
    requireId("workspace", input.workspaceId, "workspace:");
    requireId("work instance", input.workInstanceId, "work-instance:");
    requireId("work episode", input.workEpisodeId, "work-episode:");
    if (await this.#authorize(input) !== true) {
      throw new Error(`episode context ${input.operation.toLowerCase()} denied by trusted policy`);
    }
  }

  async #publish(input: {
    readonly actorPrincipalId: string;
    readonly segment: ContextSegmentRecord;
    readonly rationale: string;
    readonly origin: "agent-proposal" | "trusted-source";
    readonly operation: "PROPOSE" | "PUBLISH";
  }): Promise<void> {
    rationale("knowledge publication rationale", input.rationale);
    const s = await normalizeForStorage(input.segment, input.actorPrincipalId);
    if (input.origin === "agent-proposal"
      && (s.source.kind !== "agent-proposal" || s.trustClass !== "inferred")) {
      throw new Error("agent proposals must be inferred and marked agent-proposal");
    }
    if (input.origin === "trusted-source" && s.source.kind === "agent-proposal") {
      throw new Error("trusted publication cannot launder an agent proposal");
    }
    await this.#allow({
      operation: input.operation, actorPrincipalId: input.actorPrincipalId,
      workspaceId: s.workspaceId, workInstanceId: s.workInstanceId,
      workEpisodeId: s.workEpisodeId,
    });
    const record: KnowledgePublished = {
      id: "episode-knowledge:published:" + s.id,
      kind: "episode.context.segment.published",
      workspaceId: s.workspaceId, transactionTime: { from: s.transactionTime.from },
      actorPrincipalId: input.actorPrincipalId, segment: structuredClone(s),
      origin: input.origin, rationale: input.rationale.trim(),
    };
    await this.#ledger.appendValidated({
      workspaceId: s.workspaceId,
      decide: history => {
        if (replay(history).published.has(s.id)) throw new Error("knowledge segment already published");
        return { record, result: undefined };
      },
    });
  }

  async propose(input: {
    readonly actorPrincipalId: string;
    readonly segment: ContextSegmentRecord;
    readonly rationale: string;
  }): Promise<void> {
    return this.#publish({ ...input, origin: "agent-proposal", operation: "PROPOSE" });
  }

  async publishTrusted(input: {
    readonly actorPrincipalId: string;
    readonly segment: ContextSegmentRecord;
    readonly rationale: string;
    readonly recordedAt: string;
  }): Promise<void> {
    if (instant("trusted publication time", input.recordedAt)
      !== instant("segment transaction time", input.segment.transactionTime?.from)) {
      throw new Error("trusted publication must preserve segment transaction time");
    }
    return this.#publish({ ...input, origin: "trusted-source", operation: "PUBLISH" });
  }

  async revoke(input: {
    readonly actorPrincipalId: string;
    readonly workspaceId: string;
    readonly segmentId: string;
    readonly recordedAt: string;
    readonly reason: string;
  }): Promise<void> {
    requireId("workspace", input.workspaceId, "workspace:");
    requireId("segment", input.segmentId, "context-segment:");
    rationale("revocation reason", input.reason);
    const at = instant("revocation time", input.recordedAt);
    const prior = replay(await this.history({ workspaceId: input.workspaceId }));
    const published = prior.published.get(input.segmentId);
    if (!published) throw new Error("unknown episode knowledge segment");
    const segment = published.segment;
    await this.#allow({
      operation: "REVOKE", actorPrincipalId: input.actorPrincipalId,
      workspaceId: input.workspaceId, workInstanceId: segment.workInstanceId,
      workEpisodeId: segment.workEpisodeId,
    });
    const record: KnowledgeRevoked = {
      id: "episode-knowledge:revoked:" + input.segmentId,
      kind: "episode.context.segment.revoked",
      workspaceId: input.workspaceId,
      transactionTime: { from: new Date(at).toISOString() },
      actorPrincipalId: input.actorPrincipalId, segmentId: input.segmentId,
      reason: input.reason.trim(),
    };
    await this.#ledger.appendValidated({
      workspaceId: input.workspaceId,
      decide: history => {
        const state = replay(history);
        if (!state.published.has(input.segmentId)) throw new Error("unknown episode knowledge segment");
        if (state.revoked.has(input.segmentId)) throw new Error("episode knowledge already revoked");
        if (at < instant("published at", state.published.get(input.segmentId)?.transactionTime.from)) {
          throw new Error("cannot backdate episode knowledge revocation");
        }
        return { record, result: undefined };
      },
    });
  }

  async query(input: {
    readonly actorPrincipalId: string;
    readonly request: EpisodeContextRequest;
  }): Promise<readonly ContextSegmentRecord[]> {
    const request = input.request;
    if (request.principalId !== input.actorPrincipalId) {
      throw new Error("episode context reader principal mismatch");
    }
    instant("knowledge validAt", request.validAt);
    const at = instant("knowledge transactionAt", request.transactionAt);
    await this.#allow({
      operation: "READ", actorPrincipalId: input.actorPrincipalId,
      workspaceId: request.workspaceId, workInstanceId: request.workInstanceId,
      workEpisodeId: request.workEpisodeId,
    });
    const state = replay(await this.history({ workspaceId: request.workspaceId }));
    return [...state.published.values()].filter(record =>
      record.segment.workInstanceId === request.workInstanceId
      && record.segment.workEpisodeId === request.workEpisodeId
      && instant("published at", record.transactionTime.from) <= at)
      .map(record => {
        const revoked = state.revoked.get(record.segment.id);
        const revokedAt = revoked?.transactionTime.from;
        return {
          ...structuredClone(record.segment),
          ...(revokedAt !== undefined && instant("revoked at", revokedAt) <= at
            ? { revokedAt } : {}),
        };
      });
  }
}
