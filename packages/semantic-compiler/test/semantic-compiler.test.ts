import assert from "node:assert/strict";
import { test } from "node:test";

import { SemanticCompiler } from "../src/index.ts";

test("compiles observations into provisional source-spanned semantic proposals only", async () => {
  let stateWrites = 0;
  const compiler = new SemanticCompiler({
    async decompose() {
      return {
        claims: [{ localId: "claim-1", subject: "Daniel", predicate: "project:leads", object: "Project Alpha", span: [0, 36] }],
        events: [{ localId: "event-1", eventType: "project:appointment", participants: ["Daniel"], span: [0, 36] }],
        relationships: [{ localId: "relationship-1", type: "project:led-by", from: "Project Alpha", to: "Daniel", span: [0, 36] }],
        evidence: [{ localId: "evidence-1", span: [0, 36] }],
        identities: [{ mention: "Daniel", candidates: [{ entityId: "entity:daniel", score: 0.92 }], span: [0, 6] }],
      };
    },
    proposeStateWrite() {
      stateWrites += 1;
    },
  });

  const result = await compiler.compile({
    id: "observation:meeting-123",
    sourceArtifactId: "artifact:meeting-transcript",
    text: "Daniel is now leading Project Alpha.",
    recordedAt: "2026-03-01T00:00:00Z",
  });

  assert.equal(result.claims[0]?.lifecycle, "provisional");
  assert.deepEqual(result.claims[0]?.sourceSpan, { artifactId: "artifact:meeting-transcript", start: 0, end: 36 });
  assert.equal(result.events[0]?.lifecycle, "provisional");
  assert.equal(result.relationships[0]?.lifecycle, "provisional");
  assert.equal(result.identityCandidates[0]?.status, "provisional");
  assert.equal(result.evidence[0]?.locator, "span://artifact:meeting-transcript#0-36");
  assert.equal(stateWrites, 0);
  assert.equal(Object.isFrozen(result), true);
});
