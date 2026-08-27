# Woyengi Overlay

This overlay specializes the Universal Coding Agent Contract for Woyengi.

## Constitutional invariants

- State is reconstructed from typed history under explicit temporal, provenance, evidence, authority, lifecycle, identity, and permission constraints.
- Canonical history is append-oriented; corrections are new records.
- Valid time and transaction time remain distinct.
- Confidence never substitutes for authority.
- Conflicts remain inspectable.
- Search/vector/graph indexes and mutable projections are disposable materializations.
- Agent writes are proposals subject to validation, authority, lifecycle, permission, verification, and commit.
- Domain-specific concepts remain in versioned Domain Packages rather than the kernel.
- Runtime/computational effects, semantic state changes, and consequential external effects remain distinct.

## Delivery

The existing `agent.md` ticket loop remains mandatory for approved Woyengi delivery work: highest-priority unblocked ticket, failing public-behavior test, smallest implementation, refactor while green, full verification, progress evidence, and human acceptance before marking the ticket passed.

## Release

Passing code/tests does not imply semantic acceptance or release readiness. Preserve the repository's fail-closed production and human-QA gates.
