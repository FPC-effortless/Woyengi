import assert from "node:assert/strict";
import { test } from "node:test";

import { createClaim } from "../../core/src/index.ts";
import { CapabilityEngine, defineCapability } from "../../permissions/src/index.ts";
import { ClaimLedger } from "../../state/src/index.ts";
import {
  type PredictiveReadHost, type PredictiveReadRequest,
} from "../../predictive-export/src/index.ts";
import {
  predictAuthorizedLocal, type LocalAdvisoryRuntime,
} from "../src/index.ts";

function setup(conflict = false) {
  const ledger = new ClaimLedger();
  const makeClaim = (id: string, value: number, time: string, authority: number) => createClaim({
    id, subject: "entity:constructed-machine", predicate: "machine:measurement",
    object: { signal: value }, validTime: { from: "2026-01-01T00:00:00Z" },
    recordedAt: time, confidence: 0.5,
    authority: { level: authority, basis: "constructed fixture" }, lifecycle: "verified",
  });
  ledger.append(makeClaim("claim:one", 12, "2026-01-01T00:00:01Z", 10));
  if (conflict) ledger.append(makeClaim("claim:two", 13, "2026-01-01T00:00:02Z", 20));
  const engine = new CapabilityEngine();
  engine.register(defineCapability({
    id: "capability:constructed", workspaceId: "workspace:lab",
    principal: "principal:developer", principalKind: "human", issuer: "organization:lab",
    resourcePrefixes: ["workspace:lab/machine"],
    graphTypes: ["graph:machine"], entityIds: ["entity:constructed-machine"],
    operations: ["READ", "RECONSTRUCT", "EXPORT"], purposes: ["predictive-research"],
    maxSensitivity: "internal", conditions: { deviceTrust: "managed" },
    validFrom: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z",
    delegation: { canDelegate: false, depth: 0, maxDepth: 0 },
  }));
  const host: PredictiveReadHost = {
    ledger, capabilities: engine, principal: "principal:developer",
    workspaceId: "workspace:lab", purpose: "predictive-research",
    graphType: "graph:machine", context: { deviceTrust: "managed" },
    accessAt: "2026-01-05T00:00:00Z", destination: "local-model",
    projectionResource() { return "workspace:lab/machine"; },
    sourcePolicy(claim) {
      return {
        resourceId: "workspace:lab/machine/claims/" + claim.id,
        sensitivity: "internal" as const, availableAt: claim.transactionTime.from,
        locality: "local-only" as const, verifiedAiUse: true,
      };
    },
    featureProjection(claim) {
      return { signal: (claim.object as { readonly signal: number }).signal };
    },
  };
  const request: PredictiveReadRequest = {
    subject: "entity:constructed-machine", predicate: "machine:measurement",
    validAt: "2026-01-01T00:00:00Z", recordedAt: "2026-01-03T00:00:00Z",
    predictionCutoff: "2026-01-03T00:00:00Z", allowedFeatureNames: ["signal"],
  };
  const runtime: LocalAdvisoryRuntime = {
    execution: "DEVICE_LOCAL", remoteFallback: false, modelId: "CONSTRUCTED-rule",
    predict(source) {
      return {
        kind: "FORECAST", value: source.observations.length + 1,
        horizonSeconds: 60, uncertaintyScore: 0.75,
      };
    },
  };
  return { host, request, runtime, ledger };
}

test("constructed local runtime yields a typed, explicitly unqualified forecast", () => {
  const { host, request, runtime } = setup();
  const result = predictAuthorizedLocal(host, request, runtime);
  assert.equal(result.status, "FORECAST");
  assert.equal(result.actionAuthority, "NOT_GRANTED");
  assert.equal(result.scientificQualification, "NOT_QUALIFIED");
  assert.equal(result.sourceQualification, "STRUCTURAL_EXPORT_ONLY");
  assert.equal(result.modelId, "CONSTRUCTED-rule");
  if (result.status === "FORECAST") {
    assert.equal(result.uncertaintyQualification, "UNCALIBRATED");
    assert.equal(result.horizonSeconds, 60);
  }
  assert.equal("authorizedEffect" in result, false);
});

test("conflicting state forces abstention without running any model", () => {
  const { host, request, runtime } = setup(true);
  const unsafe = { ...runtime, predict(): never { throw new Error("must not execute"); } };
  const result = predictAuthorizedLocal(host, request, unsafe);
  assert.equal(result.status, "ABSTAIN");
  if (result.status === "ABSTAIN") assert.equal(result.reason, "SOURCE_CONFLICT");
});

