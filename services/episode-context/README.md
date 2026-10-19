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
