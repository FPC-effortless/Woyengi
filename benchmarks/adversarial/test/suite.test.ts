import assert from "node:assert/strict";
import { test } from "node:test";

import { ADVERSARIAL_FIXTURES, BenchmarkGateError, ReferenceAdversarialSystem, runAdversarialBenchmarks } from "../src/index.ts";

test("covers every adversarial state class and gates correctness and permission leakage", async () => {
  assert.deepEqual(ADVERSARIAL_FIXTURES.map((item) => item.category).sort(), [
    "chronology-corruption",
    "contradictory-evidence",
    "future-state-leakage",
    "invalidated-source",
    "missing-evidence",
    "poisoned-agent-memory",
    "stale-state",
    "superseded-decision",
    "unauthorized-memory",
    "wrong-authority",
    "wrong-identity",
  ]);

  const report = await runAdversarialBenchmarks(new ReferenceAdversarialSystem(), { minimumCorrectness: 1, maximumPermissionLeakageRate: 0 });
  assert.equal(report.passed, true);
  assert.equal(report.correctness, 1);
  assert.equal(report.permissionLeakageRate, 0);
  assert.equal(report.cases.length, 11);

  await assert.rejects(
    runAdversarialBenchmarks({
      execute: async (fixture) => ({ selectedRecordIds: [], exposedRecordIds: fixture.forbiddenRecordIds }),
    }, { minimumCorrectness: 0.95, maximumPermissionLeakageRate: 0 }),
    (error: unknown) => error instanceof BenchmarkGateError && error.report.correctness === 0 && error.report.permissionLeakageRate > 0,
  );
});
