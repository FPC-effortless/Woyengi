---
name: code-review
description: Review changes independently across standards, specification, constitutional invariants, verification evidence, and unnecessary complexity.
---
# code-review

Review five axes separately before aggregating:
1. **Standards** — correctness, security, maintainability, clarity, performance, tests.
2. **Spec/Outcome Contract** — approved behavior and non-goals.
3. **Constitutional invariants** — history/replay, bitemporality, authority, conflicts, domain boundary, agent-write semantics, disposable indexes, effect separation.
4. **Verification/evidence** — claimed checks are real, sufficient, independent where needed, and reproducible.
5. **Minimality/complexity** — use Ponytail tags when material: `delete`, `stdlib`, `native`, `yagni`, `shrink`; identify location, what can be cut, and replacement. Keep this pass distinct from correctness/security/performance and never flag a necessary smoke/regression check as bloat.

Where supported, use independent reviewers/subagents for axes to reduce correlated blind spots. Report concrete file/hunk evidence and severity. A strong axis cannot cancel a failure on another. If the complexity-only axis finds nothing material: `Lean already. Ship.`
