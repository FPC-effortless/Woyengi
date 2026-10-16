# Portable installation and instruction precedence

## Scope

The portable package is **one** user-level skill, `fpc-universal`. The installation scripts copy it into user-home locations, so new projects on the **same computer/user account** can discover it without adding the 83 upstream SKILL.md files to each repository. Repository-specific skills remain in their original workspace and are loaded on demand.

Installer targets:
- `~/.agents/skills/fpc-universal` — interoperable Agent Skills user directory; Gemini CLI supports this alias.
- `~/.codex/skills/fpc-universal` — Codex personal skills.
- `~/.claude/skills/fpc-universal` — Claude Code personal skills.
- `~/.continue/rules/99-fpc-universal.md` — Continue global rule linking to the canonical installed skill; uses a user-home path and avoids touching `~/.continue/config.yaml` or secrets.

Run **from a trusted checkout**, not by piping a remote script directly to a shell:

Unix/macOS: `bash .agents/skills/fpc-universal/scripts/install.sh`

Windows PowerShell: `powershell -ExecutionPolicy Bypass -File .agents/skills/fpc-universal/scripts/install.ps1` (from a local trusted checkout, only after reviewing the script).

Installers avoid clobbering an unrelated directory with the same name. They update only directories bearing their `.fpc-universal-managed` marker. Installation makes a local skill discoverable; it does not force automatic invocation, confer permissions, or synchronize across separate laptops, containers, ChatGPT Work cloud computers, organizations, or other user accounts. Repeat the installer within each isolated host as appropriate.

## Conflict handling

System/platform constraints > project safety and governing contracts > active task/spec and repository overlay > applicable specialized local skills > this general user skill. When conflicts cannot be resolved, ask for the required authority rather than silently overriding an existing contract.

Do not blanket-copy all 83 source files into user-home directories: some are framework-specific examples, require plugin APIs, or depend on platform/account authorization. Use the capability index instead.

## Checks

After installation verify that `SKILL.md` exists in the target user directories, `name` is `fpc-universal`, and source local overlays are still intact. In Gemini CLI: `/skills list` or `gemini skills list --all`; in Continue: confirm its global rule is picked up by the client or pass `cn --rule <path>` explicitly. Different tool versions can differ in discovery behavior; do not claim universal recognition without an actual host test.