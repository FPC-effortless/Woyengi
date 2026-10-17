import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DurableWorkspaceJournal, DurableWorkJournal } from "../../durable-work/index.ts";
import { DurablePrincipalSessions } from "../src/durable-sessions.ts";
import { SelfHostWorkApi } from "../src/index.ts";

const token = "session_" + "F".repeat(48);
const otherToken = "session_" + "G".repeat(48);
const now = "2026-10-17T18:00:00Z";
const expiresAt = "2026-10-18T18:00:00Z";

test("durable principal sessions authenticate HTTP across restart, reject duplication and stay revoked", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-durable-sessions-"));
  const path = join(root, "sessions.json");
  let clock = Date.parse(now);
  const workspace = await DurableWorkspaceJournal.open({ ledgerPath: join(root, "workspace.json") });
  const owner = await workspace.registerPrincipal({ operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt: now });
  const other = await workspace.registerPrincipal({ operationId: "workspace-operation:other", id: "principal:other", kind: "human", recordedAt: now });
  const agent = await workspace.registerPrincipal({ operationId: "workspace-operation:agent", id: "principal:agent", kind: "agent", recordedAt: now });
  await workspace.createAccount({ operationId: "workspace-operation:account", id: "account:owner", ownerPrincipalId: owner.id, personalWorkspaceId: "workspace:owner", recordedAt: now });
  const work = await DurableWorkJournal.open({ ledgerPath: join(root, "work.json"), workspaces: () => workspace.snapshot() });
  let sessions = await DurablePrincipalSessions.open({ ledgerPath: path, workspaces: workspace, now: () => clock });
  let server: Awaited<ReturnType<SelfHostWorkApi["listen"]>> | undefined;
  t.after(async () => {
    await server?.close();
    await sessions.close();
    await work.close();
    await workspace.close();
    await rm(root, { recursive: true, force: true });
  });
  const access = () => fetch(`${server?.url}/v1/workspaces/workspace%3Aowner`, { headers: { authorization: `Bearer ${token}` } });

  assert.equal(sessions.resolve(`Bearer ${token}`), undefined);
  await assert.rejects(DurablePrincipalSessions.open({ ledgerPath: path, workspaces: workspace }), /writer lock/);
  await assert.rejects(sessions.provision({ operationId: "session-operation:agent", sessionId: "session:agent", principalId: agent.id, token, expiresAt, recordedAt: now }), /human/);
  await assert.rejects(sessions.provision({ operationId: "session-operation:unknown", sessionId: "session:unknown", principalId: "principal:unknown", token, expiresAt, recordedAt: now }), /registered/);
  const issued = await sessions.provision({ operationId: "session-operation:issue", sessionId: "session:owner", principalId: owner.id, token, expiresAt, recordedAt: now });
  assert.deepEqual(issued, { sessionId: "session:owner", principalId: owner.id, expiresAt });
  assert.deepEqual(sessions.resolve(`Bearer ${token}`), { id: owner.id });
  assert.equal(sessions.resolve(`Bearer ${token} bad`), undefined);
  assert.equal(sessions.resolve(`Bearer ${token.slice(0, -1)}0`), undefined);
  assert.equal(sessions.resolve(`Basic ${token}`), undefined);
  assert.equal(sessions.resolve(undefined), undefined);
  await assert.rejects(sessions.provision({ operationId: "session-operation:duplicate-token", sessionId: "session:other", principalId: other.id, token, expiresAt, recordedAt: now }), /duplicate/);
  assert.equal(sessions.history().length, 1);
  const bytes = await readFile(path, "utf8");
  assert.equal(bytes.includes(token), false);
  assert.match(bytes, /sha256:[a-f0-9]{64}/);
  assert.equal(bytes.includes("token\""), false);

  server = await new SelfHostWorkApi({ workspaces: workspace, work, sessions }).listen({ hostname: "127.0.0.1", port: 0 });
  assert.equal((await access()).status, 200);
  await server.close();
  server = undefined;
  await sessions.close();
  sessions = await DurablePrincipalSessions.open({ ledgerPath: path, workspaces: workspace, now: () => clock });
  server = await new SelfHostWorkApi({ workspaces: workspace, work, sessions }).listen({ hostname: "127.0.0.1", port: 0 });
  assert.equal((await access()).status, 200);
  await sessions.revoke({ operationId: "session-operation:revoke", sessionId: "session:owner", recordedAt: now });
  assert.equal((await access()).status, 401);
  assert.equal(sessions.resolve(`Bearer ${token}`), undefined);
  await assert.rejects(sessions.provision({ operationId: "session-operation:reissue", sessionId: "session:reissued", principalId: owner.id, token, expiresAt, recordedAt: now }), /duplicate/);

  await server.close();
  server = undefined;
  await sessions.close();
  sessions = await DurablePrincipalSessions.open({ ledgerPath: path, workspaces: workspace, now: () => clock });
  server = await new SelfHostWorkApi({ workspaces: workspace, work, sessions }).listen({ hostname: "127.0.0.1", port: 0 });
  assert.equal((await access()).status, 401);
  assert.deepEqual(sessions.history().map((op) => op.kind), ["session.issued", "session.revoked"]);
  assert.deepEqual(sessions.history().map((op) => op.ledgerSequence), [1, 2]);

  await sessions.provision({ operationId: "session-operation:issue-other", sessionId: "session:new", principalId: owner.id, token: otherToken, expiresAt, recordedAt: now });
  assert.equal(sessions.resolve(`Bearer ${otherToken}`)?.id, owner.id);
  clock = Date.parse(expiresAt);
  assert.equal(sessions.resolve(`Bearer ${otherToken}`), undefined);
});

