# Installing the Universal Coding Agent System in another repository

Copy `.agents/universal/CONTRACT.md`, `.agents/universal/PONYTAIL-FUSION.md`, `.agents/skills/`, and the relevant `docs/agents/*` workflow/verification guidance. Add an `AGENTS.md` that places repository-specific instructions, security constraints, issue/spec requirements, and local overlays above the universal contract.

The fused pack preserves 25 adapted Matt Pocock compatibility names plus six Ponytail compatibility skills. Keep both upstream MIT notices: `LICENSE-MATT-POCOCK` and `LICENSE-PONYTAIL`.

Do not make the universal layer highest authority. Local safety, privacy, data, scientific, release, state-semantic, and branch-ownership rules override it. For specialized semantics create `.agents/<repo-or-domain>/OVERLAY.md` rather than forking the universal contract.
