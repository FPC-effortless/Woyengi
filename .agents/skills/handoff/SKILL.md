---
name: handoff
description: Create a durable, compact handoff that lets a fresh agent continue from evidence rather than conversation memory.
---

# handoff

Write handoffs under `.agents/handoffs/<YYYYMMDD-HHMM>-<slug>.md`.

Reference durable artifacts instead of duplicating them. Include:
- work mode;
- WorkInstance/WorkEpisode or task/ticket identifier;
- outcome and current state;
- decisions already made and their source;
- branch/commit/PR or experiment artifacts;
- tests/commands/metrics actually run;
- evidence and failures;
- authority/external-effect status;
- unresolved questions/risks;
- exact recommended next skill/action.

Redact secrets and sensitive credentials. A handoff is a reconstruction pointer, not a replacement for canonical project history.
