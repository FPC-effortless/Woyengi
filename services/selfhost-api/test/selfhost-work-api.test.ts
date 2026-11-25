import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DurableWorkspaceJournal, DurableWorkJournal } from "../../durable-work/index.ts";
import { BoundPrincipalSessions, SelfHostWorkApi } from "../src/index.ts";

const recordedAt = "2026-10-17T09:00:00Z";
const ownerToken = "owner-" + "a".repeat(48);
const reviewerToken = "reviewer-" + "b".repeat(48);
const outsiderToken = "outsider-" + "c".repeat(48);
const agentToken = "agent-" + "d".repeat(48);

test("serves scoped Work HTTP for two verified humans and rejects spoofing, stale writes, and outsider reads", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-selfhost-http-"));
  const workspacePath = join(root, "workspace-operations.json");
  const workPath = join(root, "work-operations.json");
  const workspace = await DurableWorkspaceJournal.open({ ledgerPath: workspacePath });
  const owner = await workspace.registerPrincipal({
    operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt,
  });
  const reviewer = await workspace.registerPrincipal({
    operationId: "workspace-operation:reviewer", id: "principal:reviewer", kind: "human", recordedAt,
  });
  const outsider = await workspace.registerPrincipal({
    operationId: "workspace-operation:outsider", id: "principal:outsider", kind: "human", recordedAt,
  });
  const agent = await workspace.registerPrincipal({
    operationId: "workspace-operation:agent", id: "principal:agent", kind: "agent", recordedAt,
  });
  const organization = await workspace.createOrganization({
    operationId: "workspace-operation:org", id: "organization:team", workspaceId: "workspace:team",
    ownerMembershipId: "membership:owner", ownerPrincipalId: owner.id, recordedAt,
  });
  const invitation = await workspace.inviteMember({
    operationId: "workspace-operation:reviewer-invite", id: "membership:reviewer",
    organizationId: organization.organization.id, principalId: reviewer.id,
    invitedByPrincipalId: owner.id, recordedAt,
  });
  const work = await DurableWorkJournal.open({ ledgerPath: workPath, workspaces: () => workspace.snapshot() });
  const sessions = new BoundPrincipalSessions([
    { principalId: owner.id, token: ownerToken },
    { principalId: reviewer.id, token: reviewerToken },
    { principalId: outsider.id, token: outsiderToken },
    { principalId: agent.id, token: agentToken },
  ]);
  const api = new SelfHostWorkApi({ workspaces: workspace, work, sessions });
  const server = await api.listen({ hostname: "127.0.0.1", port: 0 });
  let serverClosed = false;
  let reloadedWorkspace: DurableWorkspaceJournal | undefined;
  let reloadedWork: DurableWorkJournal | undefined;
  t.after(async () => {
    await reloadedWork?.close();
    await reloadedWorkspace?.close();
    if (!serverClosed) await server.close();
    await work.close();
    await workspace.close();
    await rm(root, { recursive: true, force: true });
  });

  const url = `${server.url}/v1/workspaces/${encodeURIComponent(organization.workspace.id)}`;
  const auth = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
  const workspaceBefore = await fetch(url, { headers: auth(reviewerToken) });
  assert.equal(workspaceBefore.status, 403);

  await workspace.acceptInvitation({
    operationId: "workspace-operation:reviewer-accept", membershipId: invitation.id, principalId: reviewer.id, recordedAt,
  });
  const workspaceAfter = await fetch(url, { headers: auth(reviewerToken) });
  assert.equal(workspaceAfter.status, 200);
  assert.equal((await workspaceAfter.json()).data.workspace.id, organization.workspace.id);

  const createBody = {
    id: "work-instance:integration",
    intent: "Review the deployment",
    participants: [owner.id, reviewer.id],
    roles: { workOwners: [owner.id], decisionAuthorities: [owner.id], reviewers: [reviewer.id], approvers: [owner.id] },
    context: { ticket: "issue:integration" },
  };
  const create = await fetch(`${url}/work`, {
    method: "POST", headers: { ...auth(ownerToken), "idempotency-key": "create-1" },
    body: JSON.stringify(createBody),
  });
  assert.equal(create.status, 201);
  const created = (await create.json()).data.work;
  assert.equal(created.id, createBody.id);
  assert.deepEqual(created.participants.map((p: { principalId: string }) => p.principalId), [...createBody.participants].sort());
  assert.equal(created.version, 1);

  const reviewerRead = await fetch(`${url}/work/${encodeURIComponent(created.id)}`, { headers: auth(reviewerToken) });
  assert.equal(reviewerRead.status, 200);
  assert.equal((await reviewerRead.json()).data.work.version, 1);

  const forged = await fetch(`${url}/work/${encodeURIComponent(created.id)}/episodes`, {
    method: "POST", headers: { ...auth(reviewerToken), "idempotency-key": "spoof-1" },
    body: JSON.stringify({ id: "work-episode:forged", expectedVersion: 1, objective: "Impersonate", context: {}, actorPrincipalId: owner.id }),
  });
  assert.equal(forged.status, 400);

  const episodeBody = { id: "work-episode:review", expectedVersion: 1, objective: "Verify behavior", context: { phase: "review" } };
  const episode = await fetch(`${url}/work/${encodeURIComponent(created.id)}/episodes`, {
    method: "POST", headers: { ...auth(reviewerToken), "idempotency-key": "review-1" }, body: JSON.stringify(episodeBody),
  });
  assert.equal(episode.status, 201);
  const result = (await episode.json()).data.episode;
  assert.equal(result.startedByPrincipalId, reviewer.id);

  const stale = await fetch(`${url}/work/${encodeURIComponent(created.id)}/episodes`, {
    method: "POST", headers: { ...auth(ownerToken), "idempotency-key": "stale-1" },
    body: JSON.stringify({ ...episodeBody, id: "work-episode:stale" }),
  });
  assert.equal(stale.status, 409);

  const retry = await fetch(`${url}/work`, {
    method: "POST", headers: { ...auth(ownerToken), "idempotency-key": "create-1" }, body: JSON.stringify(createBody),
  });
  assert.equal(retry.status, 409);
  const outsiderRead = await fetch(`${url}/work/${encodeURIComponent(created.id)}`, { headers: auth(outsiderToken) });
  assert.equal(outsiderRead.status, 403);
  const agentRead = await fetch(`${url}/work/${encodeURIComponent(created.id)}`, { headers: auth(agentToken) });
  assert.equal(agentRead.status, 403);
  const anonymous = await fetch(`${url}/work/${encodeURIComponent(created.id)}`);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, "UNAUTHENTICATED");
  const maliciousParticipant = await fetch(`${url}/work`, {
    method: "POST", headers: { ...auth(ownerToken), "idempotency-key": "agent-1" },
    body: JSON.stringify({ ...createBody, id: "work-instance:agent", participants: [owner.id, agent.id] }),
  });
  assert.equal(maliciousParticipant.status, 403);

  const history = await fetch(`${url}/work/${encodeURIComponent(created.id)}/history`, { headers: auth(ownerToken) });
  assert.equal(history.status, 200);
  assert.deepEqual((await history.json()).data.operations.map((op: { kind: string }) => op.kind), [
    "work-instance.created", "work-episode.started",
  ]);
  await server.close();
  serverClosed = true;
  await work.close();
  await workspace.close();

  reloadedWorkspace = await DurableWorkspaceJournal.open({ ledgerPath: workspacePath });
  reloadedWork = await DurableWorkJournal.open({
    ledgerPath: workPath, workspaces: () => reloadedWorkspace!.snapshot(),
  });
  assert.equal(reloadedWork.workInstance({
    principalId: reviewer.id, workspaceId: organization.workspace.id, id: created.id,
  }).version, 2);
});

