import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { defineApplicationPackage, writeApplicationPackage } from "../../../packages/apps/src/index.ts";
import { openPersonalRuntime, seedPersonalRuntime } from "../index.ts";

test("starts a seeded Personal Workspace offline, installs from a directory, and reopens durable local state", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-personal-runtime-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const applicationPackageDirectory = join(root, "packages", "personal-inbox");
  const localStateDirectory = join(root, "state");
  const applicationPackage = defineApplicationPackage({
    id: "application-package:personal-inbox",
    name: "Personal inbox",
    version: "1.0.0",
    blueprintRef: "app-blueprint:personal-inbox-v1",
    dependencies: [],
    surfaces: ["inbox:list"],
    activities: ["inbox:triage"],
    capabilityRequirements: ["inbox.read"],
    automations: [],
    procedures: [],
    optionalAgents: [],
    authorityRequirements: ["authority:personal-owner"],
    verificationContracts: [],
    integrationRequirements: [],
    runtimeRequirements: ["runtime:local"],
    migrations: [],
    compatibility: {
      platformApi: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
      compatibleFromVersions: [],
    },
    provenance: ["app-intent:personal-inbox", "app-blueprint:personal-inbox-v1"],
    signature: { algorithm: "ed25519", keyId: "signer:local-owner", value: "signed-personal-v1" },
  });
  await writeApplicationPackage(
    join(applicationPackageDirectory, "application-package.json"),
    applicationPackage,
  );

  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = async () => {
    networkRequests += 1;
    throw new Error("offline personal startup attempted a network request");
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const seeded = await seedPersonalRuntime({
    localStateDirectory,
    applicationPackageDirectory,
    platformApiVersion: "1.4.0",
    startedAt: "2026-08-22T15:00:00Z",
    owner: {
      principalId: "principal:personal-owner",
      accountId: "account:personal-owner",
      workspaceId: "workspace:personal-owner",
    },
    installation: {
      instanceId: "application-instance:personal-inbox",
      semanticObjectBindings: {
        inbox: "workspace:personal-owner/objects/inbox:primary",
      },
      roleBindings: { owner: "principal:personal-owner" },
      participantBindings: { owner: "principal:personal-owner" },
      integrationBindings: {},
      surfaceConfiguration: { default: "inbox:list" },
      configuration: { locale: "en-NG" },
    },
  });

  assert.deepEqual(seeded.workspace, {
    id: "workspace:personal-owner",
    kind: "personal",
    accountId: "account:personal-owner",
  });
  assert.equal(seeded.application.packageId, applicationPackage.id);
  assert.equal(seeded.application.workspaceId, seeded.workspace.id);
  assert.equal(seeded.evidence.mode, "seeded");
  assert.deepEqual(seeded.evidence.dependencies, {
    networkAccess: "not-used",
    woyengiOperatedServices: [],
  });
  assert.deepEqual(seeded.evidence.checks.map((check) => check.kind), [
    "personal-workspace",
    "filesystem-application-package",
    "durable-local-ledger",
    "durable-local-object",
  ]);
  assert.ok(seeded.evidence.checks.every((check) => check.outcome === "passed"));
  assert.match(seeded.evidence.stateContentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(networkRequests, 0);

  await rm(applicationPackageDirectory, { recursive: true });
  const reopened = await openPersonalRuntime({
    localStateDirectory,
    startedAt: "2026-08-22T16:00:00Z",
  });

  assert.deepEqual(reopened.workspace, seeded.workspace);
  assert.deepEqual(reopened.workspaceContext, seeded.workspaceContext);
  assert.deepEqual(reopened.application, seeded.application);
  assert.equal(reopened.evidence.mode, "reopened");
  assert.equal(reopened.evidence.stateContentHash, seeded.evidence.stateContentHash);
  assert.deepEqual(reopened.evidence.dependencies, seeded.evidence.dependencies);
  assert.equal(networkRequests, 0);
});
