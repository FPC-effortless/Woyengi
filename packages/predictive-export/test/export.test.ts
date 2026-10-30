import assert from "node:assert/strict";
import { test } from "node:test";

import { createClaim, type ClaimRecord } from "../../core/src/index.ts";
import { CapabilityEngine, defineCapability } from "../../permissions/src/index.ts";
import { ClaimLedger } from "../../state/src/index.ts";
import { exportPredictiveState, type PredictiveReadHost, type PredictiveReadRequest } from "../src/index.ts";

const baseTime = "2026-02-15T00:00:00Z";

function newClaim(id: string, leader: string, recordedAt: string, level: number): ClaimRecord {
  return createClaim({
    id, subject: "entity:project-alpha", predicate: "project:lead",
    object: { leader },
    validTime: { from: "2026-02-01T00:00:00Z" }, recordedAt,
    confidence: .85, authority: { level, basis: "fixture evidence only" },
    lifecycle: "verified",
  });
}

function setup(options: {
  exportAllowed?: boolean; readAllowed?: boolean; principal?: string;
  purpose?: string; deniedRecord?: string;
  aiUse?: boolean; locality?: "local-only" | "cloud-allowed" | "cloud-required" | "ephemeral";
  availableAt?: string;
} = {}) {
  const ledger = new ClaimLedger();
  ledger.append(newClaim("claim:daniel", "entity:daniel", "2026-02-01T00:00:00Z", 30));
  ledger.append(newClaim("claim:priya", "entity:priya", "2026-02-10T00:00:00Z", 80));
  const engine = new CapabilityEngine();
  const operations: ("READ" | "RECONSTRUCT" | "EXPORT")[] =
    ["RECONSTRUCT", ...(options.readAllowed === false ? [] : ["READ"] as const),
      ...(options.exportAllowed === false ? [] : ["EXPORT"] as const)];
  engine.register(defineCapability({
    id: "capability:read-source", workspaceId: "workspace:lab",
    principal: "principal:scientist", principalKind: "human", issuer: "organization:lab",
    resourcePrefixes: ["workspace:lab/project-alpha"],
    graphTypes: ["graph:projects"], entityIds: ["entity:project-alpha"],
    operations, purposes: ["predictive-research"], maxSensitivity: "internal",
    conditions: { deviceTrust: "managed" },
    validFrom: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z",
    delegation: { canDelegate: false, depth: 0, maxDepth: 0 },
  }));
  const host: PredictiveReadHost = {
    ledger, capabilities: engine,
    principal: options.principal ?? "principal:scientist",
    workspaceId: "workspace:lab", purpose: options.purpose ?? "predictive-research",
    graphType: "graph:projects", context: { deviceTrust: "managed" },
    accessAt: "2026-02-20T00:00:00Z", destination: "local-model",
    projectionResource() { return "workspace:lab/project-alpha"; },
    sourcePolicy(claim) {
      return {
        resourceId: options.deniedRecord === claim.id
          ? "workspace:lab/denied" : "workspace:lab/project-alpha/claims/" + claim.id,
        sensitivity: "internal" as const,
        availableAt: options.availableAt ?? claim.transactionTime.from,
        locality: options.locality ?? "local-only",
        verifiedAiUse: options.aiUse ?? true,
      };
    },
    featureProjection(claim) { return { leader: (claim.object as { readonly leader: string }).leader }; },
  };
  const query: PredictiveReadRequest = {
    subject: "entity:project-alpha", predicate: "project:lead",
    validAt: "2026-02-05T00:00:00Z", recordedAt: baseTime,
    predictionCutoff: baseTime, allowedFeatureNames: ["leader"],
  };
  return { ledger, engine, host, query };
}