test("model-requested abstention remains explicitly advisory", () => {
  const { host, request, runtime } = setup();
  const result = predictAuthorizedLocal(host, request, {
    ...runtime, predict() { return { kind: "ABSTAIN", reason: "MODEL_UNCERTAIN" }; },
  });
  assert.equal(result.status, "ABSTAIN");
  if (result.status === "ABSTAIN") assert.equal(result.reason, "MODEL_UNCERTAIN");
  assert.equal(result.actionAuthority, "NOT_GRANTED");
});

test("remote runtime is rejected before any source read", () => {
  const { host, request, runtime } = setup();
  const withTrap: PredictiveReadHost = {
    ...host, projectionResource(): never { throw new Error("source read attempted"); },
  };
  assert.throws(() => predictAuthorizedLocal(withTrap, request, {
    ...runtime, execution: "REMOTE",
  }), /device-local/);
});

test("hidden remote fallback is rejected before source access", () => {
  const { host, request, runtime } = setup();
  const withTrap: PredictiveReadHost = {
    ...host, projectionResource(): never { throw new Error("source read attempted"); },
  };
  assert.throws(() => predictAuthorizedLocal(withTrap, request, {
    ...runtime, remoteFallback: true,
  }), /no remote fallback/);
});

test("Woyengi denies an unauthorized principal even with a local runtime", () => {
  const { host, request, runtime } = setup();
  assert.throws(() => predictAuthorizedLocal({
    ...host, principal: "principal:untrusted",
  }, request, runtime), /denied/);
});

test("source host external-model destination fails closed", () => {
  const { host, request, runtime } = setup();
  assert.throws(() => predictAuthorizedLocal({
    ...host, destination: "external-model",
  }, request, runtime), /offline-only/);
});

test("untrusted model cannot smuggle effects, private labels or status into response", () => {
  const { host, request, runtime } = setup();
  for (const changed of [
    { kind: "FORECAST", value: 2, horizonSeconds: 1, uncertaintyScore: .5, action: "execute" },
    { kind: "FORECAST", value: 2, horizonSeconds: 1, uncertaintyScore: .5, qualified: true },
    { kind: "ABSTAIN", reason: "INSUFFICIENT_EVIDENCE", effect: "WRITE" },
    { kind: "ACTION", authorized: true },
  ]) {
    assert.throws(() => predictAuthorizedLocal(host, request, {
      ...runtime, predict() { return changed; },
    }));
  }
});

test("invalid numeric forecasts always fail closed", () => {
  const { host, request, runtime } = setup();
  for (const bad of [
    { kind: "FORECAST", value: NaN, horizonSeconds: 60, uncertaintyScore: .5 },
    { kind: "FORECAST", value: Infinity, horizonSeconds: 60, uncertaintyScore: .5 },
    { kind: "FORECAST", value: 2, horizonSeconds: 0, uncertaintyScore: .5 },
    { kind: "FORECAST", value: 2, horizonSeconds: 60, uncertaintyScore: -0.1 },
    { kind: "FORECAST", value: 2, horizonSeconds: 60, uncertaintyScore: 1.1 },
    { kind: "FORECAST", value: 2, horizonSeconds: "60", uncertaintyScore: .5 },
  ]) {
    assert.throws(() => predictAuthorizedLocal(host, request, {
      ...runtime, predict() { return bad; },
    }), /invalid finite/);
  }
});

test("asynchronous model promises are rejected, not awaited or treated as local", () => {
  const { host, request, runtime } = setup();
  assert.throws(() => predictAuthorizedLocal(host, request, {
    ...runtime, predict() { return Promise.resolve({ kind: "FORECAST" }); },
  }), /asynchronous/);
});

test("source ledger remains unchanged by advisory prediction", () => {
  const { host, request, runtime, ledger } = setup();
  const before = JSON.stringify(ledger.canonicalRecords());
  predictAuthorizedLocal(host, request, runtime);
  assert.equal(JSON.stringify(ledger.canonicalRecords()), before);
});

test("runtime cannot label itself local without a valid declaration", () => {
  const { host, request, runtime } = setup();
  assert.throws(() => predictAuthorizedLocal(host, request, {
    ...runtime, execution: "cloud" as "DEVICE_LOCAL",
  }), /device-local/);
});
