# Woyengi Overlay for the Universal Coding Agent System

This overlay specializes `.agents/universal/CONTRACT.md` for Woyengi. It does not replace `CONSTITUTION.md`, `docs/architecture.md`, `prd.json`, or `agent.md`.

## Reconstruct before acting

Woyengi state is reconstructed from durable canonical records. For coding tasks, reconstruct the governing product/architecture/ticket state before editing. Conversation context is a convenience, not canonical project state.

## Constitutional invariants

Never weaken these for convenience or minimality:
- state is reconstructed rather than equated with a mutable projection;
- history is append-oriented and inspectable;
- valid time and transaction time remain distinct;
- authority is distinct from confidence;
- conflicts remain visible rather than silently erased;
- indexes/materialized projections are disposable and rebuildable;
- agent writes are proposals subject to authority/verification;
- the kernel remains domain-neutral and domain concepts belong in packages/apps above it.

## Effects and replay

Deterministic computational replay does not authorize replay of consequential external effects. Preserve effect identity, authorization, reconciliation, and evidence boundaries. A Git commit is not a Woyengi SemanticCommit.

## Verification and completion

Use the repository verification ladder and the existing `agent.md` pass policy. `passes` remains false until the required automated checks and human acceptance are complete. Missing evidence is not a PASS.

## Minimality in Woyengi

Use the universal Ponytail ladder aggressively for implementation shape—reuse canonical primitives, ports, state models, native runtime capabilities, and installed dependencies before adding new layers. But a smaller implementation is invalid if it bypasses provenance, replay, bitemporality, authority, conflict visibility, capability/permission checks, verification, effect reconciliation, or the stable public/private contract.

Prefer deletion of duplicate/noncanonical mechanisms over adding a second representation. If a simplification has a real operational ceiling, mark it with `ponytail: <ceiling>, <upgrade trigger/path>` and preserve that marker in handoff/evidence until resolved.