test("authorized native projection retains both historical candidates and conflicting leader", () => {
  const { host, query } = setup();
  const result = exportPredictiveState(host, query);
  assert.equal(result.selectedClaimId, "claim:priya");
  assert.deepEqual(result.conflictingClaimIds, ["claim:daniel"]);
  assert.equal(result.observations.length, 2);
  assert.equal(result.status, "ADVISORY_ONLY");
  assert.equal(result.actionAuthority, "NOT_GRANTED");
  assert.equal(result.independentRewardVerification, "NOT_PERFORMED");
  assert.equal(result.publisherAuthenticity, "NOT_ATTESTED_BY_THIS_EXPORTER");
  assert.equal(result.observations[0]?.features.leader, "entity:daniel");
  assert.match(result.observations[0]?.featureHash ?? "", /^[0-9a-f]{64}$/);
  assert.equal("authority" in result.observations[0]!, false);
});

test("source claims/history and projection records stay unchanged after read", () => {
  const { host, query, ledger } = setup();
  const before = JSON.stringify(ledger.canonicalRecords());
  exportPredictiveState(host, query);
  assert.equal(JSON.stringify(ledger.canonicalRecords()), before);
});

test("principal lacking capability cannot reconstruct/export", () => {
  const { host, query } = setup({ principal: "principal:stranger" });
  assert.throws(() => exportPredictiveState(host, query), /denied/);
});

test("different purpose cannot borrow grant", () => {
  const { host, query } = setup({ purpose: "advertising" });
  assert.throws(() => exportPredictiveState(host, query), /denied/);
});

test("missing EXPORT capability fails closed", () => {
  const { host, query } = setup({ exportAllowed: false });
  assert.throws(() => exportPredictiveState(host, query), /denied/);
});

test("missing READ capability on candidates fails closed", () => {
  const { host, query } = setup({ readAllowed: false });
  assert.throws(() => exportPredictiveState(host, query), /denied/);
});

test("unauthorized conflicting claim denies the WHOLE export", () => {
  const { host, query } = setup({ deniedRecord: "claim:daniel" });
  assert.throws(() => exportPredictiveState(host, query), /denied/);
});

test("read revocation invalidates source export", () => {
  const { host, query, engine } = setup();
  engine.revoke({ capabilityId: "capability:read-source", revokedAt: "2026-02-12T00:00:00Z" });
  assert.throws(() => exportPredictiveState(host, query), /denied/);
});

test("knowledge cutoff refuses future projection", () => {
  const { host, query } = setup();
  assert.throws(() => exportPredictiveState(host, {
    ...query, predictionCutoff: "2026-02-05T00:00:00Z",
  }), /future projection cutoff/);
});

test("a later recorded leader is not leaked to earlier as-known-at", () => {
  const { host, query } = setup();
  const earlier = exportPredictiveState(host, {
    ...query, recordedAt: "2026-02-05T00:00:00Z",
    predictionCutoff: "2026-02-05T00:00:00Z",
  });
  assert.equal(earlier.observations.length, 1);
  assert.equal(earlier.selectedClaimId, "claim:daniel");
  assert.deepEqual(earlier.conflictingClaimIds, []);
});

test("source availability later than forecast cutoff is denied", () => {
  const { host, query } = setup({ availableAt: "2026-02-16T00:00:00Z" });
  assert.throws(() => exportPredictiveState(host, query), /not available/);
});

test("AI-use rights must be affirmed by source steward", () => {
  const { host, query } = setup({ aiUse: false });
  assert.throws(() => exportPredictiveState(host, query), /rights|locality/);
});

test("local-only data cannot leave through external model", () => {
  const { host, query } = setup({ locality: "local-only" });
  assert.throws(() => exportPredictiveState({ ...host, destination: "external-model" }, query), /offline customer inference|remote model export denied/);
});

test("ephemeral data cannot be exported", () => {
  const { host, query } = setup({ locality: "ephemeral" });
  assert.throws(() => exportPredictiveState(host, query), /rights|locality/);
});

test("cloud-required data cannot enter local model", () => {
  const { host, query } = setup({ locality: "cloud-required" });
  assert.throws(() => exportPredictiveState(host, query), /rights|locality/);
});

