import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compileOperationalIR,
  defineOperationalSystemSpec,
  type OperationalSystemSpecInput,
} from "../src/index.ts";

const baseSpec: OperationalSystemSpecInput = {
  id: "operational-system-spec:review-fixture",
  version: "0.1.0",
  workspaceId: "workspace:review",
  comprehensionRef: "comprehension:review-fixture",
  goals: ["preserve operational meaning"],
  requirements: [{
    id: "operational-requirement:review-state",
    kind: "STATE",
    statement: "state remains traceable",
    providerNeutral: true,
  }],
  invariants: [],
  actors: [],
  capabilities: [{
    id: "operational-capability:review-read",
    requirement: "read governed state",
    providerNeutral: true,
  }],
  authorityRequirements: [],
  procedures: [],
  outcomeContracts: [],
  epistemicState: { assumptionRefs: [], unknownRefs: [], conflictRefs: [] },
  externalSystemBindings: [],
  resources: [],
  attentionRules: [],
  lifecycleRules: [],
  projectionRequirements: [],
  provenanceRefs: ["comprehension:review-fixture"],
  validTime: { from: "2026-08-27T00:00:00Z" },
  recordedAt: "2026-08-27T10:00:00Z",
};

test("runtime validation rejects a decoded provider-neutral requirement that explicitly says false", () => {
  const invalid: OperationalSystemSpecInput = {
    ...baseSpec,
    requirements: [{
      ...baseSpec.requirements[0]!,
      providerNeutral: false as never,
    }],
  };

  assert.throws(
    () => defineOperationalSystemSpec(invalid),
    /provider.?neutral/i,
  );
});

test("Operational IR identity changes when normalized source content changes at the same nominal spec id/version", () => {
  const first = defineOperationalSystemSpec(baseSpec);
  const conflictingSameVersion = defineOperationalSystemSpec({
    ...baseSpec,
    goals: ["a materially different operational goal"],
  });

  const firstIr = compileOperationalIR(first, { compilerVersion: "0.1.0" });
  const conflictingIr = compileOperationalIR(conflictingSameVersion, { compilerVersion: "0.1.0" });

  assert.notEqual(firstIr.id, conflictingIr.id);
});
