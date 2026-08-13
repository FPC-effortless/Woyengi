import assert from "node:assert/strict";
import { test } from "node:test";

import { ProvenanceGraph } from "../src/index.ts";

test("traces a provenance DAG and propagates source invalidation to every consumer", () => {
  const nodes = [
    { id: "artifact:source", kind: "artifact", derivedFrom: [] },
    { id: "observation:1", kind: "observation", derivedFrom: ["artifact:source"] },
    { id: "claim:1", kind: "claim", derivedFrom: ["observation:1"] },
    { id: "projection:1", kind: "state-projection", derivedFrom: ["claim:1"] },
    { id: "reconstruction:1", kind: "reconstruction", derivedFrom: ["projection:1"] },
  ];
  const graph = ProvenanceGraph.build([...nodes].reverse());

  const impact = graph.invalidate("artifact:source", {
    id: "invalidation:source-deleted",
    reason: "user deleted source",
    recordedAt: "2026-03-01T00:00:00Z",
  });

  assert.deepEqual(impact.affected.map((node) => node.id), [
    "observation:1",
    "claim:1",
    "projection:1",
    "reconstruction:1",
  ]);
  assert.equal(graph.supportStatus("reconstruction:1"), "unsupported");
  assert.deepEqual(graph.traceUpstream("reconstruction:1").map((node) => node.id), [
    "artifact:source",
    "observation:1",
    "claim:1",
    "projection:1",
  ]);
  assert.equal(Object.isFrozen(impact), true);

  assert.throws(
    () => ProvenanceGraph.build([{ id: "claim:missing", kind: "claim", derivedFrom: ["observation:missing"] }]),
    /missing provenance reference/,
  );
  assert.throws(
    () =>
      ProvenanceGraph.build([
        { id: "claim:a", kind: "claim", derivedFrom: ["claim:b"] },
        { id: "claim:b", kind: "claim", derivedFrom: ["claim:a"] },
      ]),
    /provenance cycle/,
  );
});
