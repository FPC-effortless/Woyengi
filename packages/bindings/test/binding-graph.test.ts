import assert from "node:assert/strict";
import { test } from "node:test";

import { BindingGraph, createBinding } from "../src/index.ts";

test("traverses cross-graph bindings under depth, time, direction, and permission constraints", () => {
  const graph = new BindingGraph();
  graph.append(
    createBinding({
      id: "binding:meeting-decision",
      from: { graphId: "graph:episodes", recordId: "event:meeting" },
      to: { graphId: "graph:decisions", recordId: "decision:launch" },
      type: "causal:caused",
      validTime: { from: "2026-01-01T00:00:00Z" },
      recordedAt: "2026-01-02T00:00:00Z",
    }),
  );
  graph.append(
    createBinding({
      id: "binding:decision-task",
      from: { graphId: "graph:decisions", recordId: "decision:launch" },
      to: { graphId: "graph:tasks", recordId: "task:prepare" },
      type: "causal:created",
      validTime: { from: "2026-01-01T00:00:00Z" },
      recordedAt: "2026-01-03T00:00:00Z",
    }),
  );
  graph.append(
    createBinding({
      id: "binding:task-project",
      from: { graphId: "graph:tasks", recordId: "task:prepare" },
      to: { graphId: "graph:projects", recordId: "entity:project-alpha" },
      type: "dependency:affects",
      validTime: { from: "2026-01-01T00:00:00Z" },
      recordedAt: "2026-01-04T00:00:00Z",
    }),
  );
  graph.append(
    createBinding({
      id: "binding:decision-evidence",
      from: { graphId: "graph:decisions", recordId: "decision:launch" },
      to: { graphId: "graph:evidence", recordId: "evidence:restricted" },
      type: "evidence:supported-by",
      validTime: { from: "2026-01-01T00:00:00Z" },
      recordedAt: "2026-01-03T00:00:00Z",
    }),
  );

  const traversal = graph.traverse({
    start: { graphId: "graph:episodes", recordId: "event:meeting" },
    direction: "outgoing",
    maxDepth: 3,
    validAt: "2026-02-01T00:00:00Z",
    recordedAt: "2026-02-01T00:00:00Z",
    authorize(reference) {
      return reference.graphId !== "graph:evidence";
    },
  });

  assert.deepEqual(traversal.records.map((record) => record.recordId), [
    "decision:launch",
    "task:prepare",
    "entity:project-alpha",
  ]);
  assert.equal(traversal.trace.find((step) => step.bindingId === "binding:decision-evidence")?.decision, "denied");
  assert.equal(traversal.trace.find((step) => step.bindingId === "binding:task-project")?.depth, 3);
  assert.equal(Object.isFrozen(traversal), true);
});
