import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createEvent } from "../../core/src/index.ts";
import { LocalCanonicalLedger, LocalObjectStore, sha256 } from "../src/index.ts";

test("durable local ledger and object store survive restart with exact content", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-storage-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const ledgerPath = join(root, "ledger.json");
  const objectPath = join(root, "objects");
  const event = createEvent({
    id: "event:persisted",
    eventType: "operations:persisted",
    participants: [{ entityId: "entity:actor", role: "actor" }],
    validTime: { from: "2026-03-01T00:00:00Z" },
    recordedAt: "2026-03-02T00:00:00Z",
    provenance: { derivedFrom: [], transformations: ["fixture:v1"] },
  });
  const earlier = createEvent({
    id: "event:earlier",
    eventType: "operations:persisted",
    participants: [{ entityId: "entity:actor", role: "actor" }],
    validTime: { from: "2026-02-01T00:00:00Z" },
    recordedAt: "2026-02-02T00:00:00Z",
    provenance: { derivedFrom: [], transformations: ["fixture:v1"] },
  });

  const firstLedger = await LocalCanonicalLedger.open(ledgerPath);
  await Promise.all([firstLedger.append(event), firstLedger.append(earlier)]);
  const reopenedLedger = await LocalCanonicalLedger.open(ledgerPath);

  assert.deepEqual(reopenedLedger.query(), [earlier, event]);
  await assert.rejects(() => reopenedLedger.append(event), /already exists/);

  const bytes = new TextEncoder().encode("persistent reconstructable state");
  const digest = sha256(bytes);
  const firstObjects = await LocalObjectStore.open(objectPath);
  await firstObjects.put(digest, bytes);
  const reopenedObjects = await LocalObjectStore.open(objectPath);

  assert.deepEqual(await reopenedObjects.get(digest), bytes);
  await assert.rejects(
    () => reopenedObjects.put(`sha256:${"0".repeat(64)}`, bytes),
    /content hash mismatch/,
  );
});
