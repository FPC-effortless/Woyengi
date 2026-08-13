import assert from "node:assert/strict";
import { test } from "node:test";

import { RetrievalOrchestrator } from "../src/index.ts";

test("activates multiple retrieval modalities and fuses deterministic provenance-rich candidates", async () => {
  const orchestrator = new RetrievalOrchestrator();
  const modalities = ["lexical", "vector", "graph", "temporal", "entity", "state", "procedure", "evidence"] as const;
  for (const [index, modality] of modalities.entries()) {
    orchestrator.register({
      id: `retriever:${modality}`,
      modality,
      async retrieve() {
        return [
          {
            recordId: "claim:shared",
            score: 1 - index * 0.05,
            provenance: [`index:${modality}:primary`],
          },
          {
            recordId: `record:${modality}`,
            score: 0.5,
            provenance: [`index:${modality}:secondary`],
          },
        ];
      },
    });
  }
  const plan = {
    query: "current project state",
    limit: 5,
    modalities: modalities.map((modality) => ({ modality, weight: 1 })),
    filters: { validAt: "2026-03-01T00:00:00Z" },
  };

  const first = await orchestrator.retrieve(plan);
  const second = await orchestrator.retrieve({ ...plan, modalities: [...plan.modalities].reverse() });

  assert.equal(first.candidates[0]?.recordId, "claim:shared");
  assert.equal(first.candidates[0]?.contributions.length, 8);
  assert.equal(first.candidates[0]?.contributions[0]?.modality, "entity");
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.trace.map((step) => step.modality), [...modalities].sort());
  assert.equal(Object.isFrozen(first), true);
});
