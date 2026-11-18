/** Constructed Woyengi claims → frozen ME111 local CPU inference and replay. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClaim, type StateValue } from "../../core/src/index.ts";
import { CapabilityEngine, defineCapability } from "../../permissions/src/index.ts";
import type {
  PredictiveReadHost, PredictiveReadRequest,
} from "../../predictive-export/src/index.ts";
import { ClaimLedger } from "../../state/src/index.ts";
import {
  ME111_FROZEN_CONTRACT, predictMe111AuthorizedLocal,
  type Me111NativeLocalPort, type Me111SourceEvent,
} from "../src/index.ts";

const [, , apk, python = "python3"] = process.argv;
if (!apk || process.argv.length > 4) {
  throw new Error("usage: node me111_host_quickstart.ts APK [PYTHON]");
}
const worker = fileURLToPath(new URL("./me111_host_runtime.py", import.meta.url));
const subject = "entity:constructed-me111";
const predicate = "prsa:hourly-input";
const resource = "workspace:demo/me111";
const cutoff = "2013-03-06T00:00:00Z";
const contract = ME111_FROZEN_CONTRACT;
const ledger = new ClaimLedger();
const capabilities = new CapabilityEngine();
capabilities.register(defineCapability({
  id: "capability:constructed-me111", workspaceId: "workspace:demo",
  principal: "principal:demo", principalKind: "human", issuer: "organization:demo",
  resourcePrefixes: [resource], graphTypes: ["graph:source"], entityIds: [subject],
  operations: ["READ", "RECONSTRUCT", "EXPORT"], purposes: ["predictive-research"],
  maxSensitivity: "internal", conditions: { deviceTrust: "managed" },
  validFrom: "2013-03-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z",
  delegation: { canDelegate: false, depth: 0, maxDepth: 0 },
}));

const host: PredictiveReadHost = {
  ledger, capabilities, principal: "principal:demo", workspaceId: "workspace:demo",
  purpose: "predictive-research", graphType: "graph:source",
  context: { deviceTrust: "managed" }, accessAt: "2026-11-04T00:00:00Z",
  destination: "local-model",
  projectionResource: () => resource,
  sourcePolicy: (claim) => ({
    resourceId: resource + "/" + claim.id, sensitivity: "internal",
    availableAt: claim.transactionTime.from, locality: "local-only", verifiedAiUse: true,
  }),
  featureProjection: (claim) => claim.object as Readonly<Record<string, StateValue>>,
};

const isoHour = (hour: number) => new Date(Date.UTC(2013, 2, 1, hour)).toISOString();
const request = (hour: number): PredictiveReadRequest => ({
  subject, predicate, validAt: isoHour(hour), recordedAt: cutoff, predictionCutoff: cutoff,
  allowedFeatureNames: ["owner", "hour", "values", "observed", "ages", "clock"],
});
function appendFixture(hour: number, value: number, suffix = "fixture") {
  ledger.append(createClaim({
    id: `claim:${suffix}-${hour}`, subject, predicate,
    object: {
      owner: 0, hour, values: [value, ...Array<number>(12).fill(0)],
      observed: [true, ...Array<boolean>(12).fill(false)],
      ages: Array<number>(13).fill(0), clock: Array<number>(6).fill(0),
    },
    validTime: { from: isoHour(hour), to: isoHour(hour + 1) },
    recordedAt: isoHour(hour + 1), confidence: 0.5,
    authority: { level: 10, basis: "constructed original PyTorch reference input" },
    lifecycle: "verified",
  }));
}

type Step = {
  forecast: unknown;
  state: { owner: number; last_hour: number; count: number[] };
  maxAbsError: { forecast: number; state: number };
};
let state: Step["state"] | null = null;
const steps: Step[] = [];
const port: Me111NativeLocalPort = {
  execution: "DEVICE_LOCAL", remoteFallback: false,
  modelSha256: contract.modelSha256, checkpointSha256: contract.checkpointSha256,
  predictStep(event: Me111SourceEvent) {
    const run = spawnSync(python, [
      "-I", worker, apk, contract.modelSha256, contract.checkpointSha256, contract.onnxRuntime,
    ], {
      input: JSON.stringify({ event, state }), encoding: "utf8",
      timeout: 30_000, maxBuffer: 64 * 1024,
    });
    if (run.error || run.status !== 0) {
      throw new Error(`local ME111 worker failed: ${run.error ?? run.stderr.trim()}`);
    }
    const step = JSON.parse(run.stdout) as Step;
    state = step.state;
    steps.push(step);
    return step.forecast;
  },
};

appendFixture(100, 0.05);
appendFixture(101, 0.10);
const before = JSON.stringify(ledger.canonicalRecords());
const forecasts = [100, 101].map((hour, index) => {
  const result = predictMe111AuthorizedLocal(host, request(hour), port);
  assert.equal(result.status, "FORECAST");
  assert.equal(result.actionAuthority, "NOT_GRANTED");
  const step = steps[index];
  assert.equal(step?.state.owner, 0);
  assert.equal(step?.state.last_hour, hour);
  assert.deepEqual(step?.state.count, [index + 1]);
  return { hour, ...result, maxAbsError: step.maxAbsError };
});
assert.equal(JSON.stringify(ledger.canonicalRecords()), before);

assert.throws(() => predictMe111AuthorizedLocal(
  { ...host, principal: "principal:untrusted" }, request(101), port,
), /denied/);
assert.throws(() => predictMe111AuthorizedLocal(
  host, request(101), { ...port, remoteFallback: true },
), /no-fallback/);
appendFixture(101, 0.25, "conflict");
const conflict = predictMe111AuthorizedLocal(host, request(101), port);
assert.equal(conflict.status, "ABSTAIN");
if (conflict.status === "ABSTAIN") assert.equal(conflict.reason, "SOURCE_CONFLICT");
assert.equal(steps.length, 2);

const apkHash = createHash("sha256");
for await (const chunk of createReadStream(apk)) apkHash.update(chunk);
process.stdout.write(JSON.stringify({
  schema: "woyengi.me111-host-demonstration.v1",
  data: "CONSTRUCTED_PYTORCH_REFERENCE",
  execution: "HOST_ONNX_CPU",
  runtime: contract.onnxRuntime,
  apkSha256: apkHash.digest("hex"),
  modelSha256: contract.modelSha256,
  checkpointSha256: contract.checkpointSha256,
  forecasts,
  stateReplay: "PASSED_ACROSS_TWO_LOCAL_RUNTIME_PROCESSES",
  cases: {
    conflict, unauthorizedSource: "DENIED", remoteFallback: "REJECTED",
    canonicalHistoryDuringPrediction: "UNCHANGED",
  },
  physicalDeviceQualification: "NOT_RUN",
  physicalNetworkTrace: "NOT_RUN",
}, null, 2) + "\n");
