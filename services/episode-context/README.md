# Durable episode knowledge (WYG-013 slice)

`PostgresEpisodeKnowledgeJournal` persists context segments as append-only
`episode.context.segment.published` and `episode.context.segment.revoked`
records in a workspace-scoped PostgreSQL canonical ledger. Each event receives
a causal sequence from PostgreSQL. Proposals are always `inferred` and
`agent-proposal`-sourced; only a separately authorized trusted server actor
may publish a non-agent source. A human/source authorization decision is **not**
a semantic acceptance or independent proof of a claim.

The required `authorize` callback is an operator-controlled IAM integration
port, checked on every read, proposal, trusted publication and revocation.
The policy must independently verify principal identity, Work membership,
delegation, purpose, operation and current revocation state. The journal does
not issue bearer credentials or permit agents to invent grants.

`createEpisodeKnowledgeGateway` binds an authenticated
`EpisodeContextRequest` to the constitutional `ContextGateway`, with
independently supplied per-segment read/write evaluators. It checks principal,
workspace, WorkInstance, WorkEpisode, purpose and both as-of times. The
underlying gateway rejects secret/grant content, filters invalid time windows,
and preserves source, trust class, provenance and an inspectable read rationale.
The new PostgreSQL adapter refuses agent self-promotion to verified knowledge.

As-of reconstruction includes only records published by the transaction
cutoff and marks revocations only when their canonical transaction time is
within that cutoff. Revocation appends a new record rather than overwriting
the original. PostgreSQL row locks serialize duplicate proposals and
revocations across independent pools; unsupported canonical kinds fail replay.

**Operational boundary:** These methods are for trusted state-server use,
not a public HTTP endpoint. `history` is an operator diagnostic and must
never be exposed unscoped. `authorize` and per-record evaluators must be
wired to a real independent policy service; the tests use deterministic
callbacks. Cross-journal policy revocation and append are not one SQL
transaction, and this adapter does not provide capability persistence,
provider integration, a user-facing review surface, or real delegated agent
credential issuance. WYG-013 remains incomplete.

The live tests in `test/postgres-knowledge-live.test.ts` and
`test/postgres-gateway-live.test.ts` require PostgreSQL 16 and the isolated
`pg` test driver. A CI runner integration is still required before claiming
those tests passed in GitHub Actions.

## PostgreSQL-backed EpisodeCapabilityContext (WYG-013 increment)

`PostgresEpisodeCapabilityJournal` persists scoped episode capability
candidates as **append-only** `episode.capability.published` and
`episode.capability.revoked` operations in a canonical PostgreSQL journal.
Every operation is ordered by a scoped causal sequence. Publication is
operator-only and requires a separate trusted `authorize` callback for
`PUBLISH`; reads and revocations each require a fresh policy decision for
the actor's current Workspace, WorkInstance and WorkEpisode scope.
The authority reference is a provenance pointer, **not an authority grant**.
Agent proposals and agent-issued credentials cannot publish their own
provider, resource, budget, policy or authority capability.

```ts
const capabilities = PostgresEpisodeCapabilityJournal.open({
  pool,
  authorize: independentlyTrustedEpisodeCapabilityPolicy,
});
const gateway = createEpisodeKnowledgeGateway({
  journal: episodeKnowledgeJournal,
  capabilities,
  request: authenticatedEpisodeRequest,
  evaluateApplicability: (candidate, request) =>
    trustedEpisodeApplicabilityEvaluator(candidate, request),
});
const scoped = await gateway.buildEpisodeCapabilityContext({
  ...authenticatedEpisodeRequest, id: "episode-capability-context:one",
});
```

All five capability types share the same scoped storage/revocation protocol:
provider, resource, authority, budget and policy. The existing
constitutional ContextGateway evaluates applicability, checks both as-of
times, excludes revoked or cross-scope candidates, rejects raw secrets and
grant contents, and records the **include/exclude reason** for every
candidate. No capabilities are implicitly granted: absent a trusted
applicability evaluator the gateway excludes all candidates. A request for
a different actor, episode, purpose or time cannot reuse a bound gateway.
Historical context reads before a revocation show the earlier capability,
while later reads exclude it without rewriting historical records.

The capability journal disallows malformed time intervals, blank
operator rationale, source-asserted revocation, unsafe credential-like
contents, duplicate candidate publication and duplicate/backdated
revocation. Its history is operator-only. Two independent PostgreSQL
connections replay the same canonical state; concurrent writes are
validated under a workspace-scoped SQL row lock. Unknown privileged
operation kinds fail closed.

**Security / acceptance boundary:** `authorize` and the applicability
evaluator are trusted integration ports, not a real installed IAM system
or automatic AgentPrincipal delegation. Publication requires an
authenticated trusted operator and real governing policy checks upstream.
Neither a stored candidate nor a reconstructed context is permission to
call an external provider. The tests use deterministic policies, not an
actual credential issuer or production policy service. The typed grants,
episode membership and live provider authority still need end-to-end
integration. WYG-013 remains `passes=false`.

CI's PostgreSQL 16 job now directly runs all three live episode tests:
knowledge publication/revocation, bound ContextGateway as-of reads, and
trusted capability publishing plus scope/revocation/applicability. These
tests were missing from PR #49's earlier CI and must pass before claiming
verified functionality.

## Work-bound, sponsor-scoped AgentPrincipal context authority

`createWorkBoundEpisodePolicies({ workspaces, work,
authorizeAgentDelegation })` provides **real** PostgreSQL Workspace
membership, human Work role, and existing WorkEpisode checks to the
episode knowledge and capability journals. Both policy ports are returned
(`knowledge` and `capability`) and can be used in the respective journal
`authorize` constructor fields. The authenticated state server must bind
`actorPrincipalId` to the actual authenticated human or agent identity:
this is an authorization adapter, not a login/token verifier.

