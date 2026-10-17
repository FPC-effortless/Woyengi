import type { PackageCertificationResult } from "./index.ts";

export const WOYENGI_EVALUATED_SCOPE_CLAIMS = Object.freeze([
  "CONFORMANCE",
  "COMPATIBILITY",
  "REPLAY_EFFECT_CORRECTNESS",
  "TESTED_FAILURE_BEHAVIOR",
  "PACKAGE_RUNTIME_CERTIFICATION",
] as const);

export type WoyengiEvaluatedScopeClaim = (typeof WOYENGI_EVALUATED_SCOPE_CLAIMS)[number];

export interface WoyengiCertificationProvenance {
  readonly producer: "WOYENGI_EVALUATION";
  readonly sourceContract: "woyengi.package-certification.v1";
  readonly sourceCertificationId: string;
  readonly sourcePackageId: string;
  readonly evaluatedAt: string;
}

export interface WoyengiCertificationClaimBoundary {
  readonly contract: "woyengi.evaluation-claim-boundary.v1";
  readonly owner: "WOYENGI";
  readonly category: "RUNTIME_PACKAGE_CERTIFICATION";
  readonly allowedClaims: readonly WoyengiEvaluatedScopeClaim[];
  readonly scientificQualificationClaim: false;
  readonly frontierQualificationClaim: false;
  readonly productionReadyClaim: false;
  readonly semanticCommitAuthorityGranted: false;
  readonly semanticEffectsIssued: false;
  readonly externalEffectsIssued: false;
  readonly provenance: WoyengiCertificationProvenance;
  readonly limitations: readonly string[];
}

const FORBIDDEN_CROSS_PRODUCT_FIELDS = Object.freeze([
  "scientificQualificationClaim",
  "scientificQualification",
  "scientificallyQualified",
  "frontierQualificationClaim",
  "frontierQualification",
  "frontierQualified",
  "semanticCommitAuthorityGranted",
  "semanticCommitAuthority",
  "qualification",
] as const);

export function assertWoyengiPackageCertification(value: unknown): asserts value is PackageCertificationResult {
  if (!isRecord(value)) throw new TypeError("expected Woyengi package certification artifact");
  if (value.contract !== "woyengi.package-certification.v1") {
    throw new TypeError("expected Woyengi package certification contract woyengi.package-certification.v1");
  }
  if (typeof value.id !== "string" || !value.id.startsWith("package-certification:")) {
    throw new TypeError("Woyengi package certification requires a package-certification id");
  }
  if (typeof value.packageId !== "string" || !value.packageId.startsWith("application-package:")) {
    throw new TypeError("Woyengi package certification requires an application-package id");
  }
  if (value.decision !== "CERTIFIED_FOR_EVALUATED_SCOPE" && value.decision !== "NOT_CERTIFIED") {
    throw new TypeError(`invalid Woyengi package certification decision: ${String(value.decision)}`);
  }
  if (value.productionReadyClaim !== false) {
    throw new Error("forbidden Woyengi certification claim: productionReadyClaim");
  }
  for (const field of FORBIDDEN_CROSS_PRODUCT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`forbidden Woyengi certification claim: ${field}`);
    }
  }
  if (typeof value.evaluatedAt !== "string" || Number.isNaN(new Date(value.evaluatedAt).getTime())) {
    throw new TypeError("Woyengi package certification requires a valid evaluatedAt timestamp");
  }
}

export function certifyClaimBoundary(certification: unknown): WoyengiCertificationClaimBoundary {
  assertWoyengiPackageCertification(certification);
  return deepFreeze({
    contract: "woyengi.evaluation-claim-boundary.v1" as const,
    owner: "WOYENGI" as const,
    category: "RUNTIME_PACKAGE_CERTIFICATION" as const,
    allowedClaims: [...WOYENGI_EVALUATED_SCOPE_CLAIMS],
    scientificQualificationClaim: false as const,
    frontierQualificationClaim: false as const,
    productionReadyClaim: false as const,
    semanticCommitAuthorityGranted: false as const,
    semanticEffectsIssued: false as const,
    externalEffectsIssued: false as const,
    provenance: {
      producer: "WOYENGI_EVALUATION" as const,
      sourceContract: certification.contract,
      sourceCertificationId: certification.id,
      sourcePackageId: certification.packageId,
      evaluatedAt: certification.evaluatedAt,
    },
    limitations: [
      "Claims are limited to the evaluated package/runtime scope and supplied evidence.",
      "Woyengi certification does not imply Veritas scientific benchmark qualification.",
      "Woyengi certification does not imply Veritas frontier qualification.",
      "Woyengi certification does not imply production readiness.",
      "Evaluation success does not grant authority to create semantic commits or issue semantic/external effects.",
    ],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
