import assert from "node:assert/strict";
import { test } from "node:test";

import { ProvenanceGraph } from "../../provenance/src/index.ts";
import { DeletionCoordinator } from "../src/index.ts";

function graph() {
  return ProvenanceGraph.build([
    { id: "artifact:source", kind: "artifact", derivedFrom: [] },
    { id: "observation:1", kind: "observation", derivedFrom: ["artifact:source"] },
    { id: "claim:1", kind: "claim", derivedFrom: ["observation:1"] },
    { id: "projection:1", kind: "state-projection", derivedFrom: ["claim:1"] },
    { id: "reconstruction:1", kind: "reconstruction", derivedFrom: ["projection:1"] },
  ]);
}

test("applies retention-aware deletion and prevents downstream index or reconstruction leakage", async () => {
  const indexed = new Set(["artifact:source", "observation:1", "claim:1", "projection:1", "reconstruction:1"]);
  const deletedObjects: string[] = [];
  const appended: unknown[] = [];
  const notifications: unknown[] = [];
  const logicalGraph = graph();
  const coordinator = new DeletionCoordinator({
    authorize() {
      return { allowed: true, rationale: "owner" };
    },
    retention() {
      return { mode: "logical-invalidation", rationale: "regulated retention" };
    },
    async removeFromIndexes(ids) {
      for (const id of ids) indexed.delete(id);
    },
    async deleteObject(id) {
      deletedObjects.push(id);
    },
    async append(record) {
      appended.push(record);
    },
    async publish(event) {
      notifications.push(event);
    },
  });

  const result = await coordinator.deleteSource({
    id: "source-invalidation:delete-source",
    principal: "user:owner",
    sourceId: "artifact:source",
    reason: "user deleted source",
    recordedAt: "2026-03-01T00:00:00Z",
    provenanceGraph: logicalGraph,
  });

  assert.equal(result.disposition, "logically-invalidated");
  assert.deepEqual(result.affectedByKind, {
    claim: ["claim:1"],
    observation: ["observation:1"],
    reconstruction: ["reconstruction:1"],
    "state-projection": ["projection:1"],
  });
  assert.equal(logicalGraph.supportStatus("reconstruction:1"), "unsupported");
  assert.equal(indexed.size, 0);
  assert.deepEqual(deletedObjects, []);
  assert.equal(appended.length, 1);
  assert.equal(notifications.length, 1);

  const physical = new DeletionCoordinator({
    authorize: () => ({ allowed: true, rationale: "owner" }),
    retention: () => ({ mode: "physical-erasure", rationale: "retention expired" }),
    removeFromIndexes: async () => undefined,
    deleteObject: async (id) => deletedObjects.push(id),
    append: async () => undefined,
    publish: async () => undefined,
  });
  await physical.deleteSource({
    id: "source-invalidation:erase-source",
    principal: "user:owner",
    sourceId: "artifact:source",
    reason: "retention expired",
    recordedAt: "2027-03-01T00:00:00Z",
    provenanceGraph: graph(),
  });
  assert.deepEqual(deletedObjects, ["artifact:source"]);
});
