import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createArtifact,
  createClaim,
  createDecision,
  createEvent,
  createRelationship,
} from "../src/index.ts";

test("creates an immutable domain-neutral claim with separate authority and confidence", () => {
  const claim = createClaim({
    id: "claim:1",
    subject: "entity:daniel",
    predicate: "domain:leads",
    object: { entity: "entity:project-alpha" },
    validTime: { from: "2026-01-10T09:00:00+01:00" },
    recordedAt: "2026-01-17T12:00:00Z",
    observationIds: ["observation:meeting-123"],
    evidenceIds: ["evidence:transcript-span-8"],
    provenance: {
      derivedFrom: [{ kind: "observation", id: "observation:meeting-123" }],
      transformations: ["semantic-compiler:v1"],
    },
    authority: {
      level: 40,
      basis: "meeting participant statement",
      principal: "entity:daniel",
    },
    confidence: 0.99,
    lifecycle: "provisional",
  });

  assert.equal(claim.kind, "claim");
  assert.equal(claim.validTime.from, "2026-01-10T08:00:00.000Z");
  assert.equal(claim.transactionTime.from, "2026-01-17T12:00:00.000Z");
  assert.equal(claim.authority.level, 40);
  assert.equal(claim.confidence, 0.99);
  assert.equal(Object.isFrozen(claim), true);
  assert.equal(Object.isFrozen(claim.provenance), true);
  assert.throws(() => {
    (claim as { predicate: string }).predicate = "domain:owns";
  }, TypeError);
});

test("creates bitemporal events, relationships, decisions, and residual-detail artifacts", () => {
  const provenance = {
    derivedFrom: [{ kind: "observation" as const, id: "observation:meeting-123" }],
    transformations: ["semantic-compiler:v1"],
  };
  const event = createEvent({
    id: "event:meeting-123",
    eventType: "collaboration:meeting",
    participants: [
      { entityId: "entity:daniel", role: "participant" },
      { entityId: "entity:priya", role: "chair" },
    ],
    validTime: {
      from: "2026-02-01T09:00:00Z",
      to: "2026-02-01T10:00:00Z",
    },
    recordedAt: "2026-02-01T10:05:00Z",
    evidenceIds: ["evidence:calendar-entry"],
    provenance,
    lifecycle: "verified",
  });
  const relationship = createRelationship({
    id: "relationship:project-lead",
    relationshipType: "project:led-by",
    fromEntityId: "entity:project-alpha",
    toEntityId: "entity:priya",
    validTime: { from: "2026-02-01T00:00:00Z" },
    recordedAt: "2026-02-02T00:00:00Z",
    evidenceIds: ["evidence:decision-record"],
    provenance,
    authority: { level: 80, basis: "executive decision" },
    confidence: 0.95,
    lifecycle: "verified",
  });
  const decision = createDecision({
    id: "decision:appoint-priya",
    decisionType: "governance:appointment",
    subjects: ["entity:project-alpha"],
    decidedBy: ["entity:executive-team"],
    outcome: { lead: "entity:priya" },
    validTime: { from: "2026-02-01T00:00:00Z" },
    recordedAt: "2026-02-02T00:00:00Z",
    evidenceIds: ["evidence:decision-record"],
    provenance,
    authority: { level: 80, basis: "executive decision" },
    lifecycle: "verified",
  });
  const artifact = createArtifact({
    id: "artifact:meeting-transcript",
    mediaType: "text/plain",
    contentHash: `sha256:${"a".repeat(64)}`,
    storageLocator: "object://local/meeting-123/transcript",
    residualDetails: [
      { locator: "object://local/meeting-123/audio", mediaType: "audio/wav" },
      { locator: "span://artifact:meeting-transcript#120-180", mediaType: "text/plain" },
    ],
    recordedAt: "2026-02-01T10:05:00Z",
    provenance,
    lifecycle: "verified",
  });

  assert.equal(event.participants[1]?.role, "chair");
  assert.equal(event.validTime.to, "2026-02-01T10:00:00.000Z");
  assert.equal(relationship.authority.level, 80);
  assert.deepEqual(decision.outcome, { lead: "entity:priya" });
  assert.equal(artifact.residualDetails[0]?.mediaType, "audio/wav");
  assert.equal(Object.isFrozen(artifact.residualDetails), true);
});
