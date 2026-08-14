import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("boots the deployed API entrypoint and exercises ingest, state, and reconstruct", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "woyengi-main-"));
  const token = `test-${"x".repeat(32)}`;
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
    const governingClaim = claim("claim:deployment-e2e", "October", 90, "2026-08-14T00:00:00Z");
    const ingest = await fetch(`${url}/v1/ingest`, { method: "POST", headers, body: JSON.stringify(governingClaim) });
    assert.equal(ingest.status, 200, await ingest.text());
    const duplicate = await fetch(`${url}/v1/ingest`, { method: "POST", headers, body: JSON.stringify(governingClaim) });
    assert.equal(duplicate.status, 200);
    assert.deepEqual((await duplicate.json()).data.accepted, ["claim:deployment-e2e"]);
    const conflictingKey = await fetch(`${url}/v1/ingest`, { method: "POST", headers, body: JSON.stringify(claim("claim:different", "September", 20, "2026-08-14T00:00:01Z")) });
    assert.equal(conflictingKey.status, 409);
    const lowerClaim = await fetch(`${url}/v1/ingest`, { method: "POST", headers: { ...headers, "idempotency-key": "ingest:lower-authority" }, body: JSON.stringify(claim("claim:lower-authority", "September", 20, "2026-08-14T00:00:01Z")) });
    assert.equal(lowerClaim.status, 200);
    const state = await fetch(`${url}/v1/state/entities/${encodeURIComponent("entity:alpha")}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(state.status, 200);
    const projected = (await state.json()) as any;
    assert.equal(projected.data.projections[0].selected.claim.id, "claim:deployment-e2e");
    assert.deepEqual(projected.data.projections[0].conflicts.map((item: any) => item.claim.id), ["claim:lower-authority"]);
    const reconstruction = await fetch(`${url}/v1/reconstruct`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ request: "explain alpha", subject: "entity:alpha" }) });
    assert.equal(reconstruction.status, 200);
    const workspace = (await reconstruction.json()) as any;
    assert.deepEqual(workspace.data.provenanceManifest, ["claim:deployment-e2e", "claim:lower-authority"]);
    assert.equal(workspace.data.contradictions[0].id, "claim:lower-authority");
    const retractHeaders = { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": "control:retract-governing" };
    const retractBody = { id: "lifecycle:retract-deployment", targetId: "claim:deployment-e2e", reason: "Decision changed", recordedAt: "2026-08-14T00:02:00Z" };
    const retract = await fetch(`${url}/v1/control/retract`, { method: "POST", headers: retractHeaders, body: JSON.stringify(retractBody) });
    assert.equal(retract.status, 200);
    const retractDuplicate = await fetch(`${url}/v1/control/retract`, { method: "POST", headers: retractHeaders, body: JSON.stringify(retractBody) });
    assert.equal(retractDuplicate.status, 200);
    const changedState = await fetch(`${url}/v1/state/entities/${encodeURIComponent("entity:alpha")}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(((await changedState.json()) as any).data.projections[0].selected.claim.id, "claim:lower-authority");
    const beforeRetraction = await fetch(`${url}/v1/state/entities/${encodeURIComponent("entity:alpha")}?validAt=${encodeURIComponent("2026-06-01T00:00:00Z")}&recordedAt=${encodeURIComponent("2026-08-14T00:01:30Z")}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(((await beforeRetraction.json()) as any).data.projections[0].selected.claim.id, "claim:deployment-e2e");
    const historicalReconstruction = await fetch(`${url}/v1/reconstruct`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ request: "What did we believe?", subject: "entity:alpha", validAt: "2026-06-01T00:00:00Z", recordedAt: "2026-08-14T00:01:30Z" }) });
    assert.equal(((await historicalReconstruction.json()) as any).data.currentState[0].id, "claim:deployment-e2e");
    const subscription = await fetch(`${url}/v1/subscriptions/${encodeURIComponent("subscription:all")}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(subscription.status, 200);
    assert.equal(((await subscription.json()) as any).data.events[0].aggregateId, "claim:deployment-e2e");
  } finally {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) await exited;
  }
  assert.equal(errors, "");
  const records = JSON.parse(await readFile(join(dataDirectory, "ledger", "records.json"), "utf8"));
  assert.equal(records.find((record: { id: string }) => record.id === "claim:deployment-e2e")?.kind, "claim");
});

function claim(id: string, value: string, authority: number, recordedAt: string) {
  return {
    id, kind: "claim", subject: "entity:alpha", predicate: "project:launch-month", object: value,
    validTime: { from: "2026-01-01T00:00:00Z" }, transactionTime: { from: recordedAt },
    observationIds: [], evidenceIds: [], provenance: { derivedFrom: [], transformations: [] },
    authority: { level: authority, basis: authority > 50 ? "approved decision" : "discussion" },
    confidence: authority > 50 ? 0.9 : 0.99, lifecycle: "verified",
  };
}

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
