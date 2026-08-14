import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageRoot = join(root, "packages");
const files = sourceFiles(packageRoot);
const edges = new Map();
const violations = [];
for (const file of files) {
  const owner = packageOwner(file);
  if (owner === undefined) continue;
  if (!edges.has(owner)) edges.set(owner, new Set());
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;
    const target = normalize(resolve(dirname(file), specifier));
    if (!existsSync(target)) violations.push(`unresolved relative import in ${relative(root, file)}: ${specifier}`);
    const targetOwner = packageOwner(target);
    if (targetOwner === undefined || targetOwner === owner) continue;
    edges.get(owner).add(targetOwner);
    const publicTarget = normalize(join(packageRoot, targetOwner, "src", "index.ts"));
    if (target !== publicTarget) violations.push(`non-public cross-package import in ${relative(root, file)}: ${specifier}`);
  }
}
for (const cycle of cycles(edges)) violations.push(`package dependency cycle: ${cycle.join(" -> ")}`);
const report = { gate: "package-boundaries", status: violations.length === 0 ? "passed" : "failed", packages: [...edges.keys()].sort(), checks: violations.length === 0 ? ["cross-package imports target public index.ts files", "package dependency graph is acyclic"] : violations };
process.stdout.write(`${JSON.stringify(report)}\n`);
if (violations.length > 0) process.exitCode = 1;

function sourceFiles(directory) { const values = []; for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) values.push(...sourceFiles(path)); else if (entry.name.endsWith(".ts")) values.push(path); } return values; }
function packageOwner(path) { const value = relative(packageRoot, path).replaceAll("\\", "/"); return value.startsWith("../") ? undefined : value.split("/")[0]; }
function cycles(graph) {
  const found = new Map();
  for (const start of [...graph.keys()].sort()) visit(start, [], new Set());
  return [...found.values()];
  function visit(node, path, active) {
    if (active.has(node)) { const index = path.indexOf(node); const cycle = [...path.slice(index), node]; const canonical = canonicalCycle(cycle); found.set(canonical.join("|"), canonical); return; }
    if (path.includes(node)) return;
    const nextActive = new Set(active).add(node);
    for (const target of [...(graph.get(node) ?? [])].sort()) visit(target, [...path, node], nextActive);
  }
}
function canonicalCycle(cycle) { const ring = cycle.slice(0, -1); const rotations = ring.map((_, index) => [...ring.slice(index), ...ring.slice(0, index)]); rotations.sort((left, right) => left.join("|").localeCompare(right.join("|"))); return [...rotations[0], rotations[0][0]]; }
