import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const example = fileURLToPath(new URL("../examples/constructed_quickstart.ts", import.meta.url));

function run() {
  const child = spawnSync(process.execPath, [example], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 128 * 1024,
  });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr.trim(), "");
  return { raw: child.stdout, report: JSON.parse(child.stdout) as Record<string, unknown> };
}

test("fresh-checkout constructed SDK demo is deterministic and fail-closed", () => {
  const a = run();
  const b = run();
  assert.equal(a.raw, b.raw);
  const report = a.report as {
    demo: string;
    execution: string;
    cases: {
      forecast: { status: string; value: number; horizonSeconds: number;
                  uncertaintyQualification: string; actionAuthority: string };
      conflict: { status: string; reason: string };
      unauthorizedSource: string;
      remoteFallback: string;
      canonicalHistory: string;
    };
    qualification: Record<string, string>;
  };
  assert.equal(report.demo, "WOYENGI_CONSTRUCTED_LOCAL_SDK");
  assert.equal(report.execution, "NODE_HOST_CONTRACT_ONLY");
  assert.deepEqual(report.cases.forecast, {
    status: "FORECAST", value: 13, horizonSeconds: 60,
    uncertaintyQualification: "UNCALIBRATED", actionAuthority: "NOT_GRANTED",
  });
  assert.deepEqual(report.cases.conflict, {
    status: "ABSTAIN", reason: "SOURCE_CONFLICT",
  });
  assert.equal(report.cases.unauthorizedSource, "DENIED");
  assert.equal(report.cases.remoteFallback, "REJECTED_BEFORE_SOURCE_ACCESS");
  assert.equal(report.cases.canonicalHistory, "UNCHANGED");
  assert.deepEqual(report.qualification, {
    data: "CONSTRUCTED_ONLY", source: "STRUCTURAL_EXPORT_ONLY",
    science: "NOT_QUALIFIED", device: "NOT_RUN",
    realCheckpoint: "NOT_RUN", networkTrace: "NOT_RUN",
  });
});
