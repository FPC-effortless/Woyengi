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
