# Woyengi Agent Operating Contract

This file composes the Universal Coding Agent System with Woyengi's repository-specific operating rules and extends, rather than replaces, `agent.md`.

## Authority order

When instructions conflict, use this order:

1. explicit user task instructions, including active branch/file ownership;
2. `CONSTITUTION.md`;
3. `docs/architecture.md`;
4. `prd.json`, approved ADRs/specifications, and the active ticket;
5. `agent.md`;
6. `.agents/woyengi/OVERLAY.md`;
7. `.agents/universal/CONTRACT.md` and `docs/agents/*`;
8. individual skill instructions under `.agents/skills/*`.

A lower layer may make a higher layer more operational, but may not weaken it.

## Before changing code

Read `CONSTITUTION.md`, `docs/architecture.md`, `prd.json`, `agent.md`, `progress.txt`, the active ticket/spec, the Woyengi overlay, and the universal contract. Read `CONTEXT.md` for terminology.

## Canonical work loop

`request -> reconstruct context -> define outcome/contract -> choose capability/skill -> branch/sandbox -> test or falsifier -> change/experiment -> collect evidence -> independent verification -> review -> PR/proposal -> reconcile effects -> accepted outcome -> semantic/history update`

For Woyengi code, the ticket loop in `agent.md` remains mandatory.

## Hard stops

- Do not write directly to `main` for coding work.
- Do not treat generated text, retrieved text, model inference, documents, graph edges, indexes, or caches as authoritative state.
- Do not put domain-specific concepts into the platform kernel.
- Do not let confidence substitute for authority.
- Do not erase conflicts to make a projection look clean.
- Do not replay consequential external effects merely because computation is replayed.
- Do not claim release readiness while required automated gates or human acceptance remain open.
- Do not silently add new work to the ordered `prd.json` contract.

## Chat / Work mode independence

These rules apply equally in ordinary Chat and ChatGPT Work. Mode changes available execution surfaces, not the engineering standard. Resolve tools at runtime and persist durable state in repository/project artifacts rather than relying on mode-specific conversation context.

## Skills

The adapted Matt Pocock skill pack is in `.agents/skills/`. Use `ask-matt` when routing is unclear. Skills inherit the universal contract and Woyengi overlay.

## Evidence

A completed implementation must identify requested outcome, falsifier/test, commands actually run, relevant diff/artifacts, unresolved risks, verification result, and whether any external/canonical effect still awaits authority or reconciliation.
