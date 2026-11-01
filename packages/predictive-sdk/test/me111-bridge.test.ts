/** ME111 adapter contract fixtures are constructed, not trained model evidence. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createClaim } from "../../core/src/index.ts";
import { CapabilityEngine, defineCapability } from "../../permissions/src/index.ts";
import { ClaimLedger } from "../../state/src/index.ts";
import type {
  PredictiveReadHost, PredictiveReadRequest,
} from "../../predictive-export/src/index.ts";
import {
  ME111_FROZEN_CONTRACT, predictMe111AuthorizedLocal,
  type Me111NativeLocalPort, type Me111SourceEvent,
} from "../src/me111-bridge.ts";

const START = "2013-03-01T00:00:00Z";
const KNOW = "2013-03-01T01:00:00Z";
const CUTOFF = "2013-03-01T02:00:00Z";

function features() {
  return {
    owner: 0,
    hour: 0,
    values: [0.125, ...Array<number>(12).fill(0)],
    observed: [true, ...Array<boolean>(12).fill(false)],
    ages: Array<number>(13).fill(0),
    clock: [0, 0, 0, 1, 1, 1],
  };
}

function setup(conflict = false) {
  const ledger = new ClaimLedger();
  const append = (id: string, level: number) => ledger.append(createClaim({
    id, subject: "entity:CONSTRUCTED-prsa-station",
    predicate: "prsa:hourly-input",
    object: { encodedEvent: features() },
    validTime: { from: START }, recordedAt: KNOW,
    confidence: 0.8, authority: { level, basis: "CONSTRUCTED fixture" },
    lifecycle: "verified",
  }));
  append("claim:fixture-one", 10);
  if (conflict) append("claim:fixture-two", 20);
  const capabilities = new CapabilityEngine();
  capabilities.register(defineCapability({
    id: "capability:CONSTRUCTED-me111", workspaceId: "workspace:constructed",
    principal: "principal:developer", principalKind: "human",
    issuer: "organization:lab",
    resourcePrefixes: ["workspace:constructed/me111"],
    graphTypes: ["graph:source"],
    entityIds: ["entity:CONSTRUCTED-prsa-station"],
    operations: ["READ", "RECONSTRUCT", "EXPORT"],
    purposes: ["predictive-research"], maxSensitivity: "internal",
    conditions: { deviceTrust: "managed" },
    validFrom: "2013-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z",
    delegation: { canDelegate: false, depth: 0, maxDepth: 0 },
  }));
  let selectedFeatures: ReturnType<typeof features> = features();
  const host: PredictiveReadHost = {
    ledger, capabilities, principal: "principal:developer",
    workspaceId: "workspace:constructed", purpose: "predictive-research",
    graphType: "graph:source", context: { deviceTrust: "managed" },
    accessAt: "2026-11-01T00:00:00Z", destination: "local-model",
    projectionResource() { return "workspace:constructed/me111"; },
    sourcePolicy(claim) {
      return {
        resourceId: "workspace:constructed/me111/" + claim.id,
        sensitivity: "internal" as const, availableAt: KNOW,
        locality: "local-only" as const, verifiedAiUse: true,
      };
    },
    featureProjection() { return selectedFeatures; },
  };
  const request: PredictiveReadRequest = {
    subject: "entity:CONSTRUCTED-prsa-station",
    predicate: "prsa:hourly-input", validAt: START,
    recordedAt: CUTOFF, predictionCutoff: CUTOFF,
    allowedFeatureNames: ["owner", "hour", "values", "observed", "ages", "clock"],
  };
  let nativeCalls = 0;
  const port: Me111NativeLocalPort = {
    execution: "DEVICE_LOCAL", remoteFallback: false,
    modelSha256: ME111_FROZEN_CONTRACT.modelSha256,
    checkpointSha256: ME111_FROZEN_CONTRACT.checkpointSha256,
    predictStep(event: Me111SourceEvent) {
      nativeCalls++;
      assert.equal(event.owner, 0);
      assert.equal(event.hour, 0);
      assert.equal(event.values[0], 0.125);
      assert.equal(Object.isFrozen(event.values), true);
      return {
        logLocation: [1, 2, 3, 4, 5, 6],
        leftScale: [1, 1, 1, 1, 1, 1],
        rightScale: [2, 2, 2, 2, 2, 2],
      };
    },
  };
  return {
    host, request, port, get nativeCalls() { return nativeCalls; },
    setFeatures(next: ReturnType<typeof features>) { selectedFeatures = next; },
  };
}

test("constructed source maps into original frozen ME111 13/6 contract", () => {
  const x = setup();
  const result = predictMe111AuthorizedLocal(x.host, x.request, x.port);
  assert.equal(result.status, "FORECAST");
  assert.equal(x.nativeCalls, 1);
  assert.equal(result.actionAuthority, "NOT_GRANTED");
  assert.equal(result.scientificQualification, "FAILED_MIXED_ME111");
  assert.equal(result.deviceQualification, "NOT_RUN");
  if (result.status !== "FORECAST") throw Error("fixture forecast required");
  assert.deepEqual(result.logLocation, [1, 2, 3, 4, 5, 6]);
  assert.equal(result.units, "STANDARDIZED_LOG1P_POLLUTANT");
  assert.equal(Object.isFrozen(result.logLocation), true);
  assert.equal(result.leftScale.length, 6);
});

test("source conflicting claims abstain before original native runner executes", () => {
  const x = setup(true);
  const result = predictMe111AuthorizedLocal(x.host, x.request, x.port);
  assert.equal(result.status, "ABSTAIN");
  if (result.status === "ABSTAIN") assert.equal(result.reason, "SOURCE_CONFLICT");
  assert.equal(x.nativeCalls, 0);
});

test("wrong checkpoint, wrong ONNX and remote fallback all reject before reading source", () => {
  const x = setup();
  const withTrap = { ...x.host, projectionResource(): never {
    throw Error("source read occurred before rejection");
  } };
  for (const invalid of [
    { ...x.port, execution: "REMOTE" as const },
    { ...x.port, remoteFallback: true },
    { ...x.port, modelSha256: "not-the-frozen-onnx" },
    { ...x.port, checkpointSha256: "not-original-checkpoint" },
  ]) {
    assert.throws(
      () => predictMe111AuthorizedLocal(withTrap, x.request, invalid),
      /frozen identity|no-fallback|device-local/,
    );
  }
});

test("actual Woyengi capability checks cannot be bypassed by model bridge", () => {
  const x = setup();
  assert.throws(() => predictMe111AuthorizedLocal({
    ...x.host, principal: "principal:untrusted",
  }, x.request, x.port), /denied/);
  assert.equal(x.nativeCalls, 0);
});

test("native interface rejects incomplete or future-label feature names before source access", () => {
  const x = setup();
  const withTrap = { ...x.host, projectionResource(): never {
    throw Error("unauthorized source read");
  } };
  for (const allowed of [
    ["owner", "hour"],
    ["owner", "hour", "values", "observed", "ages", "future_label"],
    ["owner", "hour", "values", "observed", "ages", "clock", "outcome"],
  ]) {
    assert.throws(
      () => predictMe111AuthorizedLocal(withTrap, {
        ...x.request, allowedFeatureNames: allowed,
      }, x.port),
      /exactly the native six features/,
    );
  }
});

test("native event rejects bad channel counts, bool mask, unseen values and ages", () => {
  const mutate = [
    (x: ReturnType<typeof features>) => { x.values.pop(); },
    (x: ReturnType<typeof features>) => { x.values[1] = 1; },
    (x: ReturnType<typeof features>) => { x.values[0] = Number.NaN; },
    (x: ReturnType<typeof features>) => { x.observed[0] = "true" as unknown as boolean; },
    (x: ReturnType<typeof features>) => { x.ages[0] = 1.1; },
    (x: ReturnType<typeof features>) => { x.clock = [0, 0, 0, 1]; },
    (x: ReturnType<typeof features>) => { x.owner = 12; },
    (x: ReturnType<typeof features>) => { x.hour = -1; },
  ];
  for (const corrupt of mutate) {
    const x = setup();
    const f = features();
    corrupt(f);
    x.setFeatures(f);
    assert.throws(() => predictMe111AuthorizedLocal(x.host, x.request, x.port));
    assert.equal(x.nativeCalls, 0);
  }
});

test("native output rejects incorrect shapes, nonpositive scales and hidden authority", () => {
  const x = setup();
  for (const invalid of [
    { logLocation: [1], leftScale: Array(6).fill(1), rightScale: Array(6).fill(1) },
    { logLocation: Array(6).fill(0), leftScale: Array(6).fill(0), rightScale: Array(6).fill(1) },
    { logLocation: Array(6).fill(0), leftScale: Array(6).fill(1), rightScale: Array(6).fill(-1) },
    { logLocation: Array(6).fill(Number.NaN), leftScale: Array(6).fill(1), rightScale: Array(6).fill(1) },
    { logLocation: Array(6).fill(0), leftScale: Array(6).fill(1), rightScale: Array(6).fill(1), authorizedEffect: true },
    Promise.resolve({ logLocation: [] }),
  ]) {
    assert.throws(() => predictMe111AuthorizedLocal(x.host, x.request, {
      ...x.port, predictStep() { return invalid; },
    }));
  }
});

test("source projection may not be mistaken for rights, trained quality or qualified device", () => {
  const x = setup();
  const before = JSON.stringify(x.host.ledger.canonicalRecords());
  const out = predictMe111AuthorizedLocal(x.host, x.request, x.port);
  assert.equal(JSON.stringify(x.host.ledger.canonicalRecords()), before);
  assert.equal(out.sourceQualification, "STRUCTURAL_EXPORT_ONLY");
  assert.equal(out.scientificQualification, "FAILED_MIXED_ME111");
  assert.equal(out.deviceQualification, "NOT_RUN");
});
