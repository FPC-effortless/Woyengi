import type { PostgresWorkspaceJournal } from "../postgres-storage/index.ts";
import type { PostgresWorkJournal } from "../postgres-storage/index.ts";
import type { EpisodeCapabilityAuthorityRequest, TrustedEpisodeCapabilityPolicy } from "./capabilities.ts";
import type { EpisodeKnowledgeAuthorityRequest, TrustedEpisodeKnowledgePolicy } from "./index.ts";

type EpisodeOperation = "READ" | "PROPOSE" | "PUBLISH" | "REVOKE";
interface Scope {
  readonly actorPrincipalId: string;
  readonly workspaceId: string;
  readonly workInstanceId: string;
  readonly workEpisodeId: string;
  readonly operation: EpisodeOperation;
}

export interface EpisodeAgentDelegationRequest {
  readonly agentPrincipalId: string;
  readonly workspaceId: string;
  readonly workInstanceId: string;
  readonly workEpisodeId: string;
  readonly operation: "READ" | "PROPOSE";
}

export interface EpisodeAgentDelegationDecision {
  /** Registered human Work owner/decision authority responsible for this agent. */
  readonly sponsorPrincipalId: string;
}

/**
 * Independent *current* delegated-rights source. Implementations MUST
 * authenticate the agent and verify durable delegated-rights issuance,
 * expiry, scope, operations, and revocation; never interpret a model
 * prediction, the principal's requested sponsor, or a stored context
 * candidate as delegated authority.
 */
export type TrustedEpisodeAgentDelegation = (
  request: EpisodeAgentDelegationRequest,
) => Promise<EpisodeAgentDelegationDecision | undefined>;

export interface WorkBoundEpisodePolicies {
  readonly knowledge: TrustedEpisodeKnowledgePolicy;
  readonly capability: TrustedEpisodeCapabilityPolicy;
}

/**
 * Bind the two SQL episode-context journals to real replayed Work/Workspace
 * history. There is intentionally no local authorization cache. Every
 * operation rechecks current Work ownership, original episode and agent
 * delegation, including after another process revokes an external grant.
 *
 * The trusted API layer must bind actorPrincipalId to authenticated identity.
 * This policy is NOT a bearer-token authenticator or grant issuer.
 */
export function createWorkBoundEpisodePolicies(input: {
  readonly workspaces: PostgresWorkspaceJournal;
  readonly work: PostgresWorkJournal;
  readonly authorizeAgentDelegation?: TrustedEpisodeAgentDelegation;
}): WorkBoundEpisodePolicies {
  async function permitted(request: Scope): Promise<boolean> {
    const { actorPrincipalId, workspaceId, workInstanceId, workEpisodeId, operation } = request;
    if (!actorPrincipalId.startsWith("principal:")
      || !workspaceId.startsWith("workspace:")
      || !workInstanceId.startsWith("work-instance:")
      || !workEpisodeId.startsWith("work-episode:")) return false;

    try {
      const workspace = await input.workspaces.snapshot();
      const registration = workspace.history().find(op =>
        op.kind === "principal.registered" && op.principal.id === actorPrincipalId);
      if (registration?.kind !== "principal.registered") return false;

      const isAgent = registration.principal.kind === "agent";
      const isHuman = registration.principal.kind === "human";
      if (!isAgent && !isHuman) return false;

      let memberId = actorPrincipalId;
      if (isAgent) {
        // Agents cannot publish authoritative capabilities or silently
        // upgrade their own knowledge even if they have read/propose grants.
        if (operation !== "READ" && operation !== "PROPOSE") return false;
        if (!input.authorizeAgentDelegation) return false;
        const decision = await input.authorizeAgentDelegation({
          agentPrincipalId: actorPrincipalId,
          workspaceId, workInstanceId, workEpisodeId, operation,
        });
        if (!decision || !decision.sponsorPrincipalId.startsWith("principal:")) return false;
        memberId = decision.sponsorPrincipalId;
        const sponsor = workspace.history().find(op =>
          op.kind === "principal.registered" && op.principal.id === memberId);
        if (sponsor?.kind !== "principal.registered"
          || sponsor.principal.kind !== "human") return false;
      }

      // The Work journal checks the sponsor's *current* Workspace membership
      // and explicit participation. The named WorkEpisode must exist in this
      // exact WorkInstance and still be active, not merely supplied by caller.
      const instance = await input.work.workInstance({
        principalId: memberId, workspaceId, id: workInstanceId,
      });
      if (instance.status !== "active") return false;
      const role = instance.roles.workOwners.includes(memberId as typeof instance.roles.workOwners[number])
        || instance.roles.decisionAuthorities.includes(memberId as typeof instance.roles.decisionAuthorities[number]);
      if (isAgent && !role) return false;
      if ((operation === "PUBLISH" || operation === "REVOKE") && !role) return false;

      const events = await input.work.history({ principalId: memberId, workspaceId });
      return events.some(event => event.kind === "work-episode.started"
        && event.workInstanceId === workInstanceId
        && event.episode.id === workEpisodeId
        && event.episode.status === "active"
        && event.episode.startedAt !== undefined);
    } catch {
      // DB failures, missing Work history, invalid role and malformed
      // external delegation must never silently grant access.
      return false;
    }
  }
  return {
    knowledge: (r: EpisodeKnowledgeAuthorityRequest) => permitted(r),
    capability: (r: EpisodeCapabilityAuthorityRequest) => permitted(r),
  };
}
