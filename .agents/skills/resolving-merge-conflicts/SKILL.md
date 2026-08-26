---
name: resolving-merge-conflicts
description: Resolve merge conflicts by reconstructing both sides' intent and preserving higher-order invariants.
---

# resolving-merge-conflicts

Do not choose sides by recency alone.

For each conflict:
1. inspect the base and both change intents;
2. identify the governing spec/ticket/ADR;
3. preserve constitutional invariants and accepted behavior from both sides where compatible;
4. re-run targeted tests after resolution;
5. run the broader verification ladder before declaring the merge healthy.

Never use conflict resolution to silently drop history, verification, authority checks, or a separately approved behavior. If intents are genuinely incompatible, stop at an explicit decision point rather than inventing policy.
