---
name: handoff
description: Create a durable compact handoff so a fresh agent continues from evidence rather than conversation memory.
---
# handoff

Write handoffs under `.agents/handoffs/<YYYYMMDD-HHMM>-<slug>.md`.

Reference durable artifacts instead of duplicating them. Include work mode; WorkInstance/WorkEpisode or task/ticket identifier; outcome/current state; decisions and source; branch/commit/PR or experiment artifacts; tests/commands/metrics actually run; evidence/failures; authority/external-effect status; unresolved questions/risks; exact recommended next skill/action.

Also capture deliberate minimality decisions that matter later: every relevant `ponytail:` marker, its ceiling, upgrade trigger/path, and whether any marker has `no-trigger` debt risk.

Redact secrets and sensitive credentials. A handoff is a reconstruction pointer, not a replacement for canonical project history.
