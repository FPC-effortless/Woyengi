import assert from "node:assert/strict";
import { test } from "node:test";

import { SyncEngine, createSyncOperation, defineStoragePolicy } from "../src/index.ts";

test("converges mergeable content, blocks authoritative conflicts, and enforces locality", () => {
  const shared = defineStoragePolicy({
    locality: "cloud-allowed",
    allowedDevices: ["device:a", "device:b"],
    allowedRegions: ["region:ng"],
    allowedAgents: ["agent:sync"],
    encryption: "organization-key",
    retention: "P365D",
    expiresAt: "2027-01-01T00:00:00Z",
  });
  const localOnly = defineStoragePolicy({
    ...shared,
    locality: "local-only",
    allowedDevices: ["device:a"],
  });
  const noteA = createSyncOperation({
    id: "sync-op:note-title",
    objectId: "note:1",
    objectKind: "note",
    replicaId: "device:a",
    parents: [],
    changes: { title: "Project" },
    recordedAt: "2026-03-01T00:00:00Z",
    storagePolicy: shared,
  });
  const noteB = createSyncOperation({
    id: "sync-op:note-body",
    objectId: "note:1",
    objectKind: "note",
    replicaId: "device:b",
    parents: [],
    changes: { body: "Launch notes" },
    recordedAt: "2026-03-01T00:00:01Z",
    storagePolicy: shared,
  });
  const decisionA = createSyncOperation({
    id: "sync-op:decision-a",
    objectId: "decision:1",
    objectKind: "decision",
    replicaId: "device:a",
    parents: [],
    changes: { outcome: "September" },
    recordedAt: "2026-03-01T00:00:00Z",
    storagePolicy: shared,
  });
  const decisionB = createSyncOperation({
    id: "sync-op:decision-b",
    objectId: "decision:1",
    objectKind: "decision",
    replicaId: "device:b",
    parents: [],
    changes: { outcome: "October" },
    recordedAt: "2026-03-01T00:00:01Z",
    storagePolicy: shared,
  });
  const privateOp = createSyncOperation({
    id: "sync-op:private",
    objectId: "note:private",
    objectKind: "note",
    replicaId: "device:a",
    parents: [],
    changes: { body: "private" },
    recordedAt: "2026-03-01T00:00:00Z",
    storagePolicy: localOnly,
  });
  const engine = new SyncEngine({ note: "mergeable-map", decision: "authoritative" });
  const target = { kind: "cloud" as const, deviceId: "device:b", region: "region:ng", agentId: "agent:sync", at: "2026-04-01T00:00:00Z" };

  const first = engine.synchronize([noteA, noteB, decisionA, decisionB, privateOp], target);
  const second = engine.synchronize([privateOp, decisionB, noteB, decisionA, noteA], target);

  assert.deepEqual(first.objects.find((item) => item.id === "note:1")?.state, { body: "Launch notes", title: "Project" });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.conflicts[0]?.objectId, "decision:1");
  assert.equal(first.conflicts[0]?.status, "requires-explicit-resolution");
  assert.deepEqual(first.rejected.map((item) => item.operationId), ["sync-op:private"]);
});
