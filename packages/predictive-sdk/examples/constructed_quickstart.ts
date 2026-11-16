/**
 * Constructed-only, zero-install developer smoke demo.
 * Uses the real Woyengi source ledger, capability checks and advisory SDK,
 * but a fake arithmetic rule: NOT a neural checkpoint or device qualification.
 */
import assert from "node:assert/strict";

import { createClaim } from "../../core/src/index.ts";
import { CapabilityEngine, defineCapability } from "../../permissions/src/index.ts";
import { ClaimLedger } from "../../state/src/index.ts";
import type {
  PredictiveReadHost, PredictiveReadRequest,
} from "../../predictive-export/src/index.ts";
import {
  predictAuthorizedLocal, type LocalAdvisoryRuntime,
} from "../src/index.ts";

function fixture(conflict: boolean): {
  host: PredictiveReadHost;
  request: PredictiveReadRequest;
  runtime: LocalAdvisoryRuntime;
  ledger: ClaimLedger;
} {
  const ledger = new ClaimLedger();
  const claim = (id: string, signal: number, recordedAt: string, level: number) =>
    createClaim({
      id, subject: "entity:constructed-machine", predicate: "machine:measurement",
      object: { signal },
      validTime: { from: "2026-01-01T00:00:00Z" },
      recordedAt, confidence: 0.5,
      authority: { level, basis: "constructed smoke demo" },
      lifecycle: "verified",
    });
  ledger.append(claim("claim:constructed-a", 12, "2026-01-01T00:00:01Z", 10));
  if (conflict) {
    ledger.append(claim("claim:constructed-b", 13, "2026-01-01T00:00:02Z", 20));
  }

  const capabilities = new CapabilityEngine();
  capabilities.register(defineCapability({
    id: "capability:constructed-smoke", workspaceId: "workspace:demo",
    principal: "principal:demo", principalKind: "human", issuer: "organization:demo",
    resourcePrefixes: ["workspace:demo/machine"],
    graphTypes: ["graph:machine"], entityIds: ["entity:constructed-machine"],
    operations: ["READ", "RECONSTRUCT", "EXPORT"],
    purposes: ["predictive-research"], maxSensitivity: "internal",
    conditions: { deviceTrust: "managed" },
    validFrom: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z",
    delegation: { canDelegate: false, depth: 0, maxDepth: 0 },
  }));

  const host: PredictiveReadHost = {
    ledger, capabilities, principal: "principal:demo",
    workspaceId: "workspace:demo", purpose: "predictive-research",
    graphType: "graph:machine", context: { deviceTrust: "managed" },
    accessAt: "2026-01-05T00:00:00Z", destination: "local-model",
    projectionResource() { return "workspace:demo/machine"; },
    sourcePolicy(record) {
      return {
        resourceId: "workspace:demo/machine/claims/" + record.id,
        sensitivity: "internal" as const,
        availableAt: record.transactionTime.from,
        locality: "local-only" as const,
        verifiedAiUse: true,
      };
    },
    featureProjection(record) {
      return { signal: (record.object as { readonly signal: number }).signal };
    },
  };
  const request: PredictiveReadRequest = {
    subject: "entity:constructed-machine", predicate: "machine:measurement",
    validAt: "2026-01-01T00:00:00Z",
    recordedAt: "2026-01-03T00:00:00Z",
    predictionCutoff: "2026-01-03T00:00:00Z",
    allowedFeatureNames: ["signal"],
  };
  const runtime: LocalAdvisoryRuntime = {
    execution: "DEVICE_LOCAL", remoteFallback: false,
    modelId: "CONSTRUCTED-ARITHMETIC-NOT-A-MODEL",
    predict(source) {
      const selected = source.observations.find(
        (row) => row.claimId === source.selectedClaimId,
      );
      const signal = selected?.features.signal;
      if (typeof signal !== "number") {
        return { kind: "ABSTAIN", reason: "INSUFFICIENT_EVIDENCE" };
      }
      return {
        kind: "FORECAST", value: signal + 1,
        horizonSeconds: 60, uncertaintyScore: 0.5,
      };
    },
  };
  return { host, request, runtime, ledger };
}

const first = fixture(false);
const before = JSON.stringify(first.ledger.canonicalRecords());
const forecast = predictAuthorizedLocal(first.host, first.request, first.runtime);
assert.equal(forecast.status, "FORECAST");
if (forecast.status !== "FORECAST") throw new Error("expected forecast");
assert.equal(forecast.value, 13);
assert.equal(forecast.actionAuthority, "NOT_GRANTED");
assert.equal(JSON.stringify(first.ledger.canonicalRecords()), before);

const second = fixture(true);
const conflict = predictAuthorizedLocal(second.host, second.request, {
  ...second.runtime,
  predict(): never { throw new Error("model must not execute on conflicting claims"); },
});
assert.equal(conflict.status, "ABSTAIN");
if (conflict.status !== "ABSTAIN") throw new Error("expected abstention");
assert.equal(conflict.reason, "SOURCE_CONFLICT");

assert.throws(() => predictAuthorizedLocal(
  { ...first.host, principal: "principal:untrusted" },
  first.request, first.runtime,
), /denied/);
assert.throws(() => predictAuthorizedLocal(
  {
    ...first.host,
    projectionResource(): never { throw new Error("SOURCE_READ_OCCURRED"); },
  },
  first.request,
  { ...first.runtime, remoteFallback: true },
), /no remote fallback/);

process.stdout.write(JSON.stringify({
  demo: "WOYENGI_CONSTRUCTED_LOCAL_SDK",
  execution: "NODE_HOST_CONTRACT_ONLY",
  cases: {
    forecast: {
      status: forecast.status, value: forecast.value,
      horizonSeconds: forecast.horizonSeconds,
      uncertaintyQualification: forecast.uncertaintyQualification,
      actionAuthority: forecast.actionAuthority,
    },
    conflict: { status: conflict.status, reason: conflict.reason },
    unauthorizedSource: "DENIED",
    remoteFallback: "REJECTED_BEFORE_SOURCE_ACCESS",
    canonicalHistory: "UNCHANGED",
  },
  qualification: {
    data: "CONSTRUCTED_ONLY",
    source: "STRUCTURAL_EXPORT_ONLY",
    science: "NOT_QUALIFIED",
    device: "NOT_RUN",
    realCheckpoint: "NOT_RUN",
    networkTrace: "NOT_RUN",
  },
}) + "\n");
