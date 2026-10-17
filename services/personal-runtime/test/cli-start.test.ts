import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { defineApplicationPackage, writeApplicationPackage } from "../../../packages/apps/src/index.ts";
import type { CliIo } from "../../../packages/cli/src/index.ts";
import { runWoyengiCli } from "../src/cli.ts";

async function run(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (value) => { stdout += value; },
    stderr: (value) => { stderr += value; },
  };
  const code = await runWoyengiCli(args, io);
  return { code, stdout, stderr };
}

test("woyengi start explicitly seeds an offline Personal Workspace and reopens without the source package", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-cli-start-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const packageDirectory = join(root, "package");
  const workspaceDirectory = join(root, "personal-state");

  await writeApplicationPackage(join(packageDirectory, "application-package.json"), defineApplicationPackage({
    id: "application-package:offline-inbox",
    name: "Offline inbox",
    version: "1.0.0",
    blueprintRef: "app-blueprint:offline-inbox",
    dependencies: [],
    surfaces: ["inbox"],
    activities: ["review"],
    capabilityRequirements: [],
    automations: [],
    procedures: [],
    optionalAgents: [],
    authorityRequirements: [],
    verificationContracts: [],
    integrationRequirements: [],
    runtimeRequirements: ["runtime:local"],
    migrations: [],
    compatibility: {
      platformApi: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
      compatibleFromVersions: [],
    },
    provenance: ["app-intent:offline-inbox"],
    signature: { algorithm: "ed25519", keyId: "signer:local", value: "fixture-signature" },
  }));

  const seeded = await run(["start", "--workspace", workspaceDirectory, "--package", packageDirectory]);
  assert.equal(seeded.code, 0, seeded.stderr);
  const created = JSON.parse(seeded.stdout);
  assert.equal(created.command, "start");
  assert.equal(created.mode, "seeded");
  assert.equal(created.workspaceId, "workspace:local");
  assert.equal(created.applicationId, "application-instance:offline-inbox");
  assert.equal(created.packageId, "application-package:offline-inbox");
  assert.equal(created.evidence.dependencies.networkAccess, "not-used");
  assert.equal(created.evidence.checks.length, 4);

  const duplicate = await run(["start", "--workspace", workspaceDirectory, "--package", packageDirectory]);
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.stderr, /already seeded/);

  // The persistent ledger and content-addressed object must be enough to reopen.
  await rm(packageDirectory, { recursive: true });
  const reopened = await run(["start", "--workspace", workspaceDirectory]);
  assert.equal(reopened.code, 0, reopened.stderr);
  const current = JSON.parse(reopened.stdout);
  assert.equal(current.mode, "reopened");
  assert.equal(current.workspaceId, created.workspaceId);
  assert.equal(current.applicationId, created.applicationId);
  assert.equal(current.evidence.stateContentHash, created.evidence.stateContentHash);
  assert.equal(current.evidence.dependencies.networkAccess, "not-used");

  const unseeded = await run(["start", "--workspace", join(root, "other-state")]);
  assert.equal(unseeded.code, 1);
  assert.match(unseeded.stderr, /not seeded/);
});

test("woyengi start rejects unsafe owner identifiers rather than changing persistent state", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-cli-start-reject-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const result = await run([
    "start", "--workspace", join(root, "state"), "--package", join(root, "package"), "--owner", "../admin",
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /owner.*slug/);
  assert.equal(result.stdout, "");
});
