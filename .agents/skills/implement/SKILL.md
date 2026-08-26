---
name: implement
description: Implement an approved Woyengi ticket/spec or experiment plan through branch isolation, TDD/falsification, evidence, and review.
---

# implement

1. Read `/AGENTS.md` plus the active ticket/spec and reconstruct the relevant repository/experiment context.
2. Confirm outcome, constraints, authority, and the verification seam.
3. Work on a branch/sandbox; never directly on `main`.
4. Use `tdd` for code behavior or the equivalent falsifier-first loop for experiments.
5. Make the smallest coherent change.
6. Run the applicable verification ladder from `docs/agents/verification.md`.
7. Capture evidence and unresolved risks.
8. Run `code-review`.
9. Commit and open/propose a PR; do not equate the Git commit with a Woyengi SemanticCommit.
10. Reconcile consequential external/canonical effects only through the authorized path.

For established `prd.json` work, preserve the existing `agent.md` rule: `passes` stays false until automated checks pass and human acceptance is confirmed.
