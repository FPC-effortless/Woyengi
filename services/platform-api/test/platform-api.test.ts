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
      calls.push(`state:${input.entityId}`);
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
  });
  const server = await api.listen({ hostname: "127.0.0.1", port: 0 });
  context.after(() => server.close());
  const headers = { authorization: "Bearer valid", "content-type": "application/json", "x-trace-id": "trace:test" };

  const ingest = await fetch(`${server.url}/v1/ingest`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": "request:ingest-1" },
    body: JSON.stringify({ source: "document" }),
  });
  const state = await fetch(`${server.url}/v1/state/entities/entity%3Aproject-alpha?limit=25&cursor=cursor%3Astart`, { headers });
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
  const unauthorized = await fetch(`${server.url}/v1/reconstruct`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request: "leak state" }),
  });

  for (const response of [ingest, state, reconstruct, control]) assert.equal(response.status, 200);
  assert.deepEqual(calls, ["ingest:request:ingest-1", "state:entity:project-alpha", "reconstruct", "control:verify"]);
  assert.equal((await ingest.json()).meta.traceId, "trace:test");
  assert.equal((await state.json()).data.nextCursor, "cursor:next");
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "UNAUTHENTICATED");
});
