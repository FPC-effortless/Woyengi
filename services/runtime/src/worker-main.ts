import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { LocalJobStore, PlatformWorker } from "./index.ts";

const dataDirectory = resolve(process.env.WOYENGI_DATA_DIR ?? "./.woyengi-data");
await mkdir(dataDirectory, { recursive: true });
const store = LocalJobStore.open(join(dataDirectory, "worker", "jobs.json"));
const worker = new PlatformWorker({
  store,
  handlers: {},
  publish: async (event) => { process.stdout.write(`${JSON.stringify(event)}\n`); },
});
let running = false;
const timer = setInterval(() => {
  if (running) return;
  running = true;
  void worker.runNext(new Date().toISOString()).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }).finally(() => { running = false; });
}, 250);
process.stdout.write("Woyengi Platform Worker ready.\n");
function shutdown(signal: string): void {
  clearInterval(timer);
  process.stdout.write(`Received ${signal}; Platform Worker stopped.\n`);
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
