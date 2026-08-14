import assert from "node:assert/strict";
import { test } from "node:test";

import { ReconstructionEngine, StateRequirementPlanner } from "../src/index.ts";

test("builds a permission-checked structured reconstructive workspace with a complete trace", async () => {
  const planner = new StateRequirementPlanner({
    async resolveIntent() {
      return {
        intent: "meeting-preparation",
        subjects: ["entity:daniel"],
        domain: "domain:personal",
        validAt: "2026-03-01T09:00:00Z",
        recordedAt: "2026-03-01T09:00:00Z",
        constraints: ["constraint:private-context"],
        evidenceRequirements: ["evidence:direct-source"],
        contradictionRequirements: ["contradiction:unresolved"],
        graphIds: ["graph:people", "graph:meetings", "graph:projects", "graph:decisions"],
        modalities: ["entity", "state", "temporal", "graph", "evidence"],
        purpose: "meeting-preparation",
        normalizedRequest: "prepare me for my meeting with daniel",
      };
    },
  });
  const engine = new ReconstructionEngine({
    planner,
    authorize() {
      return { allowed: true, capabilityId: "capability:meeting-reader", rationale: "purpose and scope match" };
    },
    async retrieve() {
      return {
        recordIds: ["claim:role", "event:last-meeting", "decision:launch", "claim:restricted"],
        trace: [{ modality: "state", candidates: 3 }],
      };
    },
    authorizeRecord(_plan, recordId) {
      return recordId !== "claim:restricted";
    },
    async assemble(_plan, recordIds) {
      assert.equal(recordIds.includes("claim:restricted"), false);
      return {
        currentState: [{ subject: "entity:daniel", predicate: "organization:role", value: "CTO" }],
        historicalState: [{ subject: "entity:daniel", predicate: "project:lead", value: "Project Alpha" }],
        relevantEvents: [{ id: "event:last-meeting" }],
        decisions: [{ id: "decision:launch" }],
        procedures: [{ id: "procedure:meeting-preparation" }],
        evidence: [{ id: "evidence:transcript", locator: "span://artifact:meeting#10-30" }],
        contradictions: [{ id: "conflict:launch-month", status: "unresolved" }],
        uncertainties: [{ id: "uncertainty:budget", reason: "missing filing" }],
        authorityContext: { selectedPolicy: "authority-policy:executive" },
        provenanceManifest: ["artifact:meeting", "observation:meeting", "claim:role"],
        renderedContext: "Daniel is CTO. Launch timing has an unresolved conflict.",
      };
    },
  });

  const workspace = await engine.reconstruct({
    id: "reconstruction:meeting-daniel",
    request: "Prepare me for my meeting with Daniel",
    principal: "user:123",
  });

  assert.equal(workspace.kind, "reconstruction");
  assert.equal(workspace.currentState[0]?.value, "CTO");
  assert.equal(workspace.contradictions[0]?.status, "unresolved");
  assert.equal(workspace.permissionContext.capabilityId, "capability:meeting-reader");
  const retrievalDetail = workspace.trace.find((step) => step.stage === "retrieval")?.detail as { readonly deniedRecordCount?: unknown } | undefined;
  assert.equal(retrievalDetail?.deniedRecordCount, 1);
  assert.deepEqual(workspace.trace.map((step) => step.stage), [
    "intent",
    "permission",
    "graph-activation",
    "retrieval",
    "temporal-resolution",
    "authority-resolution",
    "evidence-evaluation",
    "context-assembly",
  ]);
  assert.match(workspace.recommendedContext, /unresolved conflict/);
  assert.equal(Object.isFrozen(workspace), true);
});
