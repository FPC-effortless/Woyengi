---
name: code-review
description: Review changes independently across standards, specification, constitutional invariants, and verification evidence.
---

# code-review

Review four axes separately before aggregating:

1. **Standards** — correctness, security, maintainability, clarity, performance, tests.
2. **Spec/Outcome Contract** — does the change actually satisfy the approved behavior and non-goals?
3. **Constitutional invariants** — history/replay, bitemporality, authority, conflicts, domain boundary, agent-write semantics, disposable indexes, effect separation.
4. **Verification/evidence** — are claimed checks real, sufficient, independent where needed, and reproducible?

Where the harness supports it, use independent reviewers/subagents for axes to reduce correlated blind spots. Report concrete file/hunk evidence and severity. Do not let a strong score on one axis cancel a failure on another.
