import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { PlatformApi } from "../../services/platform-api/index.ts";

test("defines secret-externalized deployment and exercises health, readiness, and graceful shutdown", async () => {
  const compose = await readFile(new URL("../docker/compose.yaml", import.meta.url), "utf8");
  const dockerfile = await readFile(new URL("../docker/Dockerfile", import.meta.url), "utf8");
  for (const service of ["api:", "worker:", "database:", "object-storage:", "search:"]) assert.match(compose, new RegExp(`\\n  ${service}`));
  for (const secret of ["WOYENGI_API_TOKEN", "WOYENGI_POSTGRES_PASSWORD", "WOYENGI_OBJECT_STORE_SECRET", "WOYENGI_SEARCH_KEY"]) assert.match(compose, new RegExp(`\\$\\{${secret}:\\?`));
  assert.doesNotMatch(`${compose}\n${dockerfile}`, /password:\s*(?:password|postgres|woyengi)|api[_-]?key:\s*(?:master|secret)/i);
  assert.match(dockerfile, /USER woyengi/);

  let ready = false;
  const api = new PlatformApi({
    operational: async () => ({ healthy: true, ready, checks: { ledger: ready ? "up" : "down" } }),
    authenticate: () => undefined,
    authorize: () => ({ allowed: false, rationale: "not used" }),
    ingest: async () => ({}), state: async () => ({}), reconstruct: async () => ({}), control: async () => ({}),
  });
  const server = await api.listen({ hostname: "127.0.0.1", port: 0 });
  assert.equal((await fetch(`${server.url}/healthz`)).status, 200);
  assert.equal((await fetch(`${server.url}/readyz`)).status, 503);
  ready = true;
  assert.equal((await fetch(`${server.url}/readyz`)).status, 200);
  await server.close();
  await assert.rejects(fetch(`${server.url}/healthz`));
});
