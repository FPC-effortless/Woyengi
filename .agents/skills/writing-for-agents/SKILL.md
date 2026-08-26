---
name: writing-for-agents
description: Write instructions and operational docs for agents with predictable triggers, progressive disclosure, explicit authority, outputs, and done conditions.
---

# writing-for-agents

Optimize for low cognitive load and reliable action selection.

An agent-facing instruction should state:
- when it applies;
- authoritative context pointers;
- required inputs;
- allowed/forbidden actions;
- procedure;
- expected outputs/evidence;
- done/stop conditions;
- escalation/authority boundary.

Prefer pointers to `CONSTITUTION.md`, architecture, specs, or source files over duplicating their contents. Keep one source of truth for each rule. Put rare details behind linked docs rather than bloating the entrypoint.
