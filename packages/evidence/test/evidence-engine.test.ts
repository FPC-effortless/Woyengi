import assert from "node:assert/strict";
import { test } from "node:test";

import { createEvidence } from "../../core/src/index.ts";
import {
  EvidenceEngine,
  createEvidenceLink,
  createVerificationOutcome,
} from "../src/index.ts";

test("retains support, contradiction, exact locators, and provenance-backed verification", () => {
  const supporting = createEvidence({
    id: "evidence:transcript-span",
    sourceId: "artifact:meeting-transcript",
    locator: "span://artifact:meeting-transcript#120-180",
    recordedAt: "2026-02-01T10:05:00Z",
  });
  const contradicting = createEvidence({
    id: "evidence:filing-field",
    sourceId: "artifact:verified-filing",
    locator: "json-pointer://artifact:verified-filing#/employeeCount",
    recordedAt: "2026-02-02T10:05:00Z",
  });
  const original = JSON.stringify(supporting);
  const engine = new EvidenceEngine();
  engine.registerEvidence(supporting);
  engine.registerEvidence(contradicting);
  engine.appendLink(
    createEvidenceLink({
      id: "evidence-link:transcript-support",
      evidenceId: supporting.id,
      claimId: "claim:employee-count-47",
      stance: "supports",
      strength: 0.7,
      recordedAt: "2026-02-01T10:06:00Z",
      provenance: { derivedFrom: [{ kind: "evidence", id: supporting.id }], transformations: [] },
    }),
  );
  engine.appendLink(
    createEvidenceLink({
      id: "evidence-link:filing-contradiction",
      evidenceId: contradicting.id,
      claimId: "claim:employee-count-47",
      stance: "contradicts",
      strength: 0.95,
      recordedAt: "2026-02-02T10:06:00Z",
      provenance: { derivedFrom: [{ kind: "evidence", id: contradicting.id }], transformations: [] },
    }),
  );
  engine.appendVerification(
    createVerificationOutcome({
      id: "verification:filing-human-check",
      subjectId: "evidence:filing-field",
      verifier: { id: "user:reviewer", kind: "human" },
      method: "source-comparison",
      status: "verified",
      recordedAt: "2026-02-03T00:00:00Z",
      provenance: { derivedFrom: [{ kind: "evidence", id: contradicting.id }], transformations: [] },
      details: "Matched signed filing field.",
    }),
  );

  const summary = engine.summarize("claim:employee-count-47");

  assert.equal(summary.assessment, "mixed");
  assert.equal(summary.supporting[0]?.evidence.locator, "span://artifact:meeting-transcript#120-180");
  assert.equal(summary.contradicting[0]?.verification[0]?.verifier.kind, "human");
  assert.match(summary.rationale, /1 supporting and 1 contradicting/);
  assert.equal(JSON.stringify(supporting), original);
  assert.equal(Object.isFrozen(summary), true);
});
