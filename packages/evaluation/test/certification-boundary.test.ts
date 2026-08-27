import assert from "node:assert/strict";
import { test } from "node:test";

import {
  certifyClaimBoundary,
  assertWoyengiPackageCertification,
} from "../src/certification-boundary.ts";

function certification(overrides: Record<string, unknown> = {}): unknown {
  return {
    contract: "woyengi.package-certification.v1",
    id: "package-certification:repair-app-1",
    packageId: "application-package:repair-app",
    packageVersion: "1.2.0",
    traceIds: ["episode-evaluation-trace:repair-18"],
    conformanceCases: [],
    evidenceIds: [],
    failureInjectionResults: [],
    score: {
      passedConformanceCases: 1,
      totalConformanceCases: 1,
      safeFailureInjections: 1,
      totalFailureInjections: 1,
      value: 1,
      minimumRequired: 0.8,
    },
    decision: "CERTIFIED_FOR_EVALUATED_SCOPE",
    productionReadyClaim: false,
    limitations: ["evaluated scope only"],
    evaluatedAt: "2026-08-27T12:00:00.000Z",
    ...overrides,
  };
}

test("emits only Woyengi evaluated-scope claims with explicit cross-product non-implications", () => {
  const boundary = certifyClaimBoundary(certification());

  assert.equal(boundary.contract, "woyengi.evaluation-claim-boundary.v1");
  assert.equal(boundary.owner, "WOYENGI");
  assert.equal(boundary.category, "RUNTIME_PACKAGE_CERTIFICATION");
  assert.deepEqual(boundary.allowedClaims, [
    "CONFORMANCE",
    "COMPATIBILITY",
    "REPLAY_EFFECT_CORRECTNESS",
    "TESTED_FAILURE_BEHAVIOR",
    "PACKAGE_RUNTIME_CERTIFICATION",
  ]);
  assert.equal(boundary.scientificQualificationClaim, false);
  assert.equal(boundary.frontierQualificationClaim, false);
  assert.equal(boundary.productionReadyClaim, false);
  assert.equal(boundary.semanticCommitAuthorityGranted, false);
  assert.equal(boundary.semanticEffectsIssued, false);
  assert.equal(boundary.externalEffectsIssued, false);
  assert.deepEqual(boundary.provenance, {
    producer: "WOYENGI_EVALUATION",
    sourceContract: "woyengi.package-certification.v1",
    sourceCertificationId: "package-certification:repair-app-1",
    sourcePackageId: "application-package:repair-app",
    evaluatedAt: "2026-08-27T12:00:00.000Z",
  });
  assert.equal(Object.isFrozen(boundary), true);
  assert.equal(Object.isFrozen(boundary.provenance), true);
});

test("rejects scientific/frontier/production or semantic-authority claims smuggled into a certification artifact", () => {
  for (const [field, value] of [
    ["scientificQualificationClaim", true],
    ["frontierQualificationClaim", true],
    ["productionReadyClaim", true],
    ["semanticCommitAuthorityGranted", true],
  ] as const) {
    assert.throws(
      () => certifyClaimBoundary(certification({ [field]: value })),
      new RegExp(`forbidden Woyengi certification claim: ${field}`),
    );
  }
});

test("does not accept a Veritas qualification artifact as Woyengi package certification", () => {
  assert.throws(
    () => assertWoyengiPackageCertification({
      contract: "veritas.frontier-qualification.v1",
      id: "frontier-qualification:example",
      decision: "QUALIFIED",
      semanticCommitAuthorityGranted: true,
    }),
    /expected Woyengi package certification contract/,
  );
});

test("does not turn evaluated-scope certification into semantic commit authority even when traces reference a prior commit", () => {
  const boundary = certifyClaimBoundary(certification({
    semanticCommitId: "semantic-commit:repair-18",
    externalQualification: {
      contract: "veritas.scientific-qualification.v1",
      decision: "QUALIFIED",
    },
  }));

  assert.equal(boundary.semanticCommitAuthorityGranted, false);
  assert.equal(boundary.semanticEffectsIssued, false);
  assert.equal(boundary.externalEffectsIssued, false);
  assert.equal("semanticCommitId" in boundary, false);
  assert.equal("externalQualification" in boundary, false);
});
