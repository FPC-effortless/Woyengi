import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { HTTP_ROUTES, PlatformClient } from "../src/index.ts";

test("TypeScript SDK follows shared routes and reuses idempotency keys across retries", async () => {
  const fixture = JSON.parse(await readFile(new URL("../../../protocols/http-contract.json", import.meta.url), "utf8"));
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
  let failures = 1;
  const client = new PlatformClient({
    baseUrl: "https://platform.example",
    token: "token",
    async transport(url, init) {
      calls.push({ url, init });
      if (failures-- > 0) throw new Error("network reset");
      return { status: 200, json: async () => ({ ok: true, data: { id: "ingestion:1" }, meta: { traceId: "trace:1" } }) };
    },
    retries: 1,
  });

  const result = await client.ingest({ source: "document" }, { idempotencyKey: "request:stable" });

  assert.deepEqual(HTTP_ROUTES, fixture.routes);
  assert.equal(result.id, "ingestion:1");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.init.headers["idempotency-key"], "request:stable");
  assert.equal(calls[1]?.init.headers["idempotency-key"], "request:stable");
  assert.equal(typeof client.state, "function");
  assert.equal(typeof client.reconstruct, "function");
  assert.equal(typeof client.control, "function");
  assert.equal(typeof client.subscribe, "function");
});
