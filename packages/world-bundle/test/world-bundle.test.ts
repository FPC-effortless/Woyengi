import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  createPortableWorldBundle,
  parsePortableWorldBundle,
  resolvePrivateEvaluatorMember,
  resolvePublicMember,
  serializePortableWorldBundle,
  serializePublicWorldBundleArtifact,
  toPublicWorldBundleArtifact,
  verifyPublicWorldBundleConformance,
  verifyWorldBundleConformance,
  type PortableWorldBundleInput,
  type WorldBundleConformanceCode,
} from "../src/index.ts";

function makeInput(): PortableWorldBundleInput {
  return {
    bundle: {
      id: "world-bundle:supplier-onboarding:test",
      version: "0.1.0",
      sourceSpecRef: "operational-system-spec:supplier-onboarding",
      sourceSpecVersion: "0.1.0",
      compatibility: { minimumRuntimeVersion: "0.1.0" },
      public: {
        objective: "Activate a supplier only after verified finance approval.",
        actorRoles: ["supplier-operator", "finance-approver"],
        actionSurface: [
          { id: "world-action:request-approval", name: "request_approval", kind: "WRITE", systemRef: "system:approval-workflow", parameterNames: ["supplier_id", "requested_role"], cost: { amount: 1, currency: "USD" } },
          { id: "world-action:activate-supplier", name: "activate_supplier", kind: "EXECUTE", systemRef: "system:supplier-records", parameterNames: ["supplier_id"], cost: { amount: 3, currency: "USD" } },
        ],
        observationRefs: ["observation:supplier-public"],
        assetDescriptors: [
          { id: "world-asset:supplier-record", kind: "JSON_DOCUMENT", format: "application/json", contentHash: "sha256:public-record" },
        ],
        outcomeContractRefs: ["outcome-contract:supplier-activated"],
        provenanceRefs: ["provenance:test", "operational-system-spec:supplier-onboarding"],
      },
      privateEvaluator: {
        targetAssertionRefs: ["target-assertion:supplier-active"],
        invariantRefs: ["evaluator-invariant:approval-ledger-consistency"],
        hiddenEffectRefs: ["hidden-effect:approval-transition"],
        evidenceLocatorRefs: ["evaluator-evidence:approval-ledger"],
      },
      partitionManifest: [
        { id: "world-member:public-semantics", partition: "public", kind: "SEMANTIC_TASK" },
        { id: "world-member:private-evaluator", partition: "private-evaluator", kind: "EVALUATOR_ORACLE" },
      ],
      provenanceRefs: ["provenance:test", "operational-system-spec:supplier-onboarding"],
    },
    members: [
      {
        id: "world-member:public-semantics",
        partition: "public",
        kind: "SEMANTIC_TASK",
        payload: {
          objective: "Activate a supplier only after verified finance approval.",
          evidenceRequirements: ["evidence:approval-decision"],
          budget: { maximumCost: 20, currency: "USD", maximumAttempts: 3 },
        },
      },
      {
        id: "world-member:private-evaluator",
        partition: "private-evaluator",
        kind: "EVALUATOR_ORACLE",
        payload: {
          targetAnswer: "active",
          hiddenEffect: "approval-transition-token",
          privateEvidenceLocator: "private://approval-ledger/supplier-42",
        },
      },
    ],
  };
}

function expectCode(action: () => unknown, code: WorldBundleConformanceCode): void {
  assert.throws(action, (error: unknown) => {
    if (typeof error !== "object" || error === null || !("code" in error)) return false;
    return error.code === code;
  });
}

test("normalizes equivalent inputs into the same serialized artifact and content-bound identity", () => {
  const firstInput = makeInput();
  const first = createPortableWorldBundle(firstInput);
  const second = createPortableWorldBundle({
    bundle: {
      ...firstInput.bundle,
      public: {
        ...firstInput.bundle.public,
        actorRoles: [...firstInput.bundle.public.actorRoles].reverse(),
        actionSurface: [...firstInput.bundle.public.actionSurface].reverse(),
        provenanceRefs: [...firstInput.bundle.public.provenanceRefs].reverse(),
      },
      privateEvaluator: {
        targetAssertionRefs: [...firstInput.bundle.privateEvaluator!.targetAssertionRefs].reverse(),
        invariantRefs: [...firstInput.bundle.privateEvaluator!.invariantRefs].reverse(),
        hiddenEffectRefs: [...firstInput.bundle.privateEvaluator!.hiddenEffectRefs].reverse(),
        evidenceLocatorRefs: [...firstInput.bundle.privateEvaluator!.evidenceLocatorRefs].reverse(),
      },
      partitionManifest: [...firstInput.bundle.partitionManifest].reverse(),
      provenanceRefs: [...firstInput.bundle.provenanceRefs].reverse(),
    },
    members: [...firstInput.members].reverse(),
  });

  assert.equal(first.artifactId, second.artifactId);
  assert.equal(serializePortableWorldBundle(first), serializePortableWorldBundle(second));
  assert.match(first.members[0]!.contentHash, /^sha256:[0-9a-f]{64}$/);
});

