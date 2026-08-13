import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createClaim,
  createLifecycleTransition,
  type CreateClaimInput,
} from "../../core/src/index.ts";
import { ClaimLedger } from "../src/index.ts";

function leadershipClaim(overrides: Partial<CreateClaimInput> = {}) {
  return createClaim({
    id: "claim:daniel-leads-alpha",
    subject: "entity:project-alpha",
    predicate: "project:lead",
    object: { entity: "entity:daniel" },
    validTime: { from: "2026-01-10T00:00:00Z" },
    recordedAt: "2026-01-17T00:00:00Z",
    authority: { level: 30, basis: "team discussion" },
    confidence: 0.99,
    lifecycle: "verified",
    ...overrides,
  });
}

test("distinguishes valid time from knowledge time and exposes authority conflicts", () => {
  const ledger = new ClaimLedger();
  ledger.append(leadershipClaim());
  ledger.append(
    leadershipClaim({
      id: "claim:priya-leads-alpha",
      object: { entity: "entity:priya" },
      validTime: { from: "2026-02-01T00:00:00Z" },
      recordedAt: "2026-02-10T00:00:00Z",
      authority: { level: 80, basis: "approved executive decision" },
      confidence: 0.8,
    }),
  );

  const believedOnFebruary5 = ledger.projectAt({
    subject: "entity:project-alpha",
    predicate: "project:lead",
    validAt: "2026-02-05T00:00:00Z",
    recordedAt: "2026-02-05T00:00:00Z",
  });
  const nowKnownAboutFebruary5 = ledger.projectAt({
    subject: "entity:project-alpha",
    predicate: "project:lead",
    validAt: "2026-02-05T00:00:00Z",
    recordedAt: "2026-02-15T00:00:00Z",
  });

  assert.equal(believedOnFebruary5.selected?.claim.id, "claim:daniel-leads-alpha");
  assert.equal(nowKnownAboutFebruary5.selected?.claim.id, "claim:priya-leads-alpha");
  assert.deepEqual(
    nowKnownAboutFebruary5.conflicts.map((conflict) => conflict.claim.id),
    ["claim:daniel-leads-alpha"],
  );
  assert.deepEqual(
    nowKnownAboutFebruary5.trace.map((step) => step.stage),
    ["candidate-discovery", "transaction-time", "valid-time", "lifecycle", "selection"],
  );
  assert.equal(Object.isFrozen(nowKnownAboutFebruary5), true);
});

test("applies append-only retraction and supersession without deleting claim history", () => {
  const ledger = new ClaimLedger();
  ledger.append(leadershipClaim());
  ledger.append(
    leadershipClaim({
      id: "claim:priya-leads-alpha",
      object: { entity: "entity:priya" },
      validTime: { from: "2026-02-01T00:00:00Z" },
      recordedAt: "2026-02-10T00:00:00Z",
      authority: { level: 80, basis: "approved executive decision" },
    }),
  );
  ledger.appendLifecycleTransition(
    createLifecycleTransition({
      id: "lifecycle:retract-priya",
      targetId: "claim:priya-leads-alpha",
      status: "retracted",
      recordedAt: "2026-02-20T00:00:00Z",
      reason: "decision entered against the wrong project",
      authority: { level: 90, basis: "records correction" },
    }),
  );
  ledger.appendLifecycleTransition(
    createLifecycleTransition({
      id: "lifecycle:supersede-daniel",
      targetId: "claim:daniel-leads-alpha",
      status: "superseded",
      recordedAt: "2026-03-01T00:00:00Z",
      reason: "later appointment governs",
      authority: { level: 90, basis: "approved executive decision" },
    }),
  );

  const afterRetraction = ledger.projectAt({
    subject: "entity:project-alpha",
    predicate: "project:lead",
    validAt: "2026-02-05T00:00:00Z",
    recordedAt: "2026-02-25T00:00:00Z",
  });
  const afterSupersession = ledger.projectAt({
    subject: "entity:project-alpha",
    predicate: "project:lead",
    validAt: "2026-02-05T00:00:00Z",
    recordedAt: "2026-03-05T00:00:00Z",
  });

  assert.equal(afterRetraction.selected?.claim.id, "claim:daniel-leads-alpha");
  assert.equal(afterSupersession.selected, undefined);
  assert.equal(ledger.history({ predicate: "project:lead" }).length, 2);
  assert.deepEqual(
    ledger.lifecycleHistory("claim:priya-leads-alpha").map((transition) => transition.status),
    ["retracted"],
  );
});
