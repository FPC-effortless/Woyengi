# FPC Universal — all-GitHub repository rollout

## Status (2026-10-16)
- Owned repositories inventoried: **82**
- Populated repositories with proposed universal-skill draft PRs: **77 / 77**, including this Woyengi source PR.
- Empty repositories with no base commit: **5** (cannot create a normal feature-branch PR until initialized).
- No default branch changes or merges have been performed by this rollout.

The repository changes are deliberately small:
1. Copy a portable self-contained `.agents/skills/fpc-universal/SKILL.md`.
2. Create an `AGENTS.md` entry point where missing; otherwise append a small link where needed while keeping all existing instructions.
3. Open a **draft PR** for review. Project-local rules remain authoritative.

Each repository already containing agent/skill instructions retains them. The universal skill is a general router; it does not grant authority to access secrets, spend money, write to production, merge, or deploy.

## Update new or existing repositories

From a local clone of Woyengi, use GitHub CLI authenticated to your account:

```bash
gh auth status
python .agents/skills/fpc-universal/scripts/sync-github-repos.py
python .agents/skills/fpc-universal/scripts/sync-github-repos.py --apply
```

The first run **plans without changes**. The second adds or updates repo-local files on a feature branch and opens draft PRs. It uses only GitHub CLI + Python standard library; it does not change the default branch, merge PRs or trigger deployments. To update an existing named universal skill on its feature branch, use `--apply --refresh`. To continue the initial rollout PR branches, supply `--branch chore/fpc-universal-skill-20261016`.

For targeted validation use `--limit N`. For new rollout generations choose a fresh `--branch` to avoid reusing merged/closed PR branches.

## Caveats and supported surfaces

- Once the per-repository PR merges, Codex and other clients supporting root `AGENTS.md` can read the entry point and the local SKILL.md. Existing specialized instructions are not overwritten.
- Some agent hosts have separate skill-discovery conventions. A repository file does not magically install itself into every local or cloud runtime; use the included user-level installer or configure that runtime's skill directories if required.
- GitHub does not natively propagate arbitrary skill files to every owned repository. For future repositories, rerun the synchronization command or configure an authorized dedicated GitHub App workflow. The ordinary repository GitHub Actions token cannot write to unrelated private repositories.
- This is an **agent-guidance rollout**, not a full code review, a product-release qualification, or automatic CI validation across 77 repositories.
- Never place private repository names, access tokens, or private project content in public rollout logs or source README files without deliberate review.

## Source of truth

Woyengi hosts the canonical skill and optional capability/provenance references. Distributed copies are snapshots and should be reconciled through a controlled sync PR rather than silently modified on default branches.
