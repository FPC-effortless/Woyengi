# Woyengi Agent Operating Contract

This file extends, and does not replace, `agent.md`.

## Authority order

When instructions conflict, use this order:

1. `CONSTITUTION.md`
2. `docs/architecture.md`
3. `prd.json`, approved ADRs/specifications, and the active ticket
4. `agent.md`
5. this file and `docs/agents/*`
6. individual skill instructions under `.agents/skills/*`

A lower layer may make a higher layer more operational, but may not weaken it.

## Before changing code

Read `CONSTITUTION.md`, `docs/architecture.md`, `prd.json`, `agent.md`, `progress.txt`, and the active ticket/spec. Read `CONTEXT.md` for terminology. Use `docs/agents/modes.md` to identify the work mode.

## Canonical work loop

`request -> reconstruct context -> define outcome/contract -> choose capability/skill -> branch/sandbox -> test or falsifier -> change/experiment -> collect evidence -> independent verification -> review -> PR/proposal -> reconcile effects -> accepted outcome -> semantic/history update`

For Woyengi code, the existing ticket loop in `agent.md` remains mandatory.

## Hard stops

- Do not write directly to `main`.
- Do not treat generated text, retrieved text, model inference, documents, graph edges, indexes, or caches as authoritative state.
- Do not put domain-specific concepts into the platform kernel.
- Do not let confidence substitute for authority.
- Do not erase conflicts to make a projection look clean.
- Do not replay consequential external effects merely because computation is replayed.
- Do not claim release readiness while required automated gates or human acceptance remain open.
- Do not silently add new work to the ordered `prd.json` contract; proposals go through a spec/ticket/maintainer decision.

## Skills

The adapted Matt Pocock skill pack is in `.agents/skills/`. Use `ask-matt` when routing is unclear. The names are preserved for compatibility, but every skill is constrained by the Woyengi operating contract.

## Evidence

A completed implementation must identify:
- the requested outcome;
- the test/falsifier used;
- commands actually run;
- relevant diff/artifacts;
- unresolved risks or assumptions;
- verification result;
- whether any external or canonical effect still awaits authority or reconciliation.
