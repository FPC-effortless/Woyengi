import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  createPortableWorldBundle,
  parsePortableWorldBundle,
  toPublicWorldBundleArtifact,
  type PortableWorldBundle,
  type PortableWorldBundleInput,
} from "../src/index.ts";
import {
  assertWorldActionSchemaConformance,
  verifyWorldActionSchemaConformance,
  WORLD_BUNDLE_ACTION_SCHEMA_CONTRACT,
  WORLD_BUNDLE_ACTION_SCHEMA_KIND,
} from "../src/action-schema.ts";
import { assertWorldBundleSemanticConformance } from "../src/semantic-conformance.ts";

type MutableArtifact = {
  members: Array<{
    id: string;
    kind: string;
    partition: "public" | "private-evaluator";
    payload: Record<string, unknown>;
    contentHash: string;
  }>;
} & Record<string, unknown>;

async function fixture(): Promise<PortableWorldBundle> {
  const serialized = await readFile(new URL("../fixtures/veritas-adapter-v0.1.json", import.meta.url), "utf8");
  return parsePortableWorldBundle(serialized);
}

function mutableClone(value: PortableWorldBundle): MutableArtifact {
  return JSON.parse(JSON.stringify(value)) as MutableArtifact;
}

function asPortable(value: MutableArtifact): PortableWorldBundle {
  return value as unknown as PortableWorldBundle;
}

function schemaMembers(value: MutableArtifact): MutableArtifact["members"] {
  return value.members.filter((member) => member.kind === WORLD_BUNDLE_ACTION_SCHEMA_KIND);
}

function payload(member: MutableArtifact["members"][number]): {
  actionRef: string;
  contract: string;
  inputSchema: {
    properties: Record<string, unknown>;
    required: string[];
  } & Record<string, unknown>;
  outputSchema: {
    properties: Record<string, unknown>;
    required: string[];
  } & Record<string, unknown>;
} {
  return member.payload as ReturnType<typeof payload>;
}

function portableInput(value: PortableWorldBundle): PortableWorldBundleInput {
  return {
    bundle: value.bundle,
    members: value.members.map(({ contentHash: _contentHash, ...member }) => member),
  };
}

test("pinned fixture binds exactly one public language-neutral schema to every executable action", async () => {
  const value = await fixture();
  assert.doesNotThrow(() => assertWorldActionSchemaConformance(value));
  assert.doesNotThrow(() => assertWorldBundleSemanticConformance(value));
  assert.equal(verifyWorldActionSchemaConformance(value).conformant, true);

  const bindings = value.members.filter((member) => member.kind === WORLD_BUNDLE_ACTION_SCHEMA_KIND);
  assert.equal(bindings.length, value.bundle.public.actionSurface.length);
  assert.deepEqual(
    bindings.map((member) => (member.payload as { actionRef: string }).actionRef).sort(),
    value.bundle.public.actionSurface.map((action) => action.id).sort(),
  );
  for (const binding of bindings) {
    assert.equal(binding.partition, "public");
    const schema = binding.payload as {
      contract: string;
      actionRef: string;
      inputSchema: { properties: Record<string, unknown>; required: string[] };
    };
    assert.equal(schema.contract, WORLD_BUNDLE_ACTION_SCHEMA_CONTRACT);
    const action = value.bundle.public.actionSurface.find((candidate) => candidate.id === schema.actionRef)!;
    assert.deepEqual(Object.keys(schema.inputSchema.properties).sort(), [...action.parameterNames].sort());
    assert.deepEqual(schema.inputSchema.required, [...schema.inputSchema.required].sort());
  }
});

test("action schema rejects unknown and duplicate action bindings", async () => {
  const unknown = mutableClone(await fixture());
  payload(schemaMembers(unknown)[0]!).actionRef = "world-action:does-not-exist";
  assert.throws(() => assertWorldActionSchemaConformance(asPortable(unknown)), /unknown public action/i);

  const duplicate = mutableClone(await fixture());
  const members = schemaMembers(duplicate);
  payload(members[1]!).actionRef = payload(members[0]!).actionRef;
  assert.throws(() => assertWorldActionSchemaConformance(asPortable(duplicate)), /duplicate ACTION_SCHEMA binding/i);
});

test("action schema rejects parameter-name mismatch and nondeterministic requiredness", async () => {
  const mismatch = mutableClone(await fixture());
  const request = schemaMembers(mismatch).find((member) => payload(member).actionRef === "world-action:request-approval")!;
  delete payload(request).inputSchema.properties.requested_role;
  payload(request).inputSchema.required = ["supplier_id"];
  assert.throws(() => assertWorldActionSchemaConformance(asPortable(mismatch)), /must exactly match .*parameterNames/i);

  const unsorted = mutableClone(await fixture());
  const requestUnsorted = schemaMembers(unsorted).find((member) => payload(member).actionRef === "world-action:request-approval")!;
  payload(requestUnsorted).inputSchema.required = ["supplier_id", "requested_role"];
  assert.throws(() => assertWorldActionSchemaConformance(asPortable(unsorted)), /unique and lexicographically sorted/i);
});

