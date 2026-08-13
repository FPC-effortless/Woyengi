import assert from "node:assert/strict";
import { test } from "node:test";

import { ProcedureEngine, defineProcedure } from "../src/index.ts";

test("guards procedure execution and proposes a versioned procedure after verified success", async () => {
  const procedure = defineProcedure({
    id: "procedure:inspect-resource",
    version: "1.0.0",
    preconditions: ["resource-exists"],
    operations: [{ id: "operation:inspect", tool: "tool:inspector", input: { mode: "safe" } }],
    tools: ["tool:inspector"],
    invariants: ["resource-not-mutated"],
    verification: ["verification:inspection-complete"],
    postconditions: ["inspection-recorded"],
    repair: [{ failure: "tool-failure", action: "retry-once" }],
  });
  let calls = 0;
  const engine = new ProcedureEngine({
    authorize(request) {
      return request.principal === "agent:allowed";
    },
    async invokeTool() {
      calls += 1;
      return { status: "ok", output: { inspected: true } };
    },
    async verify() {
      return { passed: true, details: "invariants and postconditions passed" };
    },
  });

  const denied = await engine.execute({
    id: "execution:denied",
    procedure,
    principal: "agent:denied",
    state: { "resource-exists": true },
    recordedAt: "2026-03-01T00:00:00Z",
  });
  const succeeded = await engine.execute({
    id: "execution:succeeded",
    procedure,
    principal: "agent:allowed",
    state: { "resource-exists": true },
    recordedAt: "2026-03-01T00:01:00Z",
    proposeCandidate: true,
  });

  assert.equal(denied.status, "denied");
  assert.equal(calls, 1);
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.steps[0]?.tool, "tool:inspector");
  assert.equal(succeeded.candidateProcedure?.basedOnExecutionId, "execution:succeeded");
  assert.equal(succeeded.candidateProcedure?.version, "1.0.1-candidate.1");
  assert.equal(Object.isFrozen(succeeded), true);
});
