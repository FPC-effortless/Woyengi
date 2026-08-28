---
name: ponytail-review
description: Review a diff exclusively for removable over-engineering; applies no fixes.
---
# ponytail-review
Complexity-only pass, separate from correctness/security/performance. Format when possible: `<file>:L<line>: <tag> <what to cut>. <replacement>.` Tags: `delete`, `stdlib`, `native`, `yagni`, `shrink`. A necessary smoke/regression check is not bloat. `net: -N lines possible` is only a prospective estimate, never measured savings. Nothing material: `Lean already. Ship.` Report only unless fixes are separately authorized.
