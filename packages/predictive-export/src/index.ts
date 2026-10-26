import { createHash } from "node:crypto";

import type { ClaimRecord, StateValue } from "../../core/src/index.ts";
import { CapabilityEngine, type AuthorizationRequest, type Sensitivity } from "../../permissions/src/index.ts";
import { ClaimLedger } from "../../state/src/index.ts";

/**
 * Woyengi-owned, read-only predictive-model export boundary.
 * This is NOT an authenticated HTTP endpoint or independent rights verifier.
 * The trusted platform host supplies principal/purpose, capability registry,
 * source metadata, and a strict feature projection; untrusted clients cannot
 * construct these ports. Model confidence is never an authority grant.
 */
export interface PredictiveReadHost {
  readonly ledger: ClaimLedger;
  readonly capabilities: CapabilityEngine;
  readonly principal: string;
  readonly workspaceId: string;
  readonly purpose: string;
  readonly graphType: string;
  readonly context: Readonly<Record<string, string>>;
  readonly projectionResource: (subject: string, predicate: string) => string;
  readonly sourcePolicy: (claim: ClaimRecord) => {
    readonly resourceId: string;
    readonly sensitivity: Sensitivity;
    readonly availableAt: string;
    readonly locality: "local-only" | "cloud-allowed" | "cloud-required" | "ephemeral";
    readonly verifiedAiUse: boolean;
  };
  readonly featureProjection: (claim: ClaimRecord) => Readonly<Record<string, StateValue>>;
}

export interface PredictiveReadRequest {
  readonly subject: string;
  readonly predicate: string;
  readonly validAt: string;
  readonly recordedAt: string;
  readonly predictionCutoff: string;
  readonly allowedFeatureNames: readonly string[];
  readonly destination: "local-model" | "external-model";
}

export interface PredictiveReadExport {
  readonly kind: "PREDICTIVE_READ_EXPORT";
  readonly status: "ADVISORY_ONLY";
  readonly schemaVersion: 1;
  readonly subject: string;
  readonly predicate: string;
  readonly validAt: string;
  readonly recordedAt: string;
  readonly predictionCutoff: string;
  readonly selectedClaimId: string;
  readonly conflictingClaimIds: readonly string[];
  readonly observations: readonly {
    readonly claimId: string;
    readonly validFrom: string;
    readonly knownFrom: string;
    readonly sourceAvailableAt: string;
    readonly featureHash: string;
    readonly features: Readonly<Record<string, StateValue>>;
  }[];
  readonly qualification: "STRUCTURAL_EXPORT_ONLY";
  readonly publisherAuthenticity: "NOT_ATTESTED_BY_THIS_EXPORTER";
  readonly independentRewardVerification: "NOT_PERFORMED";
  readonly actionAuthority: "NOT_GRANTED";
}

const blocked = /(?:^|[^a-z0-9])(oracle|future|gold|target|outcome|reward|secret|password|token|credential|verifier|acceptance|authority|permission|hidden|label|test)(?:$|[^a-z0-9])/i;

