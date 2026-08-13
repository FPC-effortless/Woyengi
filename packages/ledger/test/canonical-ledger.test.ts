import assert from "node:assert/strict";
import { test } from "node:test";

import { createArtifact, createEvent } from "../../core/src/index.ts";
import { InMemoryCanonicalLedger } from "../src/index.ts";

test("stores every canonical record kind with global IDs and deterministic queries", () => {
  const provenance = { derivedFrom: [], transformations: ["test-fixture:v1"] };
  const event = createEvent({
    id: "event:inspection",
    eventType: "operations:inspection",
    participants: [{ entityId: "entity:inspector", role: "inspector" }],
    validTime: { from: "2026-02-01T10:00:00Z" },
    recordedAt: "2026-02-02T10:00:00Z",
    provenance,
  });
  const artifact = createArtifact({
    id: "artifact:inspection-photo",
    mediaType: "image/png",
    contentHash: `sha256:${"b".repeat(64)}`,
    storageLocator: "object://local/inspection/photo",
    recordedAt: "2026-02-01T11:00:00Z",
    provenance,
  });
  const ledger = InMemoryCanonicalLedger.replay([event, artifact]);

  assert.deepEqual(
    ledger.query().map((record) => record.id),
    [artifact.id, event.id],
  );
  assert.deepEqual(
    ledger.query({ kinds: ["event"] }).map((record) => record.id),
    [event.id],
  );
  assert.deepEqual(
    ledger.query({ until: "2026-02-01T23:00:00Z" }).map((record) => record.id),
    [artifact.id],
  );
  assert.throws(() => ledger.append(event), /already exists/);
  assert.equal(Object.isFrozen(ledger.query()), true);
});
