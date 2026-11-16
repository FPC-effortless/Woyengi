/** Woyengi real-code, constructed-record interop fixture for TAC-OSM CI.
 * Not a publisher event, not permission attestation, not a scored model forecast.
 */
import { writeFile } from "node:fs/promises";

import { createClaim } from "../../core/src/index.ts";
import { CapabilityEngine, defineCapability } from "../../permissions/src/index.ts";
import { ClaimLedger } from "../../state/src/index.ts";
import { exportPredictiveState } from "../src/index.ts";

if (process.argv.length !== 3) {
  throw new Error("usage: node generate-fixture.ts /tmp/constructed-woyengi-export.json");
}
const ledger = new ClaimLedger();
ledger.append(createClaim({
  id: "claim:fixture-first", subject: "entity:fixture-workflow", predicate: "workflow:owner",
  object: { owner: "entity:one" }, validTime: { from: "2026-02-01T00:00:00Z" },
  recordedAt: "2026-02-01T12:00:00Z", lifecycle: "verified",
  authority: { level: 30, basis: "constructed test only" }, confidence: .7,
}));
ledger.append(createClaim({
  id: "claim:fixture-second", subject: "entity:fixture-workflow", predicate: "workflow:owner",
  object: { owner: "entity:two" }, validTime: { from: "2026-02-04T00:00:00Z" },
  recordedAt: "2026-02-10T12:00:00Z", lifecycle: "verified",
  authority: { level: 60, basis: "constructed test only" }, confidence: .8,
}));
const caps = new CapabilityEngine();
caps.register(defineCapability({
  id: "capability:fixture-read", workspaceId: "workspace:fixture",
  principal: "principal:fixture-researcher", principalKind: "human",
  issuer: "organization:fixture",
  resourcePrefixes: ["workspace:fixture/workflow"], graphTypes: ["graph:operations"],
  entityIds: ["entity:fixture-workflow"], operations: ["READ", "EXPORT", "RECONSTRUCT"],
  purposes: ["model-interop-check"], maxSensitivity: "internal",
  conditions: { deviceTrust: "constructed" },
  validFrom: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z",
  delegation: { canDelegate: false, depth: 0, maxDepth: 0 },
}));
const exportRecord = exportPredictiveState({
  ledger, capabilities: caps, principal: "principal:fixture-researcher",
  workspaceId: "workspace:fixture", purpose: "model-interop-check",
  graphType: "graph:operations", context: { deviceTrust: "constructed" },
  accessAt: "2026-02-20T00:00:00Z", destination: "local-model",
  projectionResource() { return "workspace:fixture/workflow"; },
  sourcePolicy(claim) {
    return {
      resourceId: "workspace:fixture/workflow/claims/" + claim.id,
      sensitivity: "internal" as const, availableAt: claim.transactionTime.from,
      locality: "local-only" as const, verifiedAiUse: true, // synthetic fixture, NOT publisher clearance
    };
  },
  featureProjection(claim) {
    return { observed_owner: (claim.object as { readonly owner: string }).owner };
  },
}, {
  subject: "entity:fixture-workflow", predicate: "workflow:owner",
  validAt: "2026-02-05T00:00:00Z", recordedAt: "2026-02-15T00:00:00Z",
  predictionCutoff: "2026-02-15T00:00:00Z", allowedFeatureNames: ["observed_owner"],
});
if (exportRecord.observations.length !== 2 || exportRecord.conflictingClaimIds.length !== 1) {
  throw new Error("unexpected Woyengi fixture projection state");
}
await writeFile(process.argv[2]!, JSON.stringify(exportRecord, null, 2) + "\n", { flag: "wx" });
process.stdout.write("Constructed Woyengi export generated: software integration test ONLY; not source auth or model evidence\n");
