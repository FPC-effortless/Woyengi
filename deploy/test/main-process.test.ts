import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("boots the deployed API entrypoint and exercises ingest, state, and reconstruct", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "woyengi-main-"));
  const token = "test-token-at-least-16-characters";
  const child = spawn(process.execPath, ["services/platform-api/src/main.ts"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, WOYENGI_API_TOKEN: token, WOYENGI_DATA_DIR: dataDirectory, WOYENGI_HOST: "127.0.0.1", WOYENGI_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { errors += chunk; });
  try {
    const url = await listeningUrl(child.stdout);
    assert.equal((await fetch(`${url}/readyz`)).status, 200);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": "ingest:deployment-e2e" };
    const ingest = await fetch(`${url}/v1/ingest`, { method: "POST", headers, body: JSON.stringify({ id: "claim:deployment-e2e", kind: "claim", subject: "entity:alpha", transactionTime: { from: "2026-08-14T00:00:00Z" } }) });
    assert.equal(ingest.status, 200, await ingest.text());
    const state = await fetch(`${url}/v1/state/entities/${encodeURIComponent("entity:alpha")}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(state.status, 200);
    assert.equal(((await state.json()) as any).data.records[0].id, "claim:deployment-e2e");
    const reconstruction = await fetch(`${url}/v1/reconstruct`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ request: "explain alpha", subject: "entity:alpha" }) });
    assert.equal(reconstruction.status, 200);
    assert.deepEqual(((await reconstruction.json()) as any).data.provenanceManifest, ["claim:deployment-e2e"]);
  } finally {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) await exited;
  }
  assert.equal(errors, "");
  const records = JSON.parse(await readFile(join(dataDirectory, "ledger", "records.json"), "utf8"));
  assert.equal(records[0].id, "claim:deployment-e2e");
});

async function listeningUrl(stream: NodeJS.ReadableStream): Promise<string> {
  stream.setEncoding("utf8");
  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Platform API did not start")), 10_000);
    stream.on("data", (chunk: string) => {
      const match = /listening on (http:\/\/[^\s]+)/.exec(chunk);
      if (match !== null) { clearTimeout(timer); resolve(match[1] as string); }
    });
  });
}
