import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

import { runCli } from "../src/index.ts";

test("replays, inspects, migrates, backs up, verifies, and restores a workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-cli-"));
  const workspace = join(root, "workspace");
  const restored = join(root, "restored");
  const replayPath = join(root, "replay.json");
  const archivePath = join(root, "workspace.woyengi-backup.json");
  await mkdir(join(workspace, "ledger"), { recursive: true });
  await mkdir(join(workspace, "objects"), { recursive: true });
  await mkdir(join(workspace, ".woyengi"), { recursive: true });
  await writeFile(
    join(workspace, "ledger", "records.json"),
    JSON.stringify([
      record("reconstruction:1", "reconstruction", "2026-03-03T00:00:00Z"),
      record("capability:1", "capability", "2026-03-02T00:00:00Z"),
      record("provenance:1", "provenance-node", "2026-03-01T00:00:00Z"),
      record("conflict:1", "conflict-set", "2026-03-04T00:00:00Z"),
    ]),
  );
  await writeFile(join(workspace, "objects", "source.txt"), "source material\n");
  await writeFile(
    join(workspace, ".woyengi", "workspace.json"),
    `${JSON.stringify({ schemaVersion: 1, workspaceId: "workspace:test" })}\n`,
  );

  await invoke(["replay", "--workspace", workspace, "--until", "2026-03-02T23:00:00Z", "--output", replayPath]);
  const replay = JSON.parse(await readFile(replayPath, "utf8"));
  assert.deepEqual(replay.records.map((item: { id: string }) => item.id), ["capability:1", "provenance:1"]);
  assert.deepEqual(replay.records.map((item: { ledgerSequence: number }) => item.ledgerSequence), [2, 3]);

  for (const [view, expected] of [
    ["provenance", "provenance:1"],
    ["conflicts", "conflict:1"],
    ["permissions", "capability:1"],
    ["reconstructions", "reconstruction:1"],
  ] as const) {
    const output = await invoke(["inspect", "--workspace", workspace, "--view", view]);
    assert.deepEqual(JSON.parse(output).records.map((item: { id: string }) => item.id), [expected]);
  }

  await invoke(["migrate", "--workspace", workspace, "--to", "2"]);
  assert.equal(JSON.parse(await readFile(join(workspace, ".woyengi", "workspace.json"), "utf8")).schemaVersion, 2);

  await invoke(["backup", "--workspace", workspace, "--output", archivePath]);
  const integrity = JSON.parse(await invoke(["integrity", "--archive", archivePath]));
  assert.deepEqual(integrity, { valid: true, entries: 3 });
  await invoke(["restore", "--archive", archivePath, "--workspace", restored]);

  assert.deepEqual(await snapshot(restored), await snapshot(workspace));
});

async function invoke(args: readonly string[]): Promise<string> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(args, {
    stdout: (value) => { stdout += value; },
    stderr: (value) => { stderr += value; },
  });
  assert.equal(exitCode, 0, stderr);
  return stdout;
}

function record(id: string, kind: string, from: string) {
  return { id, kind, transactionTime: { from } };
}

async function snapshot(root: string): Promise<Readonly<Record<string, string>>> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.push(path);
    }
  }
  await visit(root);
  const entries = await Promise.all(files.sort().map(async (path) => [relative(root, path), (await readFile(path)).toString("base64")] as const));
  return Object.fromEntries(entries);
}
