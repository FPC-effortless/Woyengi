import assert from "node:assert/strict";
import { test } from "node:test";

import { StateRequirementPlanner } from "../src/index.ts";

test("produces deterministic explicit state requirements for equivalent requests", async () => {
  const planner = new StateRequirementPlanner({
    async resolveIntent(input) {
      return {
        intent: "action-authorization",
        subjects: ["entity:project-alpha"],
        action: "project:launch",
        domain: "domain:operations",
        validAt: "2026-03-01T00:00:00Z",
        recordedAt: "2026-03-02T00:00:00Z",
        constraints: ["constraint:licence-valid", "constraint:budget-approved"],
        evidenceRequirements: ["evidence:licence", "evidence:approval"],
        contradictionRequirements: ["contradiction:authority", "contradiction:eligibility"],
        graphIds: ["graph:decisions", "graph:entities"],
        modalities: ["state", "evidence", "graph", "temporal", "entity"],
        purpose: "execute-project-action",
        normalizedRequest: input.request.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " "),
      };
    },
  });

  const first = await planner.plan({ request: "  CAN Project Alpha launch?  ", principal: "agent:operator" });
  const second = await planner.plan({ request: "can   project alpha launch?", principal: "agent:operator" });

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.requiredState, ["current-state", "relevant-history", "evidence", "contradictions"]);
  assert.deepEqual(first.graphIds, ["graph:decisions", "graph:entities"]);
  assert.deepEqual(first.modalities, ["entity", "evidence", "graph", "state", "temporal"]);
  assert.deepEqual(first.checks, [
    { kind: "authority", predicate: "project:launch", purpose: "execute-project-action" },
    { kind: "permission", operation: "RECONSTRUCT", principal: "agent:operator", purpose: "execute-project-action" },
  ]);
  assert.equal(Object.isFrozen(first), true);
});
