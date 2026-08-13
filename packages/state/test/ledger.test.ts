import assert from "node:assert/strict";
import { test } from "node:test";

import { createClaim, type CreateClaimInput } from "../../core/src/index.ts";
import { ClaimLedger } from "../src/index.ts";

const baseClaim: CreateClaimInput = {
  id: "claim:daniel-leads-alpha",
  subject: "entity:daniel",
  predicate: "project:leads",
  object: { entity: "entity:project-alpha" },
  validTime: { from: "2026-01-10T00:00:00Z" },
  recordedAt: "2026-01-17T00:00:00Z",
  authority: { level: 50, basis: "meeting record" },
  confidence: 0.9,
};

test("appends immutable claims and returns deterministic transaction-time history", () => {
  const ledger = new ClaimLedger();
  const first = createClaim(baseClaim);
  const original = JSON.stringify(first);
  const second = createClaim({
    ...baseClaim,
    id: "claim:priya-leads-alpha",
    subject: "entity:priya",
    recordedAt: "2026-02-01T00:00:00Z",
  });

  ledger.append(second);
  ledger.append(first);

  assert.equal(JSON.stringify(first), original);
  assert.deepEqual(
    ledger.history({ predicate: "project:leads" }).map((claim) => claim.id),
    ["claim:daniel-leads-alpha", "claim:priya-leads-alpha"],
  );
  assert.throws(() => ledger.append(first), /already exists/);
  assert.equal(Object.isFrozen(ledger.history({ predicate: "project:leads" })), true);
});
