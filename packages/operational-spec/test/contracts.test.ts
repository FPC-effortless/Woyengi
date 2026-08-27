import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compileOperationalIR,
  defineComprehensionModel,
  defineOperationalSystemSpec,
  defineOutcomeContract,
  defineWorldBundle,
  serializeOperationalSystemSpec,
} from "../src/index.ts";

const recordedAt = "2026-08-27T10:00:00Z";
const validFrom = "2026-08-27T00:00:00Z";

test("defines immutable provider-neutral operational contracts and compiles deterministic IR", () => {
  const comprehension = defineComprehensionModel({
    id: "comprehension:supplier-onboarding:v1",
    version: "0.1.0",
    workspaceId: "workspace:acme",
    objective: "Onboard suppliers with finance approval before activation",
    actors: ["principal:finance", "principal:operator"],
    subjects: ["supplier", "approval"],
    relevantStateRefs: ["claim:supplier-policy", "entity:supplier-42"],
    historyRefs: ["event:supplier-requested"],
    requirements: ["capture supplier record", "obtain finance approval"],
    constraints: ["supplier cannot activate before approval"],
    invariants: ["activation requires approved finance decision"],
    rationale: ["supplier activation changes operational access"],
    assumptions: [{
      id: "assumption:finance-is-decision-authority",
      statement: "Finance is the decision authority for supplier activation",
      confidence: 0.7,
      evidenceRefs: ["evidence:policy-draft"],
    }],
    unknowns: [{ id: "unknown:rejection-path", question: "What follows a rejected supplier?", blocking: false }],
    conflicts: [{
      id: "conflict:approval-owner",
      description: "Two sources disagree on approval ownership",
      candidateRefs: ["claim:policy-finance", "claim:policy-procurement"],
    }],
    evidenceRefs: ["evidence:policy-draft"],
    provenanceRefs: ["observation:user-intent", "reconstruction:workspace-1"],
    validTime: { from: validFrom },
    recordedAt,
  });

  const outcome = defineOutcomeContract({
    id: "outcome-contract:supplier-activated",
    version: "0.1.0",
    objective: "Supplier is activated only after an authorized finance approval",
    successAssertions: [
      { id: "outcome-assertion:supplier-active", description: "supplier status is active" },
      { id: "outcome-assertion:approval-recorded", description: "authorized finance approval is recorded" },
    ],
    invariants: ["activation must never precede approval"],
    requiredEvidenceRefs: ["evidence:approval-decision"],
    verificationRequirements: ["verify supplier state", "verify approval authority"],
    effectConstraints: [
      { effectClass: "SEMANTIC", policy: "ALLOW" },
      { effectClass: "EXTERNAL", policy: "REQUIRE_RECONCILIATION" },
    ],
    budget: { maximumCost: 20, currency: "USD", maximumAttempts: 3 },
    termination: { mode: "VERIFIED_OR_REVIEW", reviewRequiredOnInconclusive: true },
    acceptanceAuthorityRequirements: ["role:finance-approver"],
  });

  const rawSpec = {
    id: "operational-system-spec:supplier-onboarding",
    version: "0.1.0",
    workspaceId: "workspace:acme",
    comprehensionRef: comprehension.id,
    goals: ["supplier activation is controlled", "supplier records are complete"],
    requirements: [
      { id: "operational-requirement:approval", kind: "AUTHORITY", statement: "authorized finance approval is required", providerNeutral: true as const },
      { id: "operational-requirement:record", kind: "STATE", statement: "supplier record exists", providerNeutral: true as const },
    ],
    invariants: [
      { id: "operational-invariant:approval-first", statement: "activation must follow approval", severity: "CRITICAL" as const },
    ],
    actors: [
      { id: "operational-actor:finance", role: "finance-approver", principalRefs: ["principal:finance"] },
      { id: "operational-actor:operator", role: "supplier-operator", principalRefs: ["principal:operator"] },
    ],
    capabilities: [
      { id: "operational-capability:approval-request", requirement: "request approval", providerNeutral: true as const },
      { id: "operational-capability:records-write", requirement: "write supplier state", providerNeutral: true as const },
    ],
    authorityRequirements: [
      { id: "authority-requirement:activate", operation: "supplier.activate", requirement: "finance approval authority" },
    ],
    procedures: [{
      id: "operational-procedure:onboard-supplier",
      name: "Onboard supplier",
      capabilityRefs: ["operational-capability:records-write", "operational-capability:approval-request"],
      outcomeContractRefs: [outcome.id],
      steps: ["capture supplier", "request finance approval", "activate after verified approval"],
    }],
    outcomeContracts: [outcome],
    epistemicState: {
      assumptionRefs: ["assumption:finance-is-decision-authority"],
      unknownRefs: ["unknown:rejection-path"],
      conflictRefs: ["conflict:approval-owner"],
    },
    externalSystemBindings: [{
      id: "external-binding:supplier-system",
      purpose: "persist supplier operational state",
      capabilityRefs: ["operational-capability:records-write"],
      providerNeutral: true as const,
    }],
    resources: [{ id: "operational-resource:supplier", kind: "SEMANTIC_OBJECT" as const, reference: "entity:supplier-42" }],
    attentionRules: [{ id: "attention-rule:approval-needed", trigger: "supplier pending approval", requiredAction: "request approval" }],
    lifecycleRules: [{ id: "lifecycle-rule:supplier", from: "pending", to: "active", condition: "verified finance approval" }],
    projectionRequirements: [{ id: "projection-requirement:workspace", projectionKind: "APP" as const, requirement: "render supplier status and approval state", outcomeContractRefs: [outcome.id] }],
    provenanceRefs: [comprehension.id, "evidence:policy-draft"],
    validTime: { from: validFrom },
    recordedAt,
  };

  const first = defineOperationalSystemSpec(rawSpec);
  const second = defineOperationalSystemSpec({
    ...rawSpec,
    goals: [...rawSpec.goals].reverse(),
    capabilities: [...rawSpec.capabilities].reverse(),
    procedures: rawSpec.procedures.map((procedure) => ({ ...procedure, capabilityRefs: [...procedure.capabilityRefs].reverse() })),
  });

  assert.equal(first.contract, "woyengi.operational-system-spec.v0.1");
  assert.equal(first.comprehensionRef, comprehension.id);
  assert.deepEqual(first, second);
  assert.equal(serializeOperationalSystemSpec(first), serializeOperationalSystemSpec(second));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.outcomeContracts[0]), true);
  assert.equal(Object.isFrozen(comprehension), true);
  assert.equal(Object.isFrozen(outcome), true);

  const irFirst = compileOperationalIR(first, { compilerVersion: "0.1.0" });
  const irSecond = compileOperationalIR(second, { compilerVersion: "0.1.0" });
  assert.deepEqual(irFirst, irSecond);
  assert.equal(irFirst.contract, "woyengi.operational-ir.v0.1");
  assert.equal(irFirst.sourceSpecRef, first.id);
  assert.deepEqual(irFirst.outcomeContractRefs, [outcome.id]);
  assert.deepEqual(irFirst.capabilityRequirementRefs, [
    "operational-capability:approval-request",
    "operational-capability:records-write",
  ]);
  assert.equal(Object.isFrozen(irFirst), true);
});