test("durable sessions fail closed on corruption, replay injection, duplicate IDs and concurrent invalid writes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-session-validation-"));
  const path = join(root, "sessions.json");
  const workspace = await DurableWorkspaceJournal.open({ ledgerPath: join(root, "workspace.json") });
  const human = await workspace.registerPrincipal({ operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt: now });
  t.after(async () => { await workspace.close(); await rm(root, { recursive: true, force: true }); });

  let sessions = await DurablePrincipalSessions.open({ ledgerPath: path, workspaces: workspace });
  const tryProvision = (operationId: string, sessionId: string) =>
    sessions.provision({ operationId, sessionId, principalId: human.id, token, expiresAt, recordedAt: now });
  const settled = await Promise.allSettled([
    tryProvision("session-operation:one", "session:one"),
    tryProvision("session-operation:two", "session:two"),
  ]);
  assert.deepEqual(settled.map((entry) => entry.status), ["fulfilled", "rejected"]);
  assert.equal(sessions.history().length, 1);
  await assert.rejects(sessions.revoke({ operationId: "session-operation:nonexistent", sessionId: "session:missing", recordedAt: now }), /does not exist/);
  assert.equal(sessions.history().length, 1);
  await sessions.close();
  await assert.rejects(tryProvision("session-operation:closed", "session:closed"), /closed/);

  await writeFile(path, "{bad", "utf8");
  await assert.rejects(DurablePrincipalSessions.open({ ledgerPath: path, workspaces: workspace }), /JSON|parse|Unexpected|position/i);
  const bogus = [{ id: "session-operation:fake", kind: "session.admin-elevated", ledgerSequence: 1, transactionTime: { from: now } }];
  await writeFile(path, JSON.stringify(bogus), "utf8");
  await assert.rejects(DurablePrincipalSessions.open({ ledgerPath: path, workspaces: workspace }), /unsupported session operation kind/);
  const injected = [{ id: "session-operation:fake", kind: "session.issued", ledgerSequence: 1, sessionId: "session:fake", principalId: human.id, tokenDigest: "sha256:"+"a".repeat(64), expiresAt, token, transactionTime: { from: now } }];
  await writeFile(path, JSON.stringify(injected), "utf8");
  await assert.rejects(DurablePrincipalSessions.open({ ledgerPath: path, workspaces: workspace }), /unknown session operation field/);
});
