import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMPOSITION_PREFERENCE,
  IntentCompiler,
  defineApplicationPackageCandidate,
  defineExistingApplication,
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
  assert.equal(first.compositionPlan.strategy, "reuse");
  assert.equal(first.compositionPlan.operation, "install");
  assert.equal(first.compositionPlan.selectedPackage?.id, supplierPackage.id);
  assert.deepEqual(first.appBlueprint.packageDependencies, [{ id: supplierPackage.id, version: supplierPackage.version }]);
  assert.equal(first.appBlueprint.intentRef, first.appIntent.id);
  assert.equal(first.appBlueprint.requirementGraphRef, first.requirementGraph.id);
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