test("rejects dangling references, duplicate identities, and malformed temporal/confidence data", () => {
  const outcome = defineOutcomeContract({
    id: "outcome-contract:verified",
    version: "0.1.0",
    objective: "verified result",
    successAssertions: [{ id: "outcome-assertion:verified", description: "result is verified" }],
    invariants: [],
    requiredEvidenceRefs: [],
    verificationRequirements: ["independent verification"],
    effectConstraints: [],
    acceptanceAuthorityRequirements: ["role:reviewer"],
  });

  assert.throws(() => defineComprehensionModel({
    id: "comprehension:bad-confidence",
    version: "0.1.0",
    workspaceId: "workspace:acme",
    objective: "bad",
    actors: [], subjects: [], relevantStateRefs: [], historyRefs: [], requirements: [], constraints: [], invariants: [], rationale: [],
    assumptions: [{ id: "assumption:bad", statement: "bad", confidence: 1.2, evidenceRefs: [] }],
    unknowns: [], conflicts: [], evidenceRefs: [], provenanceRefs: [], validTime: { from: validFrom }, recordedAt,
  }), /confidence/i);

  const base = {
    id: "operational-system-spec:bad",
    version: "0.1.0",
    workspaceId: "workspace:acme",
    comprehensionRef: "comprehension:one",
    goals: ["goal"],
    requirements: [{ id: "operational-requirement:one", kind: "STATE" as const, statement: "state", providerNeutral: true as const }],
    invariants: [],
    actors: [],
    capabilities: [{ id: "operational-capability:one", requirement: "capability", providerNeutral: true as const }],
    authorityRequirements: [],
    procedures: [{ id: "operational-procedure:one", name: "procedure", capabilityRefs: ["operational-capability:missing"], outcomeContractRefs: [outcome.id], steps: ["step"] }],
    outcomeContracts: [outcome],
    epistemicState: { assumptionRefs: [], unknownRefs: [], conflictRefs: [] },
    externalSystemBindings: [],
    resources: [], attentionRules: [], lifecycleRules: [], projectionRequirements: [], provenanceRefs: ["comprehension:one"], validTime: { from: validFrom }, recordedAt,
  };

  assert.throws(() => defineOperationalSystemSpec(base), /unknown capability reference/i);
  assert.throws(() => defineOperationalSystemSpec({
    ...base,
    procedures: [],
    capabilities: [base.capabilities[0], base.capabilities[0]],
  }), /duplicate operational capability id/i);

  assert.throws(() => defineOperationalSystemSpec({
    ...base,
    procedures: [],
    validTime: { from: "not-a-timestamp" },
  }), /timestamp/i);
});

