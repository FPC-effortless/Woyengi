import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createEvent } from "../../core/src/index.ts";
import { IdempotencyConflictError, LocalCanonicalLedger, LocalIdempotencyStore, LocalObjectStore, sha256 } from "../src/index.ts";

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

  assert.deepEqual(reopenedLedger.query().map(withoutSequence), [event, earlier]);
  assert.deepEqual(reopenedLedger.query().map((record) => record.ledgerSequence), [1, 2]);
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

test("persists idempotent outcomes and rejects key reuse with a different fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-idempotency-"));
  const path = join(root, "requests.json");
  const store = await LocalIdempotencyStore.open(path);
  const first = await store.put({
    key: "user:123:ingest:request-1",
    fingerprint: sha256(new TextEncoder().encode("request-one")),
    result: { accepted: ["claim:1"] },
    recordedAt: "2026-08-14T00:00:00Z",
  });
  const duplicate = await store.put({
    key: "user:123:ingest:request-1",
    fingerprint: sha256(new TextEncoder().encode("request-one")),
    result: { accepted: ["claim:different-result-is-ignored"] },
    recordedAt: "2026-08-14T00:01:00Z",
  });
  assert.deepEqual(duplicate, first);
  assert.deepEqual((await LocalIdempotencyStore.open(path)).get(first.key), first);
  await assert.rejects(
    store.put({ ...first, fingerprint: sha256(new TextEncoder().encode("different-request")) }),
    IdempotencyConflictError,
  );
});

test("commits a canonical record bundle atomically", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-storage-batch-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const path = join(root, "records.json");
  const ledger = await LocalCanonicalLedger.open(path);
  const first = createEvent({
    id: "event:batch-first",
    eventType: "operations:batched",
    participants: [{ entityId: "entity:actor", role: "actor" }],
    validTime: { from: "2026-08-22T00:00:00Z" },
    recordedAt: "2026-08-22T00:00:00Z",
  });
  const second = createEvent({
    id: "event:batch-second",
    eventType: "operations:batched",
    participants: [{ entityId: "entity:actor", role: "actor" }],
    validTime: { from: "2026-08-22T00:00:01Z" },
    recordedAt: "2026-08-22T00:00:01Z",
  });

  await ledger.appendBatch([first, second]);
  assert.deepEqual((await LocalCanonicalLedger.open(path)).query().map(withoutSequence), [first, second]);

  const third = createEvent({
    id: "event:batch-third",
    eventType: "operations:batched",
    participants: [{ entityId: "entity:actor", role: "actor" }],
    validTime: { from: "2026-08-22T00:00:02Z" },
    recordedAt: "2026-08-22T00:00:02Z",
  });
  await assert.rejects(() => ledger.appendBatch([third, first]), /already exists/);
  assert.equal(ledger.get(third.id), undefined);
  assert.deepEqual((await LocalCanonicalLedger.open(path)).query().map(withoutSequence), [first, second]);
});

function withoutSequence<RecordType extends { readonly ledgerSequence?: number }>(record: RecordType): Omit<RecordType, "ledgerSequence"> {
  const { ledgerSequence: _ledgerSequence, ...canonical } = record;
  return canonical;
}

test("assigns immutable workspace causal sequence and continues it after restart", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-storage-sequence-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const path = join(root, "records.json");
  const parent = { ...createEvent({
    id: "event:z-parent",
    eventType: "operations:sequenced",
    participants: [{ entityId: "entity:actor", role: "actor" }],
    validTime: { from: "2026-08-22T00:00:00Z" },
    recordedAt: "2026-08-22T00:00:00Z",
  }), workspaceId: "workspace:causal" };
  const child = { ...createEvent({
    id: "event:a-child",
    eventType: "operations:sequenced",
    participants: [{ entityId: "entity:actor", role: "actor" }],
    validTime: { from: "2026-08-22T00:00:00Z" },
    recordedAt: "2026-08-22T00:00:00Z",
  }), workspaceId: "workspace:causal" };
  const first = await LocalCanonicalLedger.open<typeof parent & { readonly ledgerSequence?: number }>(path);
  await first.appendBatch([parent, child]);
  assert.deepEqual(first.query().map((record) => [record.id, record.ledgerSequence]), [[parent.id, 1], [child.id, 2]]);

  const reopened = await LocalCanonicalLedger.open<typeof parent & { readonly ledgerSequence?: number }>(path);
  const next = { ...createEvent({
    id: "event:next",
    eventType: "operations:sequenced",
    participants: [{ entityId: "entity:actor", role: "actor" }],
    validTime: { from: "2026-08-22T00:00:00Z" },
    recordedAt: "2026-08-22T00:00:00Z",
  }), workspaceId: "workspace:causal" };
  await reopened.append(next);
  assert.deepEqual(reopened.query().map((record) => [record.id, record.ledgerSequence]), [[parent.id, 1], [child.id, 2], [next.id, 3]]);
});