test("cloud-allowed source rights never authorize external customer inference", () => {
  const { host, query } = setup({ locality: "cloud-allowed" });
  assert.throws(
    () => exportPredictiveState({ ...host, destination: "external-model" }, query),
    /offline customer inference|remote model export denied/,
  );
  // Source rights that permit cloud processing are not a requirement to use cloud.
  const local = exportPredictiveState(host, query);
  assert.equal(local.status, "ADVISORY_ONLY");
  assert.equal(local.actionAuthority, "NOT_GRANTED");
});

test("unknown source locality and remote destination fail closed independently", () => {
  const { host, query } = setup();
  const malformed: PredictiveReadHost = {
    ...host, sourcePolicy(claim) {
      return {
        resourceId: "workspace:lab/project-alpha/claims/" + claim.id,
        sensitivity: "internal" as const, availableAt: claim.transactionTime.from,
        locality: "some-other-locality" as "local-only",
        verifiedAiUse: true,
      };
    },
  };
  assert.throws(() => exportPredictiveState(malformed, query), /rights or locality/);
  assert.throws(
    () => exportPredictiveState({ ...malformed, destination: "external-model" }, query),
    /offline customer inference|remote model export denied/,
  );
});

test("feature projection cannot expose hidden outcome or reward", () => {
  const { host, query } = setup();
  const altered: PredictiveReadHost = {
    ...host, featureProjection() { return { future_label: "leak" }; },
  };
  assert.throws(() => exportPredictiveState(altered, {
    ...query, allowedFeatureNames: ["future_label"],
  }), /allowlisted|unsafe|invalid/);
});

test("feature mapper may not reveal additional non-allowlisted fields", () => {
  const { host, query } = setup();
  const altered: PredictiveReadHost = {
    ...host, featureProjection() { return { leader: "entity:daniel", private_email: "fake@example" }; },
  };
  assert.throws(() => exportPredictiveState(altered, query), /outside explicit allowlist/);
});

test("NaN and infinity are rejected at model boundary", () => {
  const { host, query } = setup();
  const altered: PredictiveReadHost = { ...host, featureProjection() { return { leader: Number.NaN }; } };
  assert.throws(() => exportPredictiveState(altered, query), /nonfinite|invalid/);
});



test("cannot advance model data cutoff beyond the actual trusted read time", () => {
  const { host, query } = setup();
  assert.throws(() => exportPredictiveState(host, {
    ...query, validAt: "2026-02-20T00:00:00Z",
    recordedAt: "2026-02-21T00:00:00Z",
    predictionCutoff: "2026-02-21T00:00:00Z",
  }), /future projection cutoff/);
});

test("a historical source projection cannot resurrect a permission revoked before present access", () => {
  const { host, query, engine } = setup();
  engine.revoke({ capabilityId: "capability:read-source", revokedAt: "2026-02-17T00:00:00Z" });
  // The data cutoff precedes revocation, but Woyengi checks the trusted access time (Feb 20).
  assert.throws(() => exportPredictiveState(host, query), /denied/);
});

test("expired capability cannot authorize an older as-of projection", () => {
  const { host, query } = setup();
  assert.throws(() => exportPredictiveState({
    ...host, accessAt: "2027-02-01T00:00:00Z",
  }, query), /denied/);
});

test("caller-provided egress destination cannot override trusted host", () => {
  const { host, query } = setup({ locality: "local-only" });
  assert.throws(() => exportPredictiveState({
    ...host, destination: "external-model",
  }, { ...query, destination: "local-model" } as PredictiveReadRequest), /offline customer inference|remote model export denied/);
});

test("a crossed workspace scope cannot export", () => {
  const { host, query } = setup();
  const altered: PredictiveReadHost = { ...host, workspaceId: "workspace:outsider" };
  assert.throws(() => exportPredictiveState(altered, query), /denied/);
});
