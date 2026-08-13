import assert from "node:assert/strict";
import { test } from "node:test";

import { createDecision, createEvent, createRelationship } from "../../core/src/index.ts";
import { InMemoryCanonicalLedger } from "../../ledger/src/index.ts";
import { GraphRegistry, defineGraph } from "../src/index.ts";

test("versions graph definitions and rebuilds deterministic materializations from the ledger", () => {
  const graph = defineGraph({
    id: "graph:collaboration",
    version: "1.0.0",
    domainPackage: "@example/domain-operations@1.2.0",
    nodeTypes: [
      { id: "collaboration:event", recordKinds: ["event"] },
      { id: "collaboration:decision", recordKinds: ["decision"] },
    ],
    edgeTypes: [{ id: "collaboration:led-by", relationshipTypes: ["project:led-by"] }],
    invariants: ["collaboration:no-self-leadership"],
    temporalBehavior: "bitemporal",
    retention: "organization-policy",
    requiredOperations: ["READ", "RECONSTRUCT"],
    verificationHooks: ["operations:relationship-verifier"],
  });
  const registry = new GraphRegistry();
  registry.register(graph);

  const provenance = { derivedFrom: [], transformations: ["fixture:v1"] };
  const records = [
    createRelationship({
      id: "relationship:project-lead",
      relationshipType: "project:led-by",
      fromEntityId: "entity:project-alpha",
      toEntityId: "entity:priya",
      validTime: { from: "2026-02-01T00:00:00Z" },
      recordedAt: "2026-02-03T00:00:00Z",
      authority: { level: 80, basis: "decision" },
      confidence: 0.9,
      provenance,
    }),
    createEvent({
      id: "event:appointment",
      eventType: "project:appointment",
      participants: [{ entityId: "entity:priya", role: "appointee" }],
      validTime: { from: "2026-02-01T00:00:00Z" },
      recordedAt: "2026-02-02T00:00:00Z",
      provenance,
    }),
    createDecision({
      id: "decision:appointment",
      decisionType: "project:appointment",
      subjects: ["entity:project-alpha"],
      decidedBy: ["entity:executive-team"],
      outcome: { lead: "entity:priya" },
      validTime: { from: "2026-02-01T00:00:00Z" },
      recordedAt: "2026-02-01T00:00:00Z",
      authority: { level: 80, basis: "decision" },
      provenance,
    }),
  ];
  const ledger = InMemoryCanonicalLedger.replay(records);
  const first = registry.rebuild("graph:collaboration", ledger.query());
  const second = registry.rebuild("graph:collaboration", [...ledger.query()].reverse());

  assert.equal(first.nodes.length, 2);
  assert.equal(first.edges.length, 1);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(registry.active("graph:collaboration")?.verificationHooks[0], "operations:relationship-verifier");
  assert.throws(
    () =>
      registry.register(
        defineGraph({
          ...graph,
          version: "1.1.0",
          nodeTypes: [{ id: "collaboration:event", recordKinds: ["event"] }],
        }),
      ),
    /backward-incompatible/,
  );
});