test("action schema rejects malformed or widened JSON Schema profiles", async () => {
  const malformed = mutableClone(await fixture());
  const first = schemaMembers(malformed)[0]!;
  payload(first).outputSchema.type = "date";
  assert.throws(() => assertWorldActionSchemaConformance(asPortable(malformed)), /unsupported JSON Schema type/i);

  const unknownKeyword = mutableClone(await fixture());
  const nested = Object.values(payload(schemaMembers(unknownKeyword)[0]!).outputSchema.properties)[0] as Record<string, unknown>;
  nested.description = "not part of the v0.1 structural profile";
  assert.throws(() => assertWorldActionSchemaConformance(asPortable(unknownKeyword)), /unknown field description/i);
});

test("action schema rejects hidden or evaluator-private fields smuggled into public output", async () => {
  const value = mutableClone(await fixture());
  const first = schemaMembers(value)[0]!;
  payload(first).outputSchema.properties.privateEvidenceLocator = { type: "string" };
  assert.throws(() => assertWorldActionSchemaConformance(asPortable(value)), /evaluator-private schema property/i);
});

test("action schema contracts and payloads fail closed on unknown fields or versions", async () => {
  const wrongContract = mutableClone(await fixture());
  payload(schemaMembers(wrongContract)[0]!).contract = "woyengi.world-bundle.action-schema.v0.2";
  assert.throws(() => assertWorldActionSchemaConformance(asPortable(wrongContract)), /contract.*must equal/i);

  const extraField = mutableClone(await fixture());
  schemaMembers(extraField)[0]!.payload.unrecognized = true;
  assert.throws(() => assertWorldActionSchemaConformance(asPortable(extraField)), /unknown field unrecognized/i);
});

test("schema bytes are deterministic and participate in member and artifact identity", async () => {
  const original = await fixture();
  const reordered = portableInput(original);
  const reorderedMembers = reordered.members.map((member) => {
    if (member.kind !== WORLD_BUNDLE_ACTION_SCHEMA_KIND) return member;
    const record = JSON.parse(JSON.stringify(member)) as { payload: Record<string, unknown> } & typeof member;
    const input = (record.payload.inputSchema as { properties: Record<string, unknown> }).properties;
    (record.payload.inputSchema as { properties: Record<string, unknown> }).properties = Object.fromEntries(Object.entries(input).reverse());
    return record;
  });
  const normalized = createPortableWorldBundle({ bundle: reordered.bundle, members: reorderedMembers });
  assert.equal(normalized.artifactId, original.artifactId);
  assert.deepEqual(
    normalized.members.filter((member) => member.kind === WORLD_BUNDLE_ACTION_SCHEMA_KIND).map((member) => member.contentHash),
    original.members.filter((member) => member.kind === WORLD_BUNDLE_ACTION_SCHEMA_KIND).map((member) => member.contentHash),
  );

  const changedInput = portableInput(original);
  const changedMembers = changedInput.members.map((member) => {
    if (member.id !== "world-member:action-schema:activate-supplier") return member;
    const record = JSON.parse(JSON.stringify(member)) as { payload: Record<string, unknown> } & typeof member;
    const output = record.payload.outputSchema as { properties: Record<string, unknown> };
    output.properties.message = { type: "string" };
    return record;
  });
  const changed = createPortableWorldBundle({ bundle: changedInput.bundle, members: changedMembers });
  assert.notEqual(changed.artifactId, original.artifactId);
  assert.notEqual(
    changed.members.find((member) => member.id === "world-member:action-schema:activate-supplier")!.contentHash,
    original.members.find((member) => member.id === "world-member:action-schema:activate-supplier")!.contentHash,
  );
  assert.doesNotThrow(() => assertWorldActionSchemaConformance(changed));
});

test("public-only derivation preserves all public schemas and missing bindings fail closed", async () => {
  const original = await fixture();
  const publicArtifact = toPublicWorldBundleArtifact(original);
  const publicSchemas = publicArtifact.members.filter((member) => member.kind === WORLD_BUNDLE_ACTION_SCHEMA_KIND);
  assert.equal(publicSchemas.length, original.bundle.public.actionSurface.length);
  assert.doesNotThrow(() => assertWorldActionSchemaConformance(publicArtifact));
  assert.deepEqual(
    publicSchemas.map((member) => member.payload),
    original.members.filter((member) => member.kind === WORLD_BUNDLE_ACTION_SCHEMA_KIND).map((member) => member.payload),
  );

  const dropped = mutableClone(original);
  dropped.members = dropped.members.filter((member) => member.id !== "world-member:action-schema:inspect-supplier");
  assert.throws(() => assertWorldActionSchemaConformance(asPortable(dropped)), /has no ACTION_SCHEMA binding/i);
});
