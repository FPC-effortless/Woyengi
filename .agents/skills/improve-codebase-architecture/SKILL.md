---
name: improve-codebase-architecture
description: Find high-leverage architectural improvements and removable complexity using deep-module and Woyengi-invariant analysis.
---
# improve-codebase-architecture

Inspect recent hotspots and dependency structure before broad refactors. Use `codebase-design` vocabulary.

Prioritize existing Woyengi risks: duplicated/noncanonical constructors; invariant logic leaking across packages; permissive composition roots; weak seams around state projection, replay, authority, verification, storage, models, or external effects; modules with large interfaces/little hidden complexity; tests requiring internal knowledge.

Add the repo-wide Ponytail hunt: dependencies duplicating stdlib/native capabilities, single-implementation interfaces, one-product factories, delegate-only wrappers, semantically empty layers/files, dead flags/config, and hand-rolled stdlib. Rank largest credible cuts first with replacement, but keep complexity-only findings separate from correctness/security/performance defects.

Score proposals by leverage, semantic risk, migration cost, testability gain, and replay/history preservation. Material refactors become a spec/ticket sequence, normally with a preparatory seam/refactor slice before behavior changes.