function instant(value: string, name: string): number {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new Error(`${name}: timezone required`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${name}: invalid instant`);
  return time;
}

function assertFeature(value: StateValue, path: string, depth = 0): void {
  if (depth > 12) throw new Error("feature nesting exceeds limit");
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("nonfinite feature");
  }
  if (typeof value === "object" && value !== null) {
    if (Array.isArray(value)) {
      if (value.length > 1024) throw new Error("feature array exceeds limit");
      for (const item of value) assertFeature(item, path, depth + 1);
    } else {
      if (Object.keys(value).length > 100) throw new Error("too many feature keys");
      for (const [key, item] of Object.entries(value)) {
        if (!key || blocked.test(key)) throw new Error(`unsafe feature key at ${path}`);
        assertFeature(item, `${path}.${key}`, depth + 1);
      }
    }
  }
}

function assertGranted(host: PredictiveReadHost, args: {
  readonly resourceId: string;
  readonly entityId: string;
  readonly operation: "READ" | "RECONSTRUCT" | "EXPORT";
  readonly sensitivity: Sensitivity;
  readonly at: string;
}): void {
  const request: AuthorizationRequest = {
    principal: host.principal,
    resourceId: args.resourceId,
    graphType: host.graphType,
    entityId: args.entityId,
    operation: args.operation,
    purpose: host.purpose,
    sensitivity: args.sensitivity,
    context: host.context,
    workspaceContext: {
      workspaceId: host.workspaceId,
      principalId: host.principal,
    },
    at: args.at,
  };
  if (host.capabilities.authorize(request).allowed !== true) {
    throw new Error("predictive source export denied");
  }
}

function detachedFeatures(features: Readonly<Record<string, StateValue>>): Record<string, StateValue> {
  const serialized = JSON.stringify(features);
  if (serialized === undefined) throw new Error("invalid feature projection");
  const copy: unknown = JSON.parse(serialized);
  if (typeof copy !== "object" || copy === null || Array.isArray(copy)) {
    throw new Error("feature projection must be an object");
  }
  return copy as Record<string, StateValue>;
}

/** Does not write to ledger, run predictions, authorize effects, or access external sources. */
export function exportPredictiveState(host: PredictiveReadHost, request: PredictiveReadRequest): PredictiveReadExport {
  if (!host || !host.capabilities || !host.ledger ||
      typeof host.projectionResource !== "function" ||
      typeof host.sourcePolicy !== "function" ||
      typeof host.featureProjection !== "function") {
    throw new Error("trusted Woyengi host ports required");
  }
  const cutoff = instant(request.predictionCutoff, "predictionCutoff");
  const valid = instant(request.validAt, "validAt");
  const known = instant(request.recordedAt, "recordedAt");
  if (valid > cutoff || known > cutoff) throw new Error("future projection cutoff denied");
  if (!request.subject.startsWith("entity:") || !request.predicate.includes(":") ||
      !host.principal.startsWith("principal:") || !host.workspaceId.startsWith("workspace:") ||
      !host.purpose.trim() || !host.graphType.startsWith("graph:")) {
    throw new Error("invalid Woyengi principal or source query");
  }
  if (!Array.isArray(request.allowedFeatureNames) || request.allowedFeatureNames.length === 0 ||
      new Set(request.allowedFeatureNames).size !== request.allowedFeatureNames.length ||
      request.allowedFeatureNames.some((key) => !key || blocked.test(key))) {
    throw new Error("invalid allowlisted feature set");
  }
  if (request.destination !== "local-model" && request.destination !== "external-model") {
    throw new Error("unrecognized model destination");
  }
  const resourceId = host.projectionResource(request.subject, request.predicate);
  // Crucial: check both reconstruction and data export permission BEFORE touching source ledger.
  for (const operation of ["RECONSTRUCT", "EXPORT"] as const) {
    assertGranted(host, { resourceId, entityId: request.subject, operation,
                          sensitivity: "internal", at: request.recordedAt });
  }
  const view = host.ledger.projectAt({
    subject: request.subject, predicate: request.predicate,
    validAt: request.validAt, recordedAt: request.recordedAt,
  });
  if (!view.selected || view.candidates.length === 0) {
    throw new Error("no source-eligible selected state; defer");
  }
  const records = [...view.candidates].sort((a, b) => a.claim.id.localeCompare(b.claim.id));
  const allowed = new Map<string, PredictiveReadExport["observations"][number]>();
  for (const candidate of records) {
    const claim = candidate.claim;
    const source = host.sourcePolicy(claim);  // trusted host metadata, not model-supplied
    const available = instant(source.availableAt, "source availableAt");
    if (available > cutoff || instant(claim.transactionTime.from, "claim transactionTime") > known) {
      throw new Error("source was not available at prediction cutoff");
    }
    if (source.verifiedAiUse !== true || source.locality === "ephemeral" ||
        (request.destination === "external-model" && source.locality !== "cloud-allowed") ||
        (request.destination === "local-model" && source.locality === "cloud-required")) {
      throw new Error("source rights or locality do not permit model export");
    }
    // A grant on selected is insufficient: every opposing claim must separately pass.
    for (const operation of ["READ", "EXPORT"] as const) {
      assertGranted(host, {
        resourceId: source.resourceId,
        entityId: claim.subject,
        operation,
        sensitivity: source.sensitivity,
        at: request.recordedAt,
      });
    }
    const projected = detachedFeatures(host.featureProjection(claim));
    if (Object.keys(projected).length === 0 ||
        Object.keys(projected).some((key) => !request.allowedFeatureNames.includes(key))) {
      throw new Error("exported features outside explicit allowlist");
    }
    for (const [key, value] of Object.entries(projected)) {
      if (blocked.test(key)) throw new Error("unsafe feature key");
      assertFeature(value, key);
    }
    const canon = JSON.stringify(projected);
    const featureHash = createHash("sha256").update(canon).digest("hex");
    allowed.set(claim.id, Object.freeze({
      claimId: claim.id,
      validFrom: claim.validTime.from,
      knownFrom: claim.transactionTime.from,
      sourceAvailableAt: source.availableAt,
      featureHash,
      features: Object.freeze(projected),
    }));
  }
  const expectedConflictIds = view.conflicts.map((item) => item.claim.id).sort();
  if (!allowed.has(view.selected.claim.id) ||
      expectedConflictIds.some((id) => !allowed.has(id)) ||
      expectedConflictIds.some((id) => id === view.selected?.claim.id)) {
    throw new Error("source conflicts not fully represented");
  }
  return Object.freeze({
    kind: "PREDICTIVE_READ_EXPORT",
    schemaVersion: 1,
    status: "ADVISORY_ONLY",
    subject: request.subject,
    predicate: request.predicate,
    validAt: request.validAt,
    recordedAt: request.recordedAt,
    predictionCutoff: request.predictionCutoff,
    selectedClaimId: view.selected.claim.id,
    conflictingClaimIds: Object.freeze(expectedConflictIds),
    observations: Object.freeze([...allowed.values()]),
    qualification: "STRUCTURAL_EXPORT_ONLY",
    publisherAuthenticity: "NOT_ATTESTED_BY_THIS_EXPORTER",
    independentRewardVerification: "NOT_PERFORMED",
    actionAuthority: "NOT_GRANTED",
  });
}
