import assert from "node:assert/strict";
import { test } from "node:test";

import { PlatformObservability, REQUIRED_QUALITY_METRICS } from "../src/index.ts";

test("records complete quality metrics and privacy-safe correlated traces and audits", () => {
  const telemetry = new PlatformObservability();
  for (const metric of REQUIRED_QUALITY_METRICS) telemetry.observe(metric, { correct: 9, total: 10 });

  const trace = telemetry.trace({
    traceId: "trace:7",
    requestId: "request:7",
    principal: "user:7",
    operation: "RECONSTRUCT",
    startedAt: "2026-04-02T00:00:00Z",
    attributes: { domain: "personal", payload: "private diagnosis", authorization: "Bearer secret" },
  });
  trace.span({ name: "authority-evaluation", startedAt: "2026-04-02T00:00:01Z", endedAt: "2026-04-02T00:00:02Z", attributes: { selectedId: "decision:8", content: "secret meeting text" } });
  const completed = trace.end({ status: "ok", endedAt: "2026-04-02T00:00:03Z" });
  const audit = telemetry.audit({
    id: "audit:7",
    traceId: "trace:7",
    requestId: "request:7",
    principal: "user:7",
    decision: "allowed",
    stateChangeId: "lifecycle:7",
    reconstructionId: "reconstruction:7",
    recordedAt: "2026-04-02T00:00:03Z",
    detail: { reason: "verified", body: "sensitive user text" },
  });

  const snapshot = telemetry.snapshot();
  assert.deepEqual(snapshot.metrics.map((item) => item.name), [...REQUIRED_QUALITY_METRICS].sort());
  assert.equal(snapshot.metrics.every((item) => item.value === 0.9), true);
  assert.equal(completed.spans[0]?.name, "authority-evaluation");
  assert.equal(audit.traceId, completed.traceId);
  assert.equal(audit.requestId, completed.requestId);
  assert.equal(audit.principal, "user:7");
  assert.equal(audit.stateChangeId, "lifecycle:7");
  assert.equal(audit.reconstructionId, "reconstruction:7");
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /private diagnosis|Bearer secret|secret meeting text|sensitive user text/);
  assert.match(serialized, /\[REDACTED\]/);
});
