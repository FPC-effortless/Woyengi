import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ApplicationInstaller,
  defineApplicationPackage,
  readApplicationPackage,
  serializeApplicationPackage,
  writeApplicationPackage,
} from "../src/index.ts";

test("installs, exports, updates, and rolls back portable packages without crossing workspace boundaries", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-app-package-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const packagePath = join(root, "supplier-onboarding.woyengi.json");
  const version1 = defineApplicationPackage({
    id: "application-package:supplier-onboarding",
    name: "Supplier onboarding",
    version: "1.0.0",
    blueprintRef: "app-blueprint:supplier-onboarding-v1",
    dependencies: [{ id: "domain-package:suppliers", versionRange: ">=1.0.0 <2.0.0" }],
    surfaces: ["supplier:list", "supplier:detail"],
    activities: ["supplier:onboard", "supplier:approve"],
    capabilityRequirements: ["records.read", "records.write", "approval.request"],
    automations: ["automation:supplier-reminder"],
    procedures: ["procedure:supplier-review"],
    optionalAgents: ["agent-role:supplier-researcher"],
    authorityRequirements: ["authority:supplier-approver"],
    verificationContracts: ["verification:supplier-complete"],
    integrationRequirements: ["integration:company-registry"],
    runtimeRequirements: ["runtime:documents"],
    migrations: [],
    compatibility: {
      platformApi: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
      compatibleFromVersions: [],
    },
    provenance: ["app-intent:supplier-onboarding", "app-blueprint:supplier-onboarding-v1"],
    signature: { algorithm: "ed25519", keyId: "signer:woyengi", value: "signed-v1" },
  });

  const installer = new ApplicationInstaller({ platformApiVersion: "1.4.0" });
  const acmeConfig = { locale: "en-NG", reviewDays: 7 };
  const acme = installer.install(version1, {
    instanceId: "application-instance:acme-suppliers",
    workspaceId: "workspace:acme",
    semanticObjectBindings: { supplier: "workspace:acme/objects/supplier:shared" },
    roleBindings: { approver: "principal:acme-finance" },
    participantBindings: { owner: "principal:acme-owner" },
    integrationBindings: { registry: "integration-binding:acme-registry" },
    surfaceConfiguration: { default: "supplier:list" },
    configuration: acmeConfig,
    organizationOverlay: {
      id: "organization-overlay:acme-suppliers",
      basePackageId: version1.id,
      changes: { requireFinanceApproval: true },
    },
  });
  const beta = installer.install(version1, {
    instanceId: "application-instance:beta-suppliers",
    workspaceId: "workspace:beta",
    semanticObjectBindings: { supplier: "workspace:beta/objects/supplier:shared" },
    roleBindings: { approver: "principal:beta-owner" },
    participantBindings: { owner: "principal:beta-owner" },
    integrationBindings: {},
    surfaceConfiguration: { default: "supplier:detail" },
    configuration: { locale: "en-GB", reviewDays: 14 },
  });

  acmeConfig.reviewDays = 99;
  assert.equal(acme.configuration.reviewDays, 7);
  assert.equal(acme.packageId, version1.id);
  assert.equal(acme.packageVersion, "1.0.0");
  assert.equal(acme.semanticObjectBindings.supplier, "workspace:acme/objects/supplier:shared");
  assert.equal(beta.semanticObjectBindings.supplier, "workspace:beta/objects/supplier:shared");
  assert.notStrictEqual(acme.configuration, beta.configuration);
  assert.notStrictEqual(acme.semanticObjectBindings, beta.semanticObjectBindings);
  assert.equal(acme.organizationOverlay?.basePackageId, version1.id);
  assert.equal(Object.isFrozen(acme), true);
  assert.doesNotMatch(JSON.stringify(acme), /credential|password|secret|capabilityGrant/i);

  assert.throws(
    () => installer.install(version1, {
      instanceId: "application-instance:cross-workspace",
      workspaceId: "workspace:acme",
      semanticObjectBindings: { supplier: "workspace:beta/objects/supplier:other" },
      roleBindings: {}, participantBindings: {}, integrationBindings: {},
      surfaceConfiguration: {}, configuration: {},
    }),
    /cross-workspace semantic object binding/i,
  );

  await writeApplicationPackage(packagePath, version1);
  const serialized = serializeApplicationPackage(version1);
  assert.equal(await readFile(packagePath, "utf8"), serialized);
  assert.deepEqual(await readApplicationPackage(packagePath), version1);
  assert.equal(Object.isFrozen(await readApplicationPackage(packagePath)), true);
  await assert.rejects(
    writeApplicationPackage(join(root, "unsafe.json"), { ...version1, credentials: { apiKey: "secret" } } as never),
    /portable package cannot contain credentials/i,
  );
  const unsafePath = join(root, "unsafe-import.json");
  await writeFile(unsafePath, JSON.stringify({ ...version1, capabilityGrants: ["capability:all"] }), "utf8");
  await assert.rejects(readApplicationPackage(unsafePath), /portable package cannot contain capabilityGrants/i);

  const version2 = defineApplicationPackage({
    ...version1,
    version: "1.1.0",
    blueprintRef: "app-blueprint:supplier-onboarding-v2",
    migrations: [{ id: "migration:supplier-v1-v2", fromVersion: "1.0.0", toVersion: "1.1.0" }],
    compatibility: {
      platformApi: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
      compatibleFromVersions: ["1.0.0"],
    },
    signature: { algorithm: "ed25519", keyId: "signer:woyengi", value: "signed-v2" },
  });
  assert.throws(
    () => installer.update({ instanceId: acme.id, nextPackage: version2, completedMigrationIds: [] }),
    /required migration has not completed/i,
  );
  assert.equal(installer.get(acme.id)?.packageVersion, "1.0.0");
  const updated = installer.update({
    instanceId: acme.id,
    nextPackage: version2,
    completedMigrationIds: ["migration:supplier-v1-v2"],
  });
  assert.equal(updated.packageVersion, "1.1.0");
  assert.equal(updated.blueprintRef, "app-blueprint:supplier-onboarding-v2");
  assert.equal(updated.organizationOverlay?.id, "organization-overlay:acme-suppliers");
  assert.equal(updated.semanticObjectBindings.supplier, "workspace:acme/objects/supplier:shared");
  const rolledBack = installer.rollback(acme.id);
  assert.equal(rolledBack.packageVersion, "1.0.0");
  assert.equal(rolledBack.blueprintRef, "app-blueprint:supplier-onboarding-v1");
  assert.equal(rolledBack.organizationOverlay?.basePackageId, version1.id);

  const incompatible = defineApplicationPackage({
    ...version2,
    version: "2.0.0",
    blueprintRef: "app-blueprint:supplier-onboarding-v3",
    migrations: [],
    compatibility: {
      platformApi: { minInclusive: "2.0.0", maxExclusive: "3.0.0" },
      compatibleFromVersions: ["1.0.0"],
    },
  });
  assert.throws(
    () => installer.update({ instanceId: acme.id, nextPackage: incompatible, completedMigrationIds: [] }),
    /incompatible with Platform API/i,
  );
  assert.equal(installer.get(acme.id)?.packageVersion, "1.0.0");
});
