import assert from "node:assert/strict";
import { test } from "node:test";

import { PlatformApi } from "../src/index.ts";

test("serves authenticated capability-checked INGEST, STATE, RECONSTRUCT, and CONTROL APIs", async (context) => {
  const calls: string[] = [];
  const api = new PlatformApi({
    authenticate(value) {
      return value === "Bearer valid" ? { id: "user:123" } : undefined;
    },
    authorize(input) {
      return { allowed: input.principal === "user:123", rationale: "test policy" };
    },
    async ingest(input) {
      calls.push(`ingest:${input.idempotencyKey}`);
      return { id: "ingestion:1" };
    },
    async state(input) {
      calls.push(`state:${input.entityId}:${input.validAt}:${input.recordedAt}`);
      return { items: [{ id: "claim:1" }], nextCursor: "cursor:next" };
    },
    async reconstruct() {
      calls.push("reconstruct");
      return { id: "reconstruction:1", currentState: [] };
    },
    async control(input) {
      calls.push(`control:${input.action}`);
      return { id: "control:1", status: "accepted" };
    },
    async subscribe(input) {
      calls.push(`subscribe:${input.subscriptionId}:${input.cursor ?? "start"}`);
      return { events: [{ id: "platform-event:1" }], nextCursor: null };
    },
  });
  const server = await api.listen({ hostname: "127.0.0.1", port: 0 });
  context.after(() => server.close());
  const headers = { authorization: "Bearer valid", "content-type": "application/json", "x-trace-id": "trace:test" };

  const ingest = await fetch(`${server.url}/v1/ingest`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": "request:ingest-1" },
    body: JSON.stringify({ source: "document" }),
  });
  const state = await fetch(`${server.url}/v1/state/entities/entity%3Aproject-alpha?limit=25&cursor=cursor%3Astart&validAt=2026-02-01T00%3A00%3A00Z&recordedAt=2026-02-02T00%3A00%3A00Z`, { headers });
  const reconstruct = await fetch(`${server.url}/v1/reconstruct`, {
    method: "POST",
    headers,
    body: JSON.stringify({ request: "prepare context" }),
  });
  const control = await fetch(`${server.url}/v1/control/verify`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": "request:control-1" },
    body: JSON.stringify({ subjectId: "claim:1" }),
  });
  const subscription = await fetch(`${server.url}/v1/subscriptions/${encodeURIComponent("subscription:all")}?limit=25&cursor=${encodeURIComponent("platform-event:0")}`, { headers });
  const unauthorized = await fetch(`${server.url}/v1/reconstruct`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request: "leak state" }),
  });

  for (const response of [ingest, state, reconstruct, control, subscription]) assert.equal(response.status, 200);
  assert.deepEqual(calls, ["ingest:request:ingest-1", "state:entity:project-alpha:2026-02-01T00:00:00.000Z:2026-02-02T00:00:00.000Z", "reconstruct", "control:verify", "subscribe:subscription:all:platform-event:0"]);
  assert.equal((await ingest.json()).meta.traceId, "trace:test");
  assert.equal((await state.json()).data.nextCursor, "cursor:next");
  assert.equal((await subscription.json()).data.events[0].id, "platform-event:1");
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "UNAUTHENTICATED");
});

test("returns stable public port errors", async (context) => {
  const { PlatformApiError } = await import("../src/index.ts");
  const api = new PlatformApi({
    authenticate: () => ({ id: "user:123" }),
    authorize: () => ({ allowed: true, rationale: "test" }),
    ingest: async () => { throw new PlatformApiError(409, "IDEMPOTENCY_CONFLICT", "The key was already used."); },
    state: async () => ({}), reconstruct: async () => ({}), control: async () => ({}), subscribe: async () => ({}),
  });
  const server = await api.listen({ hostname: "127.0.0.1", port: 0 });
  context.after(() => server.close());
  const response = await fetch(`${server.url}/v1/ingest`, { method: "POST", headers: { authorization: "Bearer valid", "content-type": "application/json", "idempotency-key": "request:1" }, body: "{}" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "IDEMPOTENCY_CONFLICT");
});
