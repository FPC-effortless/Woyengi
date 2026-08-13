import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const candidates = [
  process.env.WOYENGI_PYTHON,
  process.platform === "win32"
    ? join(
        homedir(),
        ".cache",
        "codex-runtimes",
        "codex-primary-runtime",
        "dependencies",
        "python",
        "python.exe",
      )
    : undefined,
  "python3",
  "python",
].filter(Boolean);

let python;
for (const candidate of candidates) {
  if (candidate.includes("/") || candidate.includes("\\")) {
    if (!existsSync(candidate)) continue;
  }
  const probe = spawnSync(candidate, ["--version"], { timeout: 5_000, stdio: "ignore" });
  if (probe.status === 0) {
    python = candidate;
    break;
  }
}

if (python === undefined) {
  process.stderr.write(
    "Python 3 was not found. Set WOYENGI_PYTHON to a Python 3 executable.\n",
  );
  process.exit(1);
}

const result = spawnSync(
  python,
  ["-m", "unittest", "discover", "-s", "packages/sdk-python/tests", "-v"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