test("bearer sessions enforce strict secrets, expiration and revocation without issuing credentials over HTTP", () => {
  let current = Date.parse(recordedAt);
  const sessions = new BoundPrincipalSessions([
    { principalId: "principal:owner", token: ownerToken, expiresAt: "2026-10-17T10:00:00Z" },
    { principalId: "principal:reviewer", token: reviewerToken },
  ], { now: () => current });
  assert.deepEqual(sessions.resolve(`Bearer ${ownerToken}`), { id: "principal:owner" });
  assert.equal(sessions.resolve(`Bearer ${ownerToken} extra`), undefined);
  assert.equal(sessions.resolve(`Bearer ${ownerToken.slice(0, -1)}x`), undefined);
  assert.equal(sessions.resolve(`Basic ${ownerToken}`), undefined);
  assert.equal(sessions.resolve(undefined), undefined);
  current = Date.parse("2026-10-17T10:00:00Z");
  assert.equal(sessions.resolve(`Bearer ${ownerToken}`), undefined);
  assert.deepEqual(sessions.resolve(`Bearer ${reviewerToken}`), { id: "principal:reviewer" });
  sessions.revokePrincipal("principal:reviewer");
  assert.equal(sessions.resolve(`Bearer ${reviewerToken}`), undefined);
  assert.throws(() => new BoundPrincipalSessions([{ principalId: "principal:owner", token: "weak" }]), /token/);
  assert.throws(() => new BoundPrincipalSessions([
    { principalId: "principal:owner", token: ownerToken }, { principalId: "principal:reviewer", token: ownerToken },
  ]), /duplicate/);
});

test("rejects oversized and unrecognized HTTP mutations without changing canonical Work history", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-http-limits-"));
  const workspace = await DurableWorkspaceJournal.open({ ledgerPath: join(root, "workspace.json") });
  const owner = await workspace.registerPrincipal({
    operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt,
  });
  await workspace.createAccount({
    operationId: "workspace-operation:owner-account", id: "account:owner",
    ownerPrincipalId: owner.id, personalWorkspaceId: "workspace:owner", recordedAt,
  });
  const work = await DurableWorkJournal.open({ ledgerPath: join(root, "work.json"), workspaces: () => workspace.snapshot() });
  const sessions = new BoundPrincipalSessions([{ principalId: owner.id, token: ownerToken }]);
  const api = new SelfHostWorkApi({ workspaces: workspace, work, sessions });
  const server = await api.listen({ hostname: "127.0.0.1", port: 0 });
  t.after(async () => { await server.close(); await work.close(); await workspace.close(); await rm(root, { recursive: true, force: true }); });
  const target = `${server.url}/v1/workspaces/workspace%3Aowner/work`;
  const headers = { authorization: `Bearer ${ownerToken}`, "content-type": "application/json", "idempotency-key": "big-1" };
  const oversized = await fetch(target, { method: "POST", headers, body: JSON.stringify({ intent: "x".repeat(70000) }) });
  assert.equal(oversized.status, 413);
  const bad = await fetch(target, {
    method: "POST", headers,
    body: JSON.stringify({ id: "work-instance:bad", intent: "something", participants: [owner.id],
      roles: { workOwners: [owner.id], decisionAuthorities: [owner.id], reviewers: [], approvers: [] },
      context: {}, createdByPrincipalId: "principal:forged" }),
  });
  assert.equal(bad.status, 400);
  assert.deepEqual(work.history({ principalId: owner.id, workspaceId: "workspace:owner" }), []);
});
