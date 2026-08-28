---
name: ponytail-audit
description: Scan the whole repository for over-engineering and rank deletions/reuse/stdlib/native replacements.
---
# ponytail-audit
Repo-wide complexity pass. Hunt dependencies duplicating stdlib/native features, one-implementation interfaces, one-product factories, delegate-only wrappers, semantically empty files/layers, dead flags/config, and hand-rolled stdlib. Use `delete`, `stdlib`, `native`, `yagni`, `shrink`; rank biggest credible cut first. Optionally summarize `net: -N lines, -M deps possible` as future reduction estimates only. Correctness/security/performance route to normal `code-review`. Read/report only unless fixes are separately authorized.
