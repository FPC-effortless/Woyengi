import assert from "node:assert/strict";
import { test } from "node:test";

import { InMemoryCanonicalLedger } from "../../ledger/src/index.ts";
import { VerificationEngine } from "../src/index.ts";

test("runs extensible verifiers and appends explicit failure decisions", async () => {
  const engine = new VerificationEngine();
  engine.register({
    id: "verifier:schema",
    kind: "schema",
    async verify() {
      return { status: "verified", details: "Shape is valid.", issues: [] };
    },
  });
  engine.register({
    id: "verifier:temporal",
    kind: "temporal",
    async verify() {
      return { status: "rejected", details: "Valid interval overlaps a supersession.", issues: ["overlap"] };
    },
  });
  engine.register({
    id: "verifier:external",
    kind: "external",
    async verify() {
      throw new Error("upstream unavailable");
    },
  });

  const decision = await engine.verify({
    id: "verification:claim-42",
    subjectId: "claim:42",
    strategies: ["schema", "temporal", "external"],
    payload: { value: 42 },
    context: { purpose: "governing-state" },
    recordedAt: "2026-03-01T00:00:00Z",
    provenance: { derivedFrom: [{ kind: "claim", id: "claim:42" }], transformations: [] },
  });
  const ledger = new InMemoryCanonicalLedger();
  ledger.append(decision);

  assert.equal(decision.status, "rejected");
  assert.deepEqual(decision.outcomes.map((outcome) => outcome.status), [
    "verified",
    "rejected",
    "error",
  ]);
  assert.match(decision.outcomes[2]?.details ?? "", /upstream unavailable/);
  assert.equal(ledger.get(decision.id)?.kind, "verification");
  assert.equal(Object.isFrozen(decision), true);
});
