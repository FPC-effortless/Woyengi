---
name: implement
description: Implement an approved Woyengi ticket/spec or experiment plan through branch isolation, falsifier-first minimal implementation, evidence, and review.
---
# implement

1. Read `/AGENTS.md` plus the active ticket/spec and reconstruct the relevant repository/experiment context.
2. Confirm outcome, constraints, authority, and verification seam; trace the real flow and material callers.
3. Work on a branch/sandbox; never directly on `main`.
4. Use `tdd` for code behavior or the equivalent falsifier-first loop for experiments.
5. Apply the universal ladder before adding code: need? existing Woyengi primitive? stdlib? native platform? installed dependency? direct form? only then minimum new code. For bugs, fix the common root seam rather than duplicated symptoms.
6. Do not create speculative abstractions/config/scaffolding. If a deliberate simplification has a real ceiling, mark `ponytail: <ceiling>, <upgrade trigger/path>`.
7. Run the applicable verification ladder from `docs/agents/verification.md`; non-trivial new logic needs at least one runnable check.
8. Capture evidence and unresolved risks.
9. Run `code-review`.
10. Commit and open/propose a PR; do not equate the Git commit with a Woyengi SemanticCommit.
11. Reconcile consequential external/canonical effects only through the authorized path.

For established `prd.json` work, preserve the existing `agent.md` rule: `passes` stays false until automated checks pass and human acceptance is confirmed.
