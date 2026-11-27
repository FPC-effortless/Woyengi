import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defineComprehensionModel,
  defineOperationalSystemSpec,
} from "../../operational-spec/src/index.ts";
import {
  APP_PROJECTION_COMPILER_VERSION,
  AppProjectionCompiler,
  COMPOSITION_PREFERENCE,
  IntentCompiler,
  defineApplicationPackageCandidate,
  defineExistingApplication,
  validateAppBlueprintProjection,
} from "../src/index.ts";

test("compiles operating intent deterministically, reuses applicable software, asks only blocking questions, and updates existing Apps", () => {
  assert.deepEqual(COMPOSITION_PREFERENCE, [
    "do-nothing",
    "reuse",
    "configure",
    "compose",
    "adapt",
    "extend",
    "generate",
  ]);

  const supplierPackage = defineApplicationPackageCandidate({
    id: "application-package:supplier-onboarding",
    version: "1.2.0",
    name: "Supplier onboarding",
    objective: "Onboard and approve suppliers",
    subjects: ["supplier"],
    activities: ["onboarding", "approval"],
    capabilityRequirements: ["records.read", "records.write", "approval.request"],
    applicability: { applicable: true, rationale: ["supplier workflow supported"] },
  });
  const compiler = new IntentCompiler();
  const input = {
    workspaceId: "workspace:acme",
    naturalLanguageIntent: "I want something that handles supplier onboarding and approval.",
    availablePackages: [supplierPackage],
    ambiguities: [{ id: "notification-channel", blocking: false, question: "Which notification channel should be used?" }],
  } as const;

  const first = compiler.compile(input);
  const second = compiler.compile(input);
  assert.deepEqual(first, second);
  assert.equal(first.status, "ready");
  if (first.status !== "ready") throw new Error("expected ready compilation");
  assert.equal(first.appIntent.workspaceId, "workspace:acme");
  assert.match(first.appIntent.objective, /supplier onboarding/i);
  assert.deepEqual(first.appIntent.subjects, ["supplier"]);
  assert.ok(first.requirementGraph.nodes.some((node) => node.kind === "domain-object" && node.requirement === "supplier"));
  assert.ok(first.requirementGraph.nodes.some((node) => node.kind === "activity" && node.requirement === "onboarding"));
  assert.equal(first.requirementGraph.providerNeutral, true);
  assert.doesNotMatch(JSON.stringify(first.requirementGraph), /openai|anthropic|postgres|sqlite/i);
  assert.equal(first.comprehensionModel.contract, "woyengi.comprehension-model.v0.1");
  assert.equal(first.operationalSystemSpec.comprehensionRef, first.comprehensionModel.id);
  assert.equal(first.operationalIR.sourceSpecRef, first.operationalSystemSpec.id);
  assert.equal(first.operationalIR.compilerVersion, APP_PROJECTION_COMPILER_VERSION);
  assert.equal(first.compositionPlan.strategy, "reuse");
  assert.equal(first.compositionPlan.operation, "install");
  assert.equal(first.compositionPlan.selectedPackage?.id, supplierPackage.id);
  assert.equal(first.compositionPlan.operationalSystemSpecRef, first.operationalSystemSpec.id);
  assert.equal(first.compositionPlan.operationalIRRef, first.operationalIR.id);
  assert.deepEqual(first.appBlueprint.packageDependencies, [{ id: supplierPackage.id, version: supplierPackage.version }]);
  assert.equal(first.appBlueprint.intentRef, first.appIntent.id);
  assert.equal(first.appBlueprint.requirementGraphRef, first.requirementGraph.id);
  assert.equal(first.appBlueprint.operationalSystemSpecRef, first.operationalSystemSpec.id);
  assert.equal(first.appBlueprint.operationalIRRef, first.operationalIR.id);
  assert.match(first.humanReadableDiff, /Reuse Supplier onboarding@1\.2\.0/);
  assert.match(first.humanReadableDiff, /supplier/);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.appBlueprint), true);

  const blocked = compiler.compile({
    workspaceId: "workspace:acme",
    naturalLanguageIntent: "Create an approval App.",
    ambiguities: [
      { id: "cosmetic", blocking: false, question: "Which accent colour?" },
      { id: "approval-authority", blocking: true, question: "Who is authorized to approve suppliers?" },
      { id: "secondary", blocking: true, question: "What should happen after rejection?" },
    ],
  });
  assert.equal(blocked.status, "needs-input");
  assert.match(blocked.appIntent.objective, /approval/i);
  if (blocked.status !== "needs-input") throw new Error("expected blocking question");
  assert.equal(blocked.blockingQuestion, "Who is authorized to approve suppliers?");
  assert.deepEqual(blocked.blockingAmbiguityIds, ["approval-authority"]);

  const existing = defineExistingApplication({
    id: "application-instance:suppliers",
    name: "Supplier onboarding",
    objective: "Onboard suppliers",
    subjects: ["supplier"],
    activities: ["onboarding"],
    applicable: true,
  });
  const changed = compiler.compile({
    workspaceId: "workspace:acme",
    naturalLanguageIntent: "Change supplier onboarding so finance approval is required.",
    changeTargetAppId: existing.id,
    existingApplications: [existing],
    availablePackages: [supplierPackage],
  });
  assert.equal(changed.status, "ready");
  if (changed.status !== "ready") throw new Error("expected change compilation");
  assert.equal(changed.compositionPlan.operation, "update");
  assert.equal(changed.compositionPlan.strategy, "configure");
  assert.equal(changed.compositionPlan.targetApplicationId, existing.id);
  assert.equal(changed.compositionPlan.selectedPackage, undefined);
  assert.deepEqual(changed.appBlueprint.agentRoles, []);
  assert.deepEqual(changed.appBlueprint.runtimeContextRequirements, []);
  assert.deepEqual(changed.appBlueprint.publicSurfaceContracts, []);
  assert.match(changed.humanReadableDiff, /Update Supplier onboarding/);

  const unrelated = defineExistingApplication({
    id: "application-instance:invoice-reminders",
    name: "Invoice reminders",
    objective: "Track overdue invoices",
    subjects: ["invoice"],
    activities: ["tracking"],
    applicable: true,
  });
  const unrelatedChange = compiler.compile({
    workspaceId: "workspace:acme",
    naturalLanguageIntent: "Change supplier onboarding so finance approval is required.",
    existingApplications: [unrelated],
  });
  assert.equal(unrelatedChange.status, "ready");
  if (unrelatedChange.status !== "ready") throw new Error("expected unrelated change compilation");
  assert.equal(unrelatedChange.compositionPlan.targetApplicationId, undefined);
  assert.equal(unrelatedChange.compositionPlan.operation, "create");
  assert.equal(unrelatedChange.compositionPlan.strategy, "generate");
});

