---
name: improve-codebase-architecture
description: Find high-leverage architectural improvements using deep-module and Woyengi-invariant analysis.
---

# improve-codebase-architecture

Inspect recent hotspots and dependency structure before proposing broad refactors. Use `codebase-design` vocabulary.

Prioritize:
- duplicated or noncanonical constructors;
- invariant logic leaking across packages;
- overly permissive composition roots;
- weak seams around state projection, replay, authority, verification, storage, models, or external effects;
- modules with large interfaces and little hidden complexity;
- tests that require internal knowledge rather than stable public seams.

Score proposals by leverage, semantic risk, migration cost, testability gain, and whether they preserve replay/history. Material refactors should become a spec/ticket sequence, normally with a preparatory seam/refactor slice before behavior changes.
