import { ADVERSARIAL_FIXTURES, ReferenceAdversarialSystem, runAdversarialBenchmarks } from "./index.ts";

const report = await runAdversarialBenchmarks(new ReferenceAdversarialSystem(), { minimumCorrectness: 1, maximumPermissionLeakageRate: 0 });
process.stdout.write(`${JSON.stringify({ ...report, fixtureCount: ADVERSARIAL_FIXTURES.length }, null, 2)}\n`);