test("projects an OperationalSystemSpec without adding, dropping, or widening governed semantics", () => {
  const recordedAt = "2026-08-27T00:00:00.000Z";
  const comprehensionModel = defineComprehensionModel({
    id: "comprehension:supplier-approval",
    version: "0.1.0",
    workspaceId: "workspace:acme",
    objective: "Run supplier approval",
    actors: ["operational-actor:finance-manager"],
    subjects: ["supplier"],
    relevantStateRefs: [],
    historyRefs: [],
    requirements: ["Approve suppliers"],
    constraints: ["Approval requires finance authorization"],
    invariants: ["Only authorized finance roles may approve"],
    rationale: ["Canonical projection fixture"],
    assumptions: [],
    unknowns: [],
    conflicts: [],
    evidenceRefs: [],
    provenanceRefs: ["provenance:test-fixture"],
    validTime: { from: recordedAt },
    recordedAt,
  });
  const operationalSystemSpec = defineOperationalSystemSpec({
    id: "operational-system-spec:supplier-approval",
    version: "0.1.0",
    workspaceId: comprehensionModel.workspaceId,
    comprehensionRef: comprehensionModel.id,
    goals: ["Approve suppliers safely"],
    requirements: [
      { id: "operational-requirement:approval", kind: "ACTIVITY", statement: "approval", providerNeutral: true },
      { id: "operational-requirement:constraint", kind: "CONSTRAINT", statement: "Approval requires finance authorization", providerNeutral: true },
      { id: "operational-requirement:verification", kind: "VERIFICATION", statement: "Approval decision must be verified", providerNeutral: true },
    ],
    invariants: [
      { id: "operational-invariant:authorized-approval", statement: "Only authorized finance roles may approve", severity: "CRITICAL" },
    ],
    actors: [
      { id: "operational-actor:finance-manager", role: "finance manager", principalRefs: [] },
    ],
    capabilities: [
      { id: "operational-capability:approval-request", requirement: "approval.request", providerNeutral: true },
    ],
    authorityRequirements: [
      { id: "authority-requirement:approve-supplier", operation: "approve supplier", requirement: "finance approval authority" },
    ],
    procedures: [],
    outcomeContracts: [
      {
        id: "outcome-contract:supplier-approved",
        version: "0.1.0",
        objective: "Supplier decision is safely accepted",
        successAssertions: [
          { id: "outcome-assertion:decision-recorded", description: "Approval decision is recorded" },
        ],
        invariants: ["Only authorized finance roles may approve"],
        requiredEvidenceRefs: ["evidence-requirement:approval-log"],
        verificationRequirements: ["Verify approval authority", "Verify decision record"],
        effectConstraints: [
          { effectClass: "SEMANTIC", policy: "REQUIRE_RECONCILIATION" },
        ],
        acceptanceAuthorityRequirements: ["authority-requirement:approve-supplier"],
      },
    ],
    epistemicState: { assumptionRefs: [], unknownRefs: [], conflictRefs: [] },
    externalSystemBindings: [],
    resources: [
      { id: "operational-resource:supplier", kind: "SEMANTIC_OBJECT", reference: "subject:supplier" },
    ],
    attentionRules: [],
    lifecycleRules: [],
    projectionRequirements: [
      {
        id: "projection-requirement:supplier-app",
        projectionKind: "APP",
        requirement: "Expose the supplier approval workflow",
        outcomeContractRefs: ["outcome-contract:supplier-approved"],
      },
    ],
    provenanceRefs: ["provenance:test-fixture"],
    validTime: { from: recordedAt },
    recordedAt,
  });
  const supplierPackage = defineApplicationPackageCandidate({
    id: "application-package:supplier-approval",
    version: "2.0.0",
    name: "Supplier approval",
    objective: "Approve suppliers safely",
    subjects: ["supplier"],
    activities: ["approval"],
    capabilityRequirements: ["approval.request"],
    applicability: { applicable: true, rationale: ["supplier approval supported"] },
  });

  const result = new AppProjectionCompiler().compile({
    comprehensionModel,
    operationalSystemSpec,
    availablePackages: [supplierPackage],
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.comprehensionModel, comprehensionModel);
  assert.deepEqual(result.operationalSystemSpec, operationalSystemSpec);
  assert.equal(result.operationalIR.sourceSpecRef, operationalSystemSpec.id);
  assert.equal(result.operationalIR.compilerVersion, APP_PROJECTION_COMPILER_VERSION);
  assert.equal(result.compositionPlan.strategy, "reuse");
  assert.equal(result.appBlueprint.operationalSystemSpecRef, operationalSystemSpec.id);
  assert.equal(result.appBlueprint.operationalSystemSpecVersion, operationalSystemSpec.version);
  assert.equal(result.appBlueprint.operationalIRRef, result.operationalIR.id);
  assert.deepEqual(result.appBlueprint.goals, operationalSystemSpec.goals);
  assert.deepEqual(result.appBlueprint.outcomeContracts, operationalSystemSpec.outcomeContracts);
  assert.deepEqual(result.appBlueprint.authorityRequirementDefinitions, operationalSystemSpec.authorityRequirements);
  assert.deepEqual(result.appBlueprint.invariantDefinitions, operationalSystemSpec.invariants);
  assert.deepEqual(
    result.appBlueprint.constraintRequirements,
    operationalSystemSpec.requirements.filter((requirement) => requirement.kind === "CONSTRAINT"),
  );
  assert.deepEqual(result.appBlueprint.outcomeContractRefs, result.operationalIR.outcomeContractRefs);
  assert.deepEqual(result.appBlueprint.projectionRequirementRefs, result.operationalIR.projectionRequirementRefs);
  assert.deepEqual(result.appBlueprint.verificationContracts, [
    "Approval decision must be verified",
    "Verify approval authority",
    "Verify decision record",
  ]);
  validateAppBlueprintProjection({
    appBlueprint: result.appBlueprint,
    operationalSystemSpec,
    operationalIR: result.operationalIR,
  });

  assert.throws(
    () => validateAppBlueprintProjection({
      appBlueprint: { ...result.appBlueprint, outcomeContracts: [] },
      operationalSystemSpec,
      operationalIR: result.operationalIR,
    }),
    /outcome contract semantics/i,
  );
  assert.throws(
    () => validateAppBlueprintProjection({
      appBlueprint: {
        ...result.appBlueprint,
        authorityRequirements: [...result.appBlueprint.authorityRequirements, "administrator override"],
      },
      operationalSystemSpec,
      operationalIR: result.operationalIR,
    }),
    /authority semantics/i,
  );
  assert.throws(
    () => validateAppBlueprintProjection({
      appBlueprint: { ...result.appBlueprint, constraintRequirements: [] },
      operationalSystemSpec,
      operationalIR: result.operationalIR,
    }),
    /constraint semantics/i,
  );
  assert.throws(
    () => validateAppBlueprintProjection({
      appBlueprint: {
        ...result.appBlueprint,
        invariantDefinitions: result.appBlueprint.invariantDefinitions.map((invariant) => (
          invariant.id === "operational-invariant:authorized-approval"
            ? { ...invariant, severity: "LOW" as const }
            : invariant
        )),
      },
      operationalSystemSpec,
      operationalIR: result.operationalIR,
    }),
    /invariant definition semantics/i,
  );
  assert.throws(
    () => validateAppBlueprintProjection({
      appBlueprint: {
        ...result.appBlueprint,
        verificationContracts: [...result.appBlueprint.verificationContracts, "Skip independent verification"],
      },
      operationalSystemSpec,
      operationalIR: result.operationalIR,
    }),
    /verification semantics/i,
  );
});