test("public export strips private evaluator metadata, private members, private hashes, and private byte resolution", () => {
  const full = createPortableWorldBundle(makeInput());
  const privateMember = resolvePrivateEvaluatorMember(full, "world-member:private-evaluator");
  assert.equal(privateMember?.partition, "private-evaluator");

  const publicArtifact = toPublicWorldBundleArtifact(full);
  const serialized = serializePublicWorldBundleArtifact(publicArtifact);

  assert.equal(publicArtifact.bundle.privateEvaluator, undefined);
  assert.deepEqual(publicArtifact.bundle.partitionManifest.map((member) => member.partition), ["public"]);
  assert.equal(resolvePublicMember(publicArtifact, "world-member:private-evaluator"), undefined);
  assert.equal(serialized.includes("world-member:private-evaluator"), false);
  assert.equal(serialized.includes("target-assertion:supplier-active"), false);
  assert.equal(serialized.includes("approval-transition-token"), false);
  assert.equal(serialized.includes("private://approval-ledger/supplier-42"), false);
  assert.equal(serialized.includes(privateMember!.contentHash), false);
  assert.equal(verifyPublicWorldBundleConformance(publicArtifact).conformant, true);
});

test("partition validation fails closed on missing, undeclared, duplicate, and mismatched members", () => {
  const input = makeInput();

  expectCode(() => createPortableWorldBundle({
    bundle: input.bundle,
    members: input.members.filter((member) => member.partition === "public"),
  }), "MISSING_MANIFEST_MEMBER");

  expectCode(() => createPortableWorldBundle({
    bundle: input.bundle,
    members: [...input.members, { id: "world-member:extra", partition: "public", kind: "SEMANTIC_TASK", payload: { extra: true } }],
  }), "UNDECLARED_MEMBER");

  expectCode(() => createPortableWorldBundle({
    bundle: input.bundle,
    members: [...input.members, input.members[0]!],
  }), "DUPLICATE_MEMBER");

  expectCode(() => createPortableWorldBundle({
    bundle: input.bundle,
    members: input.members.map((member) => member.id === "world-member:public-semantics"
      ? { ...member, partition: "private-evaluator" as const }
      : member),
  }), "PARTITION_MISMATCH");

  expectCode(() => createPortableWorldBundle({
    bundle: {
      ...input.bundle,
      partitionManifest: input.bundle.partitionManifest.filter((member) => member.partition === "public"),
    },
    members: input.members.filter((member) => member.partition === "public"),
  }), "PRIVATE_PARTITION_UNMATERIALIZED");
});

test("conformance verifier detects member and artifact tampering and enforces runtime compatibility", () => {
  const artifact = createPortableWorldBundle(makeInput());
  const memberTamper = JSON.parse(JSON.stringify(artifact)) as { members: Array<{ payload: { objective?: string } }> };
  memberTamper.members[1]!.payload.objective = "tampered";
  assert.equal(verifyWorldBundleConformance(memberTamper).errors[0]?.code, "MEMBER_HASH_MISMATCH");

  const idTamper = JSON.parse(JSON.stringify(artifact)) as { artifactId: string };
  idTamper.artifactId = "world-bundle-artifact:sha256:0000000000000000000000000000000000000000000000000000000000000000";
  assert.equal(verifyWorldBundleConformance(idTamper).errors[0]?.code, "ARTIFACT_ID_MISMATCH");

  assert.equal(verifyWorldBundleConformance(artifact, { runtimeVersion: "0.0.9" }).errors[0]?.code, "INCOMPATIBLE_RUNTIME");
  assert.equal(verifyWorldBundleConformance(artifact, { runtimeVersion: "0.1.0" }).conformant, true);
});

test("adversarial leakage fixtures are rejected with stable failure codes", async () => {
  const files = [
    "public-target-answer.json",
    "public-hidden-effect.json",
    "public-private-evidence-locator.json",
    "public-private-byte-locator.json",
    "public-private-reference.json",
  ];

  for (const file of files) {
    const fixture = JSON.parse(await readFile(new URL(`../fixtures/adversarial/${file}`, import.meta.url), "utf8")) as {
      expectedCode: WorldBundleConformanceCode;
      member: PortableWorldBundleInput["members"][number];
    };
    const input = makeInput();
    expectCode(() => createPortableWorldBundle({
      bundle: input.bundle,
      members: input.members.map((member) => member.id === "world-member:public-semantics" ? fixture.member : member),
    }), fixture.expectedCode);
  }
});

test("pinned Veritas adapter fixture is canonical and byte-hash pinned", async () => {
  const fixtureUrl = new URL("../fixtures/veritas-adapter-v0.1.json", import.meta.url);
  const hashUrl = new URL("../fixtures/veritas-adapter-v0.1.sha256", import.meta.url);
  const serialized = await readFile(fixtureUrl, "utf8");
  const expectedHashLine = (await readFile(hashUrl, "utf8")).trim();
  const expectedHash = expectedHashLine.split(/\s+/)[0]!;
  const actualHash = createHash("sha256").update(serialized, "utf8").digest("hex");
  const fixture = parsePortableWorldBundle(serialized);

  assert.equal(fixture.artifactId, "world-bundle-artifact:sha256:62b94e85103ef8522ef9eb87f1a6825b2e98fca36fbd57b5aadce06e0f5ab719");
  assert.equal(actualHash, "3577aa29266dac59921c31e65d22ad657c4b7a9191011e9f5448aed32781e10b");
  assert.equal(actualHash, expectedHash);
  assert.equal(serializePortableWorldBundle(fixture), serialized);
});
