---
name: grill-with-docs
description: Resolve a design by combining decision grilling with domain-model sharpening and durable documentation.
---

# grill-with-docs

Use `grilling` for the decision frontier and `domain-modeling` for terminology.

The agent should research factual questions rather than asking the user to supply facts that can be obtained from code, docs, primary sources, or experiments. Ask the user only for genuine choices, priorities, risk tolerances, or proprietary knowledge.

During each round:
- surface the highest-leverage unresolved decision;
- present the strongest recommendation plus a real countercase;
- identify any collision with `CONSTITUTION.md`, `docs/architecture.md`, or the selected work mode;
- persist stable terminology in `CONTEXT.md`;
- persist consequential architecture decisions in an ADR/spec, not in the glossary.

Stop when the remaining uncertainty is implementation-level. Then route to `to-spec`.
