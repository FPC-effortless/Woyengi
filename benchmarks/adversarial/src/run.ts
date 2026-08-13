import { ADVERSARIAL_FIXTURES, runAdversarialBenchmarks } from "./index.ts";

const report = await runAdversarialBenchmarks({
  execute: async (fixture) => ({ selectedRecordIds: fixture.oracle.selectedRecordIds, exposedRecordIds: fixture.oracle.selectedRecordIds }),
}, { minimumCorrectness: 1, maximumPermissionLeakageRate: 0 });
process.stdout.write(`${JSON.stringify({ ...report, fixtureCount: ADVERSARIAL_FIXTURES.length }, null, 2)}\n`);
