---
name: wizard
description: Create a PowerShell-first interactive setup flow for human-only secrets, dashboards, credentials, or irreversible setup steps.
---

# wizard

Use only when automation cannot legitimately perform the step because a human must authenticate, enter a secret, accept terms, or authorize a consequential action.

Generate an idempotent PowerShell 7 script under `scripts/wizards/` when a reusable flow helps.

Requirements:
- explain the purpose before each human action;
- use hidden input for secrets;
- never print or commit secret values;
- prefer official CLIs/APIs after authentication;
- confirm irreversible actions explicitly;
- validate each step before proceeding;
- make reruns safe;
- record only non-sensitive evidence of completion.

Do not use a wizard to bypass a permission or authority boundary.
