# ADR 0003: Governed execution and effect classes

Status: Accepted for implementation

## Decision

Every consequential WorkEpisode is traceable through intent, reconstructed context, requirements, candidate and applicability decisions, authority/policy/budget evaluation, runtime composition, an immutable ExecutionManifest, an append-oriented ExecutionJournal, observed effects, reconciliation, evidence, verification, acceptance, and a verified Semantic Commit.

The following effect classes are disjoint:

- `RUNTIME`: temporary registrations, subscriptions, timers, mounts, child components, and interceptors. These may have automatic disposers.
- `SEMANTIC`: proposed Woyengi state changes. These require authority, evidence, verification, and a canonical commit.
- `EXTERNAL`: real-world or external-system consequences. These require idempotency, observation, and reconciliation; correction is a compensating action or repair, not a disposer.

Provider success and HTTP success are execution observations, not truth. Acceptance is blocked when required evidence, reconciliation, or verification is missing. Restoring a provider may rebuild runtime composition but may not replay a semantic or external effect automatically.