test("WorldBundle keeps public and evaluator-private partitions structurally distinct", () => {
  const bundle = defineWorldBundle({
    id: "world-bundle:supplier-onboarding:1",
    version: "0.1.0",
    sourceSpecRef: "operational-system-spec:supplier-onboarding",
    sourceSpecVersion: "0.1.0",
    compatibility: { minimumRuntimeVersion: "0.1.0" },
    public: {
      objective: "activate a supplier safely",
      actorRoles: ["supplier-operator"],
      actionSurface: [{ id: "world-action:request-approval", name: "request_approval", kind: "WRITE" }],
      observationRefs: ["observation:supplier-public"],
      assetDescriptors: [],
      outcomeContractRefs: ["outcome-contract:supplier-activated"],
      provenanceRefs: ["operational-system-spec:supplier-onboarding"],
    },
    privateEvaluator: {
      targetAssertionRefs: ["private-assertion:supplier-active"],
      invariantRefs: ["private-invariant:approval-first"],
      hiddenEffectRefs: ["private-effect:approval-transition"],
      evidenceLocatorRefs: ["private-evidence:approval-ledger"],
    },
    partitionManifest: [
      { id: "world-member:public-task", partition: "public", kind: "TASK" },
      { id: "world-member:private-oracle", partition: "private-evaluator", kind: "ORACLE" },
    ],
    provenanceRefs: ["operational-system-spec:supplier-onboarding"],
  });

  assert.equal(bundle.contract, "woyengi.world-bundle.v0.1");
  assert.equal(bundle.partitionManifest[0]?.partition, "private-evaluator");
  assert.equal(bundle.partitionManifest[1]?.partition, "public");
  assert.equal(Object.isFrozen(bundle.privateEvaluator), true);

  assert.throws(() => defineWorldBundle({
    ...bundle,
    partitionManifest: [
      { id: "world-member:duplicate", partition: "public", kind: "TASK" },
      { id: "world-member:duplicate", partition: "private-evaluator", kind: "ORACLE" },
    ],
  }), /duplicate world member id/i);
});
