import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const servicesRoot = join(root, "services");
const violations = [];
for (const entry of readdirSync(servicesRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
  const publicInterface = join(servicesRoot, entry.name, "index.ts");
  if (!existsSync(publicInterface)) violations.push(`missing public service interface: ${relative(root, publicInterface)}`);
}
for (const path of sourceFiles(root)) {
  const source = readFileSync(path, "utf8");
  const owner = serviceOwner(path, servicesRoot);
  for (const match of source.matchAll(/(?:from\s+|import\s*)["']([^"']*services\/([^/]+)\/src\/[^"']+)["']/g)) {
    const target = match[2];
    if (owner !== target) violations.push(`forbidden deep service import in ${relative(root, path)}: ${match[1]}`);
  }
}
const result = { gate: "deep-module", status: violations.length === 0 ? "passed" : "failed", blocking: true, checks: violations.length === 0 ? ["all services expose index.ts", "no cross-service src imports"] : violations };
process.stdout.write(`${JSON.stringify(result)}\n`);
if (violations.length > 0) process.exitCode = 1;

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "production", "output"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:ts|js|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}
function serviceOwner(path, serviceRoot) { const rel = relative(serviceRoot, path).replaceAll("\\", "/"); return rel.startsWith("../") ? undefined : rel.split("/")[0]; }
