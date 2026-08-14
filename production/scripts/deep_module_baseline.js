import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(import.meta.dirname, "../baselines/deep-module.json");
mkdirSync(resolve(import.meta.dirname, "../baselines"), { recursive: true });
writeFileSync(path, `${JSON.stringify({ violations: [], capturedAt: new Date().toISOString() })}\n`, "utf8");
process.stdout.write(`${path}\n`);
