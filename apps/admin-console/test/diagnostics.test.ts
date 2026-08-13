import assert from "node:assert/strict";
import { test } from "node:test";

import { AdminDiagnostics } from "../src/index.ts";

test("aggregates redacted diagnostics and guards dangerous audited operations", async () => {
  const audits: unknown[] = [];
  const retried: string[] = [];
  const admin = new AdminDiagnostics({
    authorize: ({ principal, operation }) => ({ allowed: principal === "user:operator" && operation === "ADMIN", rationale: "operator role" }),
    inspect: async () => ({
      connectors: [{ id: "connector:crm", status: "healthy", cursor: "cursor:9", apiKey: "secret-value" }],
      policies: [{ id: "policy:default-deny", status: "active" }],
      verifiers: [{ id: "verifier:schema", status: "healthy" }],
      subscriptions: [{ id: "subscription:regulation", status: "lagging", authorization: "Bearer token" }],
      storage: [{ id: "storage:ledger", status: "healthy", detail: { password: "postgres" } }],
      failedJobs: [{ id: "job:7", status: "failed", error: "timeout", payload: { subject: "private medical detail" } }],
    }),
    retryJob: async (id) => { retried.push(id); },
    appendAudit: async (record) => { audits.push(record); },
  });

  const snapshot = await admin.snapshot({ principal: "user:operator", recordedAt: "2026-04-01T00:00:00Z" });
  assert.equal(snapshot.connectors[0]?.apiKey, "[REDACTED]");
  assert.equal(snapshot.subscriptions[0]?.authorization, "[REDACTED]");
  assert.deepEqual(snapshot.storage[0]?.detail, { password: "[REDACTED]" });
  assert.deepEqual(snapshot.failedJobs[0]?.payload, "[REDACTED]");

  await assert.rejects(
    admin.execute({ principal: "user:operator", operation: "retry-failed-job", targetId: "job:7", confirmation: "wrong", reason: "reprocess", recordedAt: "2026-04-01T00:01:00Z", requestId: "request:7" }),
    /confirmation token/i,
  );
  assert.deepEqual(retried, []);
  const result = await admin.execute({ principal: "user:operator", operation: "retry-failed-job", targetId: "job:7", confirmation: "RETRY job:7", reason: "reprocess", recordedAt: "2026-04-01T00:01:00Z", requestId: "request:7" });
  assert.equal(result.status, "executed");
  assert.deepEqual(retried, ["job:7"]);
  assert.deepEqual(audits, [result.audit]);
  assert.equal(result.audit.principal, "user:operator");
  assert.equal(result.audit.requestId, "request:7");

  await assert.rejects(admin.snapshot({ principal: "agent:unknown", recordedAt: "2026-04-01T00:00:00Z" }), /denied/i);
});
