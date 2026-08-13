import assert from "node:assert/strict";
import { test } from "node:test";

import { createClaim } from "../src/index.ts";

test("creates an immutable domain-neutral claim with separate authority and confidence", () => {
  const claim = createClaim({
    id: "claim:1",
    subject: "entity:daniel",
    predicate: "domain:leads",
    object: { entity: "entity:project-alpha" },
    validTime: { from: "2026-01-10T09:00:00+01:00" },
    recordedAt: "2026-01-17T12:00:00Z",
    observationIds: ["observation:meeting-123"],
    evidenceIds: ["evidence:transcript-span-8"],
    provenance: {
      derivedFrom: [{ kind: "observation", id: "observation:meeting-123" }],
      transformations: ["semantic-compiler:v1"],
    },
    authority: {
      level: 40,
      basis: "meeting participant statement",
      principal: "entity:daniel",
    },
    confidence: 0.99,
    lifecycle: "provisional",
  });

  assert.equal(claim.kind, "claim");
  assert.equal(claim.validTime.from, "2026-01-10T08:00:00.000Z");
  assert.equal(claim.transactionTime.from, "2026-01-17T12:00:00.000Z");
  assert.equal(claim.authority.level, 40);
  assert.equal(claim.confidence, 0.99);
  assert.equal(Object.isFrozen(claim), true);
  assert.equal(Object.isFrozen(claim.provenance), true);
  assert.throws(() => {
    (claim as { predicate: string }).predicate = "domain:owns";
  }, TypeError);
});
