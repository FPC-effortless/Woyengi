# Woyengi Context Glossary

This file defines vocabulary, not implementation details. Architecture decisions belong in architecture docs or ADRs.

- **Persistent reconstructable state** — task-specific state projected from typed history under temporal, provenance, evidence, authority, lifecycle, identity, and permission constraints.
- **Canonical record** — append-oriented historical record from which disposable projections and indexes can be rebuilt.
- **Observation** — preserved account of what arrived from a source.
- **Claim** — proposition about the world; it may be supported, contradicted, provisional, superseded, or rejected.
- **Projected state** — context-dependent selection over candidate historical records; not a synonym for a claim.
- **Valid time** — when something held in the world.
- **Transaction time** — when Woyengi recorded or learned it.
- **Evidence** — material that supports or contradicts a proposition and retains a locator/provenance.
- **Verification** — explicit check with a method, verifier, time, result, and provenance.
- **Authority** — whether a principal/claim may govern a context. It is distinct from statistical confidence.
- **Conflict** — inspectable disagreement between candidates that must remain visible even when one candidate governs.
- **Reconstructive workspace** — structured, traced task context returned by reconstruction; rendered LLM context is only one consumer.
- **Domain Package** — versioned extension that contributes domain types, policies, reducers, verifiers, permissions, procedures, or connectors without polluting the kernel.
- **WorkInstance / WorkEpisode** — durable unit of work and a bounded execution episode within it.
- **Outcome Contract** — explicit success conditions, constraints, evidence, and verification requirements for work.
- **Execution evidence** — tests, traces, diffs, measurements, artifacts, or observations produced by an execution.
- **Semantic commit** — accepted operational meaning/state transition after reconciliation and verification, not merely a Git commit.
- **External effect** — consequential action outside the runtime whose replay/reconciliation semantics must be explicit.
