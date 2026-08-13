import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IdentityRegistry,
  addAliasOperation,
  createEntityOperation,
  mergeEntitiesOperation,
  proposeMatchOperation,
  splitEntityOperation,
} from "../src/index.ts";

const provenance = {
  derivedFrom: [{ kind: "observation" as const, id: "observation:contact-import" }],
  transformations: ["identity-resolution:v1"],
};

test("replays provisional matches, reversible merges, and splits with provenance", () => {
  const operations = [
    createEntityOperation({
      id: "identity-op:create-samuel",
      entityId: "entity:samuel",
      recordedAt: "2026-01-01T00:00:00Z",
      provenance,
    }),
    createEntityOperation({
      id: "identity-op:create-s-waritimi",
      entityId: "entity:s-waritimi",
      recordedAt: "2026-01-01T00:00:01Z",
      provenance,
    }),
    addAliasOperation({
      id: "identity-op:add-email",
      entityId: "entity:samuel",
      alias: "samuel@example.com",
      aliasKind: "external-id",
      recordedAt: "2026-01-01T00:00:02Z",
      provenance,
    }),
    addAliasOperation({
      id: "identity-op:add-handle",
      entityId: "entity:s-waritimi",
      alias: "@samuel",
      aliasKind: "handle",
      recordedAt: "2026-01-01T00:00:03Z",
      provenance,
    }),
    proposeMatchOperation({
      id: "identity-op:possible-match",
      leftEntityId: "entity:samuel",
      rightEntityId: "entity:s-waritimi",
      score: 0.94,
      rationale: "name and contact overlap",
      recordedAt: "2026-01-02T00:00:00Z",
      provenance,
    }),
    mergeEntitiesOperation({
      id: "identity-op:confirm-merge",
      canonicalEntityId: "entity:samuel",
      mergedEntityId: "entity:s-waritimi",
      proposalId: "identity-op:possible-match",
      recordedAt: "2026-01-03T00:00:00Z",
      provenance,
      authority: { level: 80, basis: "human confirmation" },
    }),
    splitEntityOperation({
      id: "identity-op:split-entities",
      entityId: "entity:s-waritimi",
      recordedAt: "2026-01-04T00:00:00Z",
      provenance,
      authority: { level: 90, basis: "merge correction" },
    }),
  ];

  const provisional = IdentityRegistry.replay(operations, {
    until: "2026-01-02T12:00:00Z",
  });
  const merged = IdentityRegistry.replay(operations, {
    until: "2026-01-03T12:00:00Z",
  });
  const split = IdentityRegistry.replay([...operations].reverse());

  assert.equal(provisional.matchStatus("identity-op:possible-match"), "provisional");
  assert.deepEqual(merged.resolveAlias("@samuel"), ["entity:samuel"]);
  assert.equal(merged.matchStatus("identity-op:possible-match"), "confirmed");
  assert.deepEqual(split.resolveAlias("@samuel"), ["entity:s-waritimi"]);
  assert.deepEqual(split.mergeHistory("entity:s-waritimi").map((item) => item.kind), [
    "entities.merged",
    "entity.split",
  ]);
  assert.equal(split.history()[0]?.provenance.derivedFrom[0]?.id, "observation:contact-import");
  assert.equal(Object.isFrozen(split.history()), true);
});
