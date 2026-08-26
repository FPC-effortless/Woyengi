---
name: setup-matt-pocock-skills
description: Verify or repair this repository's adapted Matt Pocock skill installation without overwriting canonical Woyengi docs.
---

# setup-matt-pocock-skills

This repository uses a modified, repo-local installation in `.agents/skills`.

Verify:
- `/AGENTS.md` exists and extends `/agent.md`;
- `/CONTEXT.md` is terminology-only;
- `docs/agents/modes.md`, `workflow.md`, and `verification.md` exist;
- the 25 published skill names are present;
- `LICENSE-MATT-POCOCK` is present;
- skills defer to `CONSTITUTION.md`, `docs/architecture.md`, and `prd.json`.

Do not replace the adapted pack with a read-only upstream plugin. Upstream changes should be reviewed as a diff, selectively ported, and re-tested against Woyengi constraints.
