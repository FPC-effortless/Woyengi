#!/usr/bin/env bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${HOME:?HOME is required}"
if [[ ! -f "$SOURCE_DIR/SKILL.md" ]] || ! grep -q '^name: fpc-universal$' "$SOURCE_DIR/SKILL.md"; then
  echo 'Invalid fpc-universal source skill' >&2
  exit 1
fi
install_skill() {
  local dest="$1"
  if [[ -e "$dest" && ! -f "$dest/.fpc-universal-managed" ]]; then
    printf 'SKIP unmanaged destination: %s\n' "$dest" >&2
    return
  fi
  mkdir -p "$dest"
  cp -R "$SOURCE_DIR"/. "$dest"/
  printf 'Managed by FPC Universal local installer\n' > "$dest/.fpc-universal-managed"
  printf 'Installed: %s\n' "$dest"
}
install_skill "$HOME/.agents/skills/fpc-universal"
install_skill "$HOME/.codex/skills/fpc-universal"
install_skill "$HOME/.claude/skills/fpc-universal"
RULE_DIR="$HOME/.continue/rules"
RULE="$RULE_DIR/99-fpc-universal.md"
if [[ -e "$RULE" ]] && ! grep -q '^<!-- fpc-universal-managed -->$' "$RULE"; then
  printf 'SKIP unmanaged Continue rule: %s\n' "$RULE" >&2
else
  mkdir -p "$RULE_DIR"
  cat > "$RULE" <<'RULE_TEXT'
---
name: FPC Universal Coding and Research
alwaysApply: true
---
<!-- fpc-universal-managed -->
For substantive engineering or research requests, read the user-level `~/.agents/skills/fpc-universal/SKILL.md` and relevant on-demand references when they are accessible in this environment. Respect this workspace's local AGENTS.md, CLAUDE.md, security rules, approved specifications, and any specialized skill before the general skill. Do not presume access to unavailable tools or external accounts.
RULE_TEXT
  printf 'Installed Continue rule: %s\n' "$RULE"
fi
