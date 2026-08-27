import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { parsePortableWorldBundle, type PortableWorldBundle } from "../src/index.ts";
import {
  assertWorldBundleSemanticConformance,
  verifyWorldBundleSemanticConformance,
} from "../src/semantic-conformance.ts";

type MutableArtifact = {
  members: Array<{
    id: string;
    kind: string;
    partition: string;
    payload: Record<string, unknown>;
    contentHash: string;
  }>;
  bundle: {
    public: {
      observationRefs: string[];
    };
  } & Record<string, unknown>;
} & Record<string, unknown>;

async function fixture(): Promise<PortableWorldBundle> {
  const serialized = await readFile(new URL("../fixtures/veritas-adapter-v0.1.json", import.meta.url), "utf8");
  return parsePortableWorldBundle(serialized);
}

function malformedClone(value: PortableWorldBundle): MutableArtifact {
  return JSON.parse(JSON.stringify(value)) as MutableArtifact;
}

function asPortable(value: MutableArtifact): PortableWorldBundle {
  return value as unknown as PortableWorldBundle;
}

test("pinned cross-language fixture has executable private semantics and materialized public evidence", async () => {
  const value = await fixture();
  assert.doesNotThrow(() => assertWorldBundleSemanticConformance(value));
  assert.equal(verifyWorldBundleSemanticConformance(value).conformant, true);

  const evidence = value.members.find((member) => member.kind === "EVIDENCE_RECORD");
  assert.equal((evidence?.payload as { recordId?: string }).recordId, "evidence:approval-decision");
  assert.equal(value.bundle.public.observationRefs.includes("evidence:approval-decision"), true);

  const evaluator = value.members.find((member) => member.kind === "EVALUATOR_ORACLE");
  const payload = evaluator?.payload as {
    invariants?: Array<{ assertion?: unknown; severity?: string; scope?: string }>;
    hiddenEffects?: Array<{ transition?: unknown }>;
  };
  assert.equal(typeof payload.invariants?.[0]?.assertion, "object");
  assert.equal(payload.invariants?.[0]?.severity, "critical");
  assert.equal(payload.invariants?.[0]?.scope, "always");
  assert.equal(typeof payload.hiddenEffects?.[0]?.transition, "object");
});

test("semantic profile rejects prose-only evaluator invariants", async () => {
  const value = malformedClone(await fixture());
  const evaluator = value.members.find((member) => member.kind === "EVALUATOR_ORACLE")!;
  const payload = evaluator.payload as { invariants: Array<Record<string, unknown>> };
  delete payload.invariants[0]!.assertion;
  assert.throws(() => assertWorldBundleSemanticConformance(asPortable(value)), /missing required field assertion/i);
});

test("semantic profile rejects descriptive hidden effects without executable transitions", async () => {
  const value = malformedClone(await fixture());
  const evaluator = value.members.find((member) => member.kind === "EVALUATOR_ORACLE")!;
  const payload = evaluator.payload as { hiddenEffects: Array<Record<string, unknown>> };
  delete payload.hiddenEffects[0]!.transition;
  payload.hiddenEffects[0]!.effect = "approval happens";
  assert.throws(
    () => assertWorldBundleSemanticConformance(asPortable(value)),
    /unknown field effect|missing required field transition/i,
  );
});

test("semantic profile rejects required evidence that is not materialized and agent-visible", async () => {
  const value = malformedClone(await fixture());
  value.members = value.members.filter((member) => member.kind !== "EVIDENCE_RECORD");
  assert.throws(
    () => assertWorldBundleSemanticConformance(asPortable(value)),
    /no materialized public EVIDENCE_RECORD/i,
  );

  const missingObservation = malformedClone(await fixture());
  missingObservation.bundle.public.observationRefs = missingObservation.bundle.public.observationRefs.filter(
    (ref) => ref !== "evidence:approval-decision",
  );
  assert.throws(
    () => assertWorldBundleSemanticConformance(asPortable(missingObservation)),
    /not declared as an agent-visible public observation/i,
  );
});

test("semantic profile rejects unknown fields in typed high-value member contracts", async () => {
  const value = malformedClone(await fixture());
  const evidence = value.members.find((member) => member.kind === "EVIDENCE_RECORD")!;
  evidence.payload.privateHint = "should never be accepted";
  assert.throws(() => assertWorldBundleSemanticConformance(asPortable(value)), /unknown field privateHint/i);
});
