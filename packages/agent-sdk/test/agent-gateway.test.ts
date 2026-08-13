import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentGateway } from "../src/index.ts";

test("separates agent reads, proposals, verification, and executed action provenance", async () => {
  const records: unknown[] = [];
  const gateway = new AgentGateway({
    authorize({ principal, operation }) {
      const allowed = operation === "RECONSTRUCT" || principal === "agent:writer";
      return { allowed, capabilityId: allowed ? `capability:${operation.toLowerCase()}` : undefined, rationale: allowed ? "granted" : "denied" };
    },
    async reconstruct() {
      return { workspaceId: "reconstruction:1" };
    },
    validateProposal() {
      return { valid: true, issues: [] };
    },
    evaluateAuthority() {
      return { level: 20, basis: "agent output remains advisory" };
    },
    async verifyProposal() {
      return { status: "verified", verifierId: "user:reviewer", details: "human approved" };
    },
    async executeProcedure() {
      return { status: "succeeded", output: { changed: true } };
    },
    async append(record) {
      records.push(record);
    },
  });

  assert.deepEqual(await gateway.read({ principal: "agent:reader", request: "state" }), { workspaceId: "reconstruction:1" });
  await assert.rejects(
    () =>
      gateway.propose({
        id: "agent-proposal:denied",
        principal: "agent:reader",
        proposalType: "claim",
        payload: { value: 1 },
        provenance: ["reconstruction:1"],
        recordedAt: "2026-03-01T00:00:00Z",
      }),
    /PROPOSE_WRITE denied/,
  );
  const proposal = await gateway.propose({
    id: "agent-proposal:verified",
    principal: "agent:writer",
    proposalType: "claim",
    payload: { value: 2 },
    provenance: ["reconstruction:1"],
    recordedAt: "2026-03-01T00:01:00Z",
    requireVerification: true,
  });
  const action = await gateway.act({
    id: "agent-action:execute",
    principal: "agent:writer",
    request: { action: "update" },
    procedureId: "procedure:guarded-update",
    provenance: [proposal.id],
    recordedAt: "2026-03-01T00:02:00Z",
  });

  assert.equal(proposal.lifecycle, "verified");
  assert.equal(proposal.authority.level, 20);
  assert.equal(action.permission.capabilityId, "capability:execute");
  assert.equal(action.procedureId, "procedure:guarded-update");
  assert.deepEqual(action.provenance, ["agent-proposal:verified"]);
  assert.equal(records.length, 2);
});
