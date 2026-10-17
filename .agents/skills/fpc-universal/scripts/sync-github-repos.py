#!/usr/bin/env python3
"""Safely propose FPC Universal skill installation across owned GitHub repositories.

Requires: Python 3.10+, GitHub CLI (`gh`) authenticated with repo access.
Dry-run by default. --apply creates/updates a feature branch and draft PR,
never writes to a default branch and never merges.
"""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import quote

BRANCH = "chore/fpc-universal-skill-sync"
SKILL_PATH = ".agents/skills/fpc-universal/SKILL.md"
AGENT_PATH = "AGENTS.md"
MARKER = "## Shared FPC universal skill"
AGENT_NOTE = (
    "# Repository agent guidance\n\n"
    "For substantive software engineering, product or research tasks, read "
    "`.agents/skills/fpc-universal/SKILL.md` when relevant. "
    "Existing local and nested agent instructions, approved specs, safety, "
    "security, verification and release rules take precedence. "
    "No permission to access secrets, incur cost, deploy or merge is implied.\n"
)
APPEND_NOTE = (
    "\n\n" + MARKER + "\n\n"
    "For relevant tasks also consult `.agents/skills/fpc-universal/SKILL.md`. "
    "All project-specific instructions and safety/release rules take precedence.\n"
)


def command(*args: str, input_text: str | None = None) -> str:
    p = subprocess.run(
        list(args), input=input_text, text=True, capture_output=True, check=False
    )
    if p.returncode != 0:
        raise RuntimeError(f"{' '.join(args[:4])}: {p.stderr.strip()}")
    return p.stdout.strip()


def api(endpoint: str, *, method: str = "GET",
        payload: dict | None = None, missing_ok: bool = False):
    cmd = ["gh", "api"]
    if method != "GET":
        cmd.extend(["--method", method])
    cmd.append(endpoint)
    if payload is not None:
        cmd.extend(["--input", "-"])
    p = subprocess.run(
        cmd, input=json.dumps(payload) if payload is not None else None,
        text=True, capture_output=True, check=False
    )
    if p.returncode != 0:
        if missing_ok and ("404" in p.stderr or "Not Found" in p.stderr):
            return None
        raise RuntimeError(f"gh api {endpoint}: {p.stderr.strip()}")
    return json.loads(p.stdout) if p.stdout.strip() else None


def repos_for_owner(owner: str) -> list[dict]:
    all_repos = []
    page = 1
    while True:
        rows = api(f"user/repos?affiliation=owner&per_page=100&page={page}")
        all_repos.extend(r for r in rows if r["owner"]["login"].lower() == owner.lower())
        if len(rows) < 100:
            break
        page += 1
    return sorted(all_repos, key=lambda x: x["name"].casefold())


def portable_source(source: str) -> str:
    return source.replace(
        "See `references/skill-map.md` for provenance and routes.",
        "When present, use trusted local specialist skills; canonical provenance references are optional."
    ).replace(
        "See `references/skill-map.md` for source skill families and "
        "`references/install-and-precedence.md` for distribution details. "
        "Load those files only if needed for the current request.",
        "This single-file copy is self-contained; optional provenance references "
        "are maintained in the Woyengi source repository."
    )


def contents(repo: str, path: str, ref: str) -> dict | None:
    return api(
        f"repos/{repo}/contents/{quote(path, safe='/')}?ref={quote(ref, safe='')}",
        missing_ok=True
    )


def read_file(repo: str, path: str, ref: str) -> tuple[str, str] | None:
    data = contents(repo, path, ref)
    if data is None:
        return None
    if not isinstance(data, dict) or data.get("type") != "file":
        raise ValueError(f"Not a file: {repo}/{path}")
    raw = base64.b64decode(data.get("content", ""))
    return raw.decode("utf-8"), data["sha"]


def write_file(repo: str, path: str, branch: str, text: str,
               current_sha: str | None = None) -> None:
    body = {
        "message": "Sync shared FPC universal agent skill",
        "branch": branch,
        "content": base64.b64encode(text.encode("utf-8")).decode("ascii"),
    }
    if current_sha:
        body["sha"] = current_sha
    api(f"repos/{repo}/contents/{quote(path, safe='/')}", method="PUT", payload=body)


