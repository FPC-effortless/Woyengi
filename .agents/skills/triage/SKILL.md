---
name: triage
description: Triage incoming issues or pull requests into evidence-backed states without silently changing the delivery contract.
---

# triage

Use for new incoming work, not for an already-approved `prd.json` ticket.

Classify category (`bug` or `enhancement`) and state:
- `needs-triage`
- `needs-info`
- `ready-for-agent`
- `ready-for-human`
- `wontfix`

Check:
1. Is the request reproducible/specific enough to act on?
2. Does it duplicate an existing ticket/spec/PR?
3. Does it touch constitutional state semantics, authority, replay, external effects, or the kernel/domain-package boundary?
4. What evidence would prove completion?
5. Can an agent proceed safely, or is a human decision/secret/authority step required?

A triaged issue may recommend an addition/change to `prd.json`, but must not silently rewrite its ordered delivery contract.
