import assert from "node:assert/strict";
import { test } from "node:test";

import { AuthorityEngine, defineAuthorityPolicy } from "../src/index.ts";

test("ranks contextual authority independently from confidence with an inspectable rationale", () => {
  const engine = new AuthorityEngine();
  engine.register(
    defineAuthorityPolicy({
      id: "authority-policy:model-inference",
      principals: ["model:semantic-compiler"],
      predicatePrefixes: ["project:"],
      purposes: ["governing-state"],
      conditions: {},
      level: 10,
      basis: "model inference is advisory",
      validFrom: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
    }),
  );
  engine.register(
    defineAuthorityPolicy({
      id: "authority-policy:executive-decision",
      principals: ["entity:executive-team"],
      predicatePrefixes: ["project:"],
      purposes: ["governing-state"],
      conditions: { decisionStatus: "approved" },
      level: 90,
      basis: "approved executive decision governs project state",
      validFrom: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
    }),
  );

  const result = engine.rank({
    predicate: "project:launch-month",
    purpose: "governing-state",
    context: { decisionStatus: "approved" },
    at: "2026-06-01T00:00:00Z",
    candidates: [
      { id: "claim:model-september", principal: "model:semantic-compiler", confidence: 0.99 },
      { id: "claim:executive-october", principal: "entity:executive-team", confidence: 0.75 },
    ],
  });

  assert.equal(result.selected?.candidate.id, "claim:executive-october");
  assert.equal(result.selected?.authority.level, 90);
  assert.equal(result.assessments[0]?.candidate.confidence, 0.75);
  assert.match(result.selected?.rationale ?? "", /authority-policy:executive-decision/);
  assert.deepEqual(
    result.selected?.trace.filter((item) => item.matched).map((item) => item.policyId),
    ["authority-policy:executive-decision"],
  );
  assert.equal(Object.isFrozen(result), true);
});