def prepare_branch(repo: str, base: str, branch: str) -> None:
    path = f"repos/{repo}/git/ref/heads/{quote(branch, safe='/')}"
    if api(path, missing_ok=True):
        return
    head = api(f"repos/{repo}/git/ref/heads/{quote(base, safe='/')}")
    api(f"repos/{repo}/git/refs", method="POST",
        payload={"ref": f"refs/heads/{branch}", "sha": head["object"]["sha"]})


def open_draft_pr(repo: str, base: str, branch: str) -> str:
    existing = json.loads(command(
        "gh", "pr", "list", "--repo", repo, "--head", branch,
        "--state", "open", "--json", "url"
    ))
    if existing:
        return existing[0]["url"]
    return command(
        "gh", "pr", "create", "--repo", repo, "--head", branch,
        "--base", base, "--draft", "--title", "Enable FPC universal skill",
        "--body", "Docs-only shared skill setup. Local agent rules take priority. "
        "No default-branch change without PR review."
    )


def apply_repo(repo: dict, branch: str, skill: str, refresh: bool) -> str:
    name = repo["full_name"]
    base = repo["default_branch"]
    prepare_branch(name, base, branch)
    changed = False
    prior = read_file(name, SKILL_PATH, branch)
    if prior is None:
        write_file(name, SKILL_PATH, branch, skill)
        changed = True
    elif prior[0] != skill:
        if not refresh:
            print(f"  Preserve existing skill in {name} (pass --refresh to update).")
        elif not prior[0].startswith("---\nname: fpc-universal\n"):
            raise ValueError("Existing SKILL.md does not have the expected managed skill name")
        else:
            write_file(name, SKILL_PATH, branch, skill, prior[1])
            changed = True

    root = read_file(name, AGENT_PATH, branch)
    if root is None:
        write_file(name, AGENT_PATH, branch, AGENT_NOTE)
        changed = True
    elif SKILL_PATH not in root[0]:
        write_file(name, AGENT_PATH, branch, root[0].rstrip() + APPEND_NOTE, root[1])
        changed = True

    if changed:
        return open_draft_pr(name, base, branch)
    # An unchanged branch may have an existing open draft PR; don't create an empty PR.
    existing = json.loads(command(
        "gh", "pr", "list", "--repo", name, "--head", branch,
        "--state", "open", "--json", "url"
    ))
    return existing[0]["url"] if existing else "already covered; no new change"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", default="FPC-effortless")
    parser.add_argument("--branch", default=BRANCH)
    parser.add_argument("--apply", action="store_true", help="Create draft PRs")
    parser.add_argument("--refresh", action="store_true",
                        help="Update existing named FPC skills on the feature branch")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    source = Path(__file__).resolve().parents[1] / "SKILL.md"
    if not source.is_file():
        parser.error(f"Cannot find canonical skill: {source}")
    skill = portable_source(source.read_text(encoding="utf-8"))
    if not skill.startswith("---\nname: fpc-universal\n"):
        parser.error("Unexpected skill identity")

    command("gh", "auth", "status")
    rows = [
        r for r in repos_for_owner(args.owner)
        if not r.get("archived") and r.get("size", 0) > 0
        and r.get("name") != "Woyengi"
        and r.get("permissions", {}).get("push", False)
    ]
    if args.limit:
        rows = rows[:args.limit]
    print(f"{'APPLY' if args.apply else 'PLAN'}: {len(rows)} populated, writable repositories")
    if not args.apply:
        for r in rows:
            print(r["full_name"])
        print("No GitHub files or branches were changed. Use --apply to propose draft PRs.")
        return 0

    errors = []
    for idx, repo in enumerate(rows, 1):
        try:
            outcome = apply_repo(repo, args.branch, skill, args.refresh)
            print(f"[{idx}/{len(rows)}] {repo['full_name']}: {outcome}")
        except Exception as exc:
            errors.append(repo["full_name"])
            print(f"FAILED {repo['full_name']}: {exc}", file=sys.stderr)
    print(f"Completed {len(rows) - len(errors)}/{len(rows)} repositories")
    if errors:
        print("Failed: " + ", ".join(errors), file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
