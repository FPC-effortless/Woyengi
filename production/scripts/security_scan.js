import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const listed = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root, encoding: "utf8" });
if (listed.status !== 0) throw new Error("could not enumerate repository files");
const findings = [];
const extensions = new Set([".ts", ".js", ".mjs", ".json", ".yaml", ".yml", ".md", ".example"]);
for (const file of listed.stdout.split(/\r?\n/).filter(Boolean)) {
  if (file === ".env" || file.startsWith("production/runs/") || !extensions.has(extname(file))) continue;
  const content = readFileSync(resolve(root, file), "utf8");
  const patterns = [
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["cloud-access-key", /AKIA[0-9A-Z]{16}/],
    ["credential-assignment", /(?:password|api[_-]?key|secret|token)\s*[:=]\s*["'][^"'\s${}]{16,}["']/i],
  ];
  for (const [kind, pattern] of patterns) if (pattern.test(content)) findings.push({ file, kind, severity: "critical" });
}
const result = { gate: "security", status: findings.length === 0 ? "passed" : "failed", blocking: true, checks: findings.length === 0 ? ["no high-confidence committed secrets"] : findings };
process.stdout.write(`${JSON.stringify(result)}\n`);
if (findings.length > 0) process.exitCode = 1;
