import assert from "node:assert/strict";
import { test } from "node:test";

import { createClaim, createLifecycleTransition } from "../../core/src/index.ts";
import { ClaimLedger } from "../src/index.ts";

test("replays canonical records deterministically with a transaction-time cutoff", () => {
  const daniel = createClaim({
    id: "claim:daniel-leads-alpha",
    subject: "entity:project-alpha",
    predicate: "project:lead",
    object: { entity: "entity:daniel" },
    validTime: { from: "2026-01-10T00:00:00Z" },
    recordedAt: "2026-01-17T00:00:00Z",
    authority: { level: 30, basis: "team discussion" },
    confidence: 0.99,
    lifecycle: "verified",
  });
  const priya = createClaim({
    id: "claim:priya-leads-alpha",
    subject: "entity:project-alpha",
    predicate: "project:lead",
    object: { entity: "entity:priya" },
    validTime: { from: "2026-02-01T00:00:00Z" },
    recordedAt: "2026-02-10T00:00:00Z",
    authority: { level: 80, basis: "executive decision" },
    confidence: 0.8,
    lifecycle: "verified",
  });
  const retraction = createLifecycleTransition({
    id: "lifecycle:retract-priya",
    targetId: priya.id,
    status: "retracted",
    recordedAt: "2026-02-20T00:00:00Z",
    reason: "wrong project",
    authority: { level: 90, basis: "records correction" },
  });
  const unordered = [retraction, priya, daniel];

  const beforeRetraction = ClaimLedger.replay(unordered, {
    until: "2026-02-15T00:00:00Z",
  });
  const complete = ClaimLedger.replay(unordered);
  const rebuilt = ClaimLedger.replay(complete.canonicalRecords());
  const query = {
    subject: "entity:project-alpha",
    predicate: "project:lead",
    validAt: "2026-02-05T00:00:00Z",
    recordedAt: "2026-03-01T00:00:00Z",
  };

  assert.equal(beforeRetraction.projectAt(query).selected?.claim.id, priya.id);
  assert.equal(complete.projectAt(query).selected?.claim.id, daniel.id);
  assert.equal(JSON.stringify(rebuilt.projectAt(query)), JSON.stringify(complete.projectAt(query)));
  assert.deepEqual(rebuilt.canonicalRecords(), [daniel, priya, retraction]);
  assert.equal(Object.isFrozen(rebuilt.canonicalRecords()), true);
});
