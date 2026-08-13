import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { LocalJobStore, ModularPlatformRuntime, PlatformWorker, REQUIRED_PLATFORM_MODULES } from "../src/index.ts";

test("composes in-process modules and runs idempotent retryable observable jobs", async () => {
  const calls: string[] = [];
  const modules = Object.fromEntries(REQUIRED_PLATFORM_MODULES.map((name) => [name, {
    name,
    contractVersion: "1.0.0",
    execute: async (operation: string) => { calls.push(`${name}:${operation}`); return { module: name, operation }; },
  }]));
  const runtime = ModularPlatformRuntime.compose(modules);
  const result = await runtime.invoke("reconstruction", "reconstruct", { request: "prepare" });
  assert.deepEqual(result, { module: "reconstruction", operation: "reconstruct" });
  assert.deepEqual(calls, ["reconstruction:reconstruct"]);
  assert.deepEqual(runtime.boundaries(), REQUIRED_PLATFORM_MODULES.map((name) => ({ name, contractVersion: "1.0.0", transport: "in-process" })));

  const root = await mkdtemp(join(tmpdir(), "woyengi-worker-"));
  const store = LocalJobStore.open(join(root, "jobs.json"));
  const events: unknown[] = [];
  let attempts = 0;
  const worker = new PlatformWorker({
    store,
    publish: async (event) => { events.push(event); },
    handlers: {
      "state.rebuild": async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient store failure");
        return { rebuilt: true };
      },
    },
  });
  const first = await worker.enqueue({ id: "job:rebuild-1", type: "state.rebuild", idempotencyKey: "state:workspace-1", payload: { workspaceId: "workspace:1" }, maxAttempts: 3, recordedAt: "2026-04-03T00:00:00Z" });
  const duplicate = await worker.enqueue({ id: "job:duplicate", type: "state.rebuild", idempotencyKey: "state:workspace-1", payload: {}, maxAttempts: 3, recordedAt: "2026-04-03T00:00:01Z" });
  assert.equal(duplicate.id, first.id);
  assert.equal(store.all().length, 1);

  await worker.runNext("2026-04-03T00:01:00Z");
  assert.equal(store.get(first.id)?.status, "retryable");
  await worker.runNext("2026-04-03T00:02:00Z");
  assert.equal(store.get(first.id)?.status, "completed");
  assert.equal(store.get(first.id)?.attempts, 2);
  assert.deepEqual(events.map((event: any) => event.topic), ["job.queued", "job.started", "job.retryable", "job.started", "job.completed"]);
  assert.equal(LocalJobStore.open(join(root, "jobs.json")).get(first.id)?.status, "completed");
});