Every READ/PROPOSE/PUBLISH/REVOKE request replays the current principal
registry and Work instance. A human participant may read or propose.
Capability and trusted knowledge publication/revocation require a
currently participating Work owner or decision authority. Denied Workspace,
unregistered principal, wrong Work instance/episode, suspended instance,
or SQL/provider failure deny access rather than silently trusting the
provided episode string.

Agent principals are **not silently enrolled as Work participants**. The
optional `authorizeAgentDelegation` callback must independently verify
the agent's actual delegated rights, current revocation state, operation,
Work scope and human sponsor. Even a delegated agent is limited to READ
and PROPOSE; PUBLISH and REVOKE always deny. The returned sponsor must
be a registered human, currently a Workspace member and Work participant,
with Work-owner or decision-authority role. That sponsor's Work history
must contain the specified active episode. A missing callback denies all
agent context access. Its decision is rechecked on **every** context
operation, including after revocation by another service process.

```ts
const policies = createWorkBoundEpisodePolicies({
  workspaces: postgresWorkspaceJournal,
  work: postgresWorkJournal,
  authorizeAgentDelegation: async request =>
    independentlyTrustedDelegationStore.resolveActiveSponsor(request),
});
const knowledge = PostgresEpisodeKnowledgeJournal.open({
  pool, authorize: policies.knowledge,
});
const capabilities = PostgresEpisodeCapabilityJournal.open({
  pool, authorize: policies.capability,
});
```

The live SQL integration test creates a real organization, human Work
owner/reviewer, registered agent, and a started WorkEpisode across two
PostgreSQL pools. It proves owners can publish while reviewers and
agents cannot, verifies a scoped agent READ/PROPOSE when the independent
delegation source allows it, and denies both immediately after that
source revokes access. Agent elevation to a verified knowledge source
also fails.

**Remaining boundary:** `authorizeAgentDelegation` is a trusted current
authorization port, not itself a durable grant issuer. This slice does
not issue, revoke or encrypt credentials, persist delegation grant
events, enroll agents as first-class Work participants, execute provider
actions, or atomically coordinate Work membership and delegation events.
The test uses a controllable independent policy stub for the grant
source; live PostgreSQL validates Work authority and context journals.
Full multi-principal execution and WYG-013 remain unaccepted.

## Durable AgentPrincipal WorkEpisode delegation (WYG-013)

`PostgresEpisodeDelegationJournal` replaces the earlier test-controlled
authorization flag with a **PostgreSQL-backed immutable grant journal**.
Its `issue` method is trusted-operator-only, limited to a registered
human Work owner or decision authority sponsoring an existing registered
AgentPrincipal for one active Workspace, WorkInstance and WorkEpisode.
The human sponsor must be the issuer; an agent, non-owner reviewer or
unregistered target cannot mint a grant. The grant contains **only** READ
and/or PROPOSE rights, never provider execution, trusted publication,
approval, capability creation, or an external effect permission.

```ts
const grants = PostgresEpisodeDelegationJournal.open({
  pool, workspaces: postgresWorkspaceJournal, work: postgresWorkJournal,
});
await grants.issue({
  grantId: "agent-delegation:inspection", workspaceId: "workspace:one",
  workInstanceId: "work-instance:one", workEpisodeId: "work-episode:one",
  agentPrincipalId: "principal:agent", sponsorPrincipalId: "principal:owner",
  issuerPrincipalId: "principal:owner", operations: ["READ", "PROPOSE"],
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  authorityReference: "decision:approved-by-owner",
  rationale: "Bounded human-sponsored inspection",
});
const policies = createWorkBoundEpisodePolicies({
  workspaces: postgresWorkspaceJournal, work: postgresWorkJournal,
  authorizeAgentDelegation: request => grants.resolve(request),
});
```

Grants expire after at most **seven days**, and cannot be issued in the
future or already expired. Overlapping active grants for the same agent,
WorkEpisode, and operation are refused transactionally, so two sponsors
cannot silently race to grant ambiguous rights. An original human sponsor
may append an immutable revocation with rationale; duplicate, unknown,
backdated or unauthorized revocations are rejected. Prior issuance remains
auditable. Every `resolve` reloads the canonical PostgreSQL event history
and revalidates the human sponsor's current Work participation and governing
role. A committed revocation or expiry is visible to another DB-connected
API instance without restarting it. Unexpected privileged event kinds or
tampered history fail closed.

`history` and grant issuance/revocation are **trusted server operations**,
not agent-facing HTTP routes. Upstream must authenticate the issuing
human principal; ID strings alone are never proof of identity. The
existing Work-bound policies still independently check the actual active
episode and membership for every downstream READ or PROPOSE.

The real PostgreSQL integration test exercises two independent SQL pools,
an organization and live Work episode, human owner/reviewer and registered
agents, issuer and scope refusal, concurrent duplicate issuance, expiry,
revocation, read/propose scoping, reissuance after revocation, and
corruption refusal.

**Still not production completeness:** the grant journal is for
**episode context** only, not execute/provider action delegation. Its
revocation and downstream context write are on separate SQL namespaces:
an authorization decision immediately preceding a concurrent revocation
cannot be made atomic with that context write by this mechanism alone.
External caller authentication, token-bound identities, atomic
cross-ledger revocation fencing, active worker termination, provider
gatekeeping and complete human acceptance remain open. WYG-013
`passes=false`.
