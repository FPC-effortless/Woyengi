import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const options = parseArguments(process.argv.slice(2));
const config = readJson("production/00-config/production.config.json");
validateConfig(config);
const profile = options.profile ?? config.enforcement.defaultProfile;
if (!["fast", "standard", "release"].includes(profile)) usageError(`unsupported profile: ${profile}`);
const runId = options.runId ?? new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
if (!/^[a-zA-Z0-9._-]+$/.test(runId)) usageError("run id contains unsupported characters");
const runDirectory = join(root, "production", "runs", runId);
mkdirSync(runDirectory, { recursive: true });

const gateOrder = profile === "fast"
  ? ["requirements", "architecture", "deep-module", "security"]
  : ["requirements", "architecture", "deep-module", "data", "e2e", "security", "benchmark", "cost", "observability"];
const selected = options.gate === undefined ? gateOrder : gateOrder.includes(options.gate) ? [options.gate] : usageError(`gate ${options.gate} is not enabled in profile ${profile}`);
const results = [];
for (const gate of selected) {
  const result = executeGate(gate, profile, config);
  const complete = { ...result, timestamp: new Date().toISOString(), artifacts: [`${gate}.json`, `${gate}.md`] };
  validateGateResult(complete);
  writeFileSync(join(runDirectory, `${gate}.json`), `${JSON.stringify(complete, null, 2)}\n`, "utf8");
  writeFileSync(join(runDirectory, `${gate}.md`), gateMarkdown(complete), "utf8");
  results.push(complete);
}
const blockingFailures = results.filter((result) => result.blocking && result.status === "failed");
const decision = blockingFailures.length === 0 ? "GO" : "NO-GO";
const aggregate = { runId, profile, commit: commit(), startedAt: new Date().toISOString(), decision, results, blockingReasons: blockingFailures.flatMap((result) => result.checks.filter((check) => !check.passed).map((check) => `${result.gate}: ${check.detail}`)) };
writeFileSync(join(runDirectory, "results.json"), `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
writeFileSync(join(runDirectory, "summary.md"), summaryMarkdown(aggregate), "utf8");
if (profile === "release") writeFileSync(join(root, "production", "08-release", "go-no-go.md"), summaryMarkdown(aggregate), "utf8");
process.stdout.write(`${JSON.stringify({ runId, profile, decision, runDirectory, gates: results.map(({ gate, status }) => ({ gate, status })) }, null, 2)}\n`);
if (decision === "NO-GO") process.exitCode = 1;

function executeGate(gate, activeProfile, activeConfig) {
  try {
    if (gate === "requirements") {
      const prd = readJson("prd.json");
      const evidence = readJson("production/01-requirements/evidence.json");
      const requiredArtifacts = ["CONSTITUTION.md", "prd.json", "README.md", "QA.md", "docs/release.md", "docs/operations-runbook.md"];
      const missing = requiredArtifacts.filter((path) => !existsSync(join(root, path)));
      const incomplete = activeProfile === "release"
        ? prd.tickets.filter((ticket) => ticket.id !== "PLAT-040" && ticket.passes !== true).map((ticket) => ticket.id)
        : [];
      const humanQa = readJson("production/08-release/human-qa.json");
      const evidenceIssues = [];
      for (const ticket of prd.tickets) {
        const paths = evidence[ticket.id];
        if (!Array.isArray(paths) || paths.length === 0) evidenceIssues.push(`${ticket.id} has no evidence`);
        else for (const path of paths) if (typeof path !== "string" || !existsSync(join(root, path))) evidenceIssues.push(`${ticket.id} missing evidence path: ${String(path)}`);
      }
      for (const id of Object.keys(evidence)) if (!prd.tickets.some((ticket) => ticket.id === id)) evidenceIssues.push(`unknown evidence ticket: ${id}`);
      const humanQaPassed = activeProfile !== "release" || (
        humanQa.status === "acknowledged"
        && humanQa.acknowledgement === humanQa.requiredText
        && typeof humanQa.acknowledgedAt === "string"
        && humanQa.acknowledgedAt.length > 0
      );
      return result(gate, missing.length === 0 && incomplete.length === 0 && humanQaPassed && evidenceIssues.length === 0, [
        check(missing.length === 0, missing.length === 0 ? "required scope artifacts exist" : `missing: ${missing.join(", ")}`),
        check(incomplete.length === 0, incomplete.length === 0 ? "ticket state accepted for profile" : `incomplete tickets: ${incomplete.join(", ")}`),
        check(humanQaPassed, humanQaPassed ? "human QA evidence accepted for profile" : "human QA acknowledgement is pending"),
        check(evidenceIssues.length === 0, evidenceIssues.length === 0 ? `all ${prd.tickets.length} tickets have resolvable evidence` : evidenceIssues.join("; ")),
      ]);
    }
    if (gate === "architecture") {
      const constitution = readText("CONSTITUTION.md");
      return result(gate, /generated text[\s\S]*equivalent to state/i.test(constitution) && /domain/i.test(constitution), [check(/generated text[\s\S]*equivalent to state/i.test(constitution), "persistent-state invariant present"), check(/domain/i.test(constitution), "domain-kernel separation documented")]);
    }
    if (gate === "deep-module") return commandGate(gate, process.execPath, [join(root, "production/scripts/deep_module_enforce.js")]);
    if (gate === "data") {
      const schema = readJson("schemas/canonical-record.schema.json");
      const migrations = readJson("migrations/manifest.json");
      const invariants = readJson("production/03-data/invariants.json");
      const passed = schema.required?.includes("transactionTime") && Number.isInteger(migrations.currentVersion) && Object.values(invariants).every(Boolean);
      return result(gate, passed, [check(Boolean(schema.required?.includes("transactionTime")), "canonical schema requires transaction time"), check(Number.isInteger(migrations.currentVersion), "migration manifest has a current version"), check(Object.values(invariants).every(Boolean), "data invariants enabled")]);
    }
    if (gate === "e2e") {
      const build = runPackageScript("build");
      const boundaries = runPackageScript("boundaries");
      const tests = runPackageScript("test:all");
      const browser = readJson("production/04-testing/browser-evidence.json");
      const browserPassed = browser.status === "passed" && browser.consoleErrors === 0 && browser.horizontalOverflow === false;
      return result(gate, build.ok && boundaries.ok && tests.ok && browserPassed, [check(build.ok, build.detail), check(boundaries.ok, boundaries.detail), check(tests.ok, tests.detail), check(browserPassed, "real-browser Explorer evidence is clean")]);
    }
    if (gate === "security") return commandGate(gate, process.execPath, [join(root, "production/scripts/security_scan.js")]);
    if (gate === "benchmark") {
      const execution = runPackageScript("benchmark");
      const baseline = readJson("production/baselines/benchmark.json");
      const passed = execution.ok && baseline.correctness >= activeConfig.thresholds.benchmarkCorrectness && baseline.permissionLeakageRate <= activeConfig.thresholds.permissionLeakageRate;
      return result(gate, passed, [check(execution.ok, execution.detail), check(passed, "benchmark baseline meets correctness and leakage thresholds")]);
    }
    if (gate === "cost") {
      const baseline = readJson("production/baselines/cost.json");
      const budgets = readJson("production/06-performance/budgets.json");
      const passed = baseline.relativeCost <= 1 + budgets.maximumCostRegressionPercent / 100;
      return result(gate, passed, [check(passed, `relative cost ${baseline.relativeCost} within ${budgets.maximumCostRegressionPercent}% budget`)]);
    }
    if (gate === "observability") {
      const source = readText("packages/observability/src/index.ts");
      const requirements = readJson("production/07-observability/requirements.json");
      const metricCount = [...source.matchAll(/^  "[a-z_]+",$/gm)].length;
      const correlation = requirements.requiredCorrelation.every((field) => source.includes(field));
      const passed = metricCount >= requirements.requiredQualityMetricCount && correlation && source.includes("REDACTED");
      return result(gate, passed, [check(metricCount >= requirements.requiredQualityMetricCount, `${metricCount} quality metrics available`), check(correlation, "audit correlation fields present"), check(source.includes("REDACTED"), "telemetry redaction present")]);
    }
    throw new Error(`unknown gate: ${gate}`);
  } catch (error) {
    return result(gate, false, [check(false, error instanceof Error ? error.message : String(error))]);
  }
}

function commandGate(gate, command, args) {
  const execution = run(command, args);
  if (!execution.ok) return result(gate, false, [check(false, execution.detail)]);
  try {
    const output = JSON.parse(execution.stdout.trim().split(/\r?\n/).at(-1));
    return result(gate, output.status === "passed", (output.checks ?? []).map((item) => check(typeof item === "string", typeof item === "string" ? item : JSON.stringify(item))));
  } catch {
    return result(gate, false, [check(false, "gate command did not emit valid JSON")]);
  }
}
function run(command, args) { const value = spawnSync(command, args, { cwd: root, encoding: "utf8", shell: false, env: process.env }); return { ok: value.status === 0, stdout: value.stdout ?? "", detail: value.status === 0 ? `${command} ${args.join(" ")} passed` : `${command} ${args.join(" ")} failed: ${(value.stderr || value.stdout || "no output").trim().slice(-1200)}` }; }
function result(gate, passed, checks) { return { gate, status: passed ? "passed" : "failed", blocking: true, checks }; }
function check(passed, detail) { return { passed: Boolean(passed), detail: String(detail) }; }
function validateGateResult(value) { if (!value.gate || !["passed", "warning", "failed"].includes(value.status) || typeof value.blocking !== "boolean" || !Array.isArray(value.checks)) throw new Error("malformed gate result"); }
function readJson(path) { return JSON.parse(readText(path)); }
function readText(path) { return readFileSync(join(root, path), "utf8"); }
function runPackageScript(script) {
  const entrypoint = process.env.npm_execpath;
  return entrypoint === undefined ? run("pnpm", [script]) : run(process.execPath, [entrypoint, script]);
}
function commit() { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { return "unknown"; } }
function gateMarkdown(value) { return `# ${value.gate} gate\n\nStatus: **${value.status.toUpperCase()}**\n\n${value.checks.map((item) => `- ${item.passed ? "PASS" : "FAIL"}: ${item.detail}`).join("\n")}\n`; }
function summaryMarkdown(value) { return `# Production readiness decision\n\nDecision: **${value.decision}**\n\n- Run: ${value.runId}\n- Profile: ${value.profile}\n- Commit: ${value.commit}\n\n## Gates\n\n${value.results.map((item) => `- ${item.status === "passed" ? "PASS" : "FAIL"} — ${item.gate}`).join("\n")}\n\n## Blocking reasons\n\n${value.blockingReasons.length === 0 ? "None." : value.blockingReasons.map((item) => `- ${item}`).join("\n")}\n\n## Remediation\n\n${value.decision === "GO" ? "No blocking remediation remains for this profile." : "Resolve every blocking reason and rerun the same profile. Gates fail closed; do not update baselines after a failing run."}\n`; }
function parseArguments(args) { const output = {}; for (let index = 0; index < args.length; index += 1) { const key = args[index]; if (["--autofix", "--update-baseline"].includes(key)) { output[key.slice(2).replaceAll("-", "_")] = true; continue; } const value = args[index + 1]; if (!["--profile", "--gate", "--run-id", "--max-iterations"].includes(key) || value === undefined) usageError(`invalid option: ${key}`); output[key.slice(2).replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value; index += 1; } return output; }
function validateConfig(value) { for (const key of ["gates", "thresholds", "app", "db", "journeys", "enforcement"]) if (value[key] === undefined) throw new Error(`production config missing ${key}`); }
function usageError(message) { process.stderr.write(`${message}\nusage: production-os --profile <fast|standard|release> [--gate name] [--run-id id] [--autofix] [--max-iterations n]\n`); process.exit(2); }
