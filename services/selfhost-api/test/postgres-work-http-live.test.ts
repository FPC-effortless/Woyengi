import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import {
  migratePostgresCanonicalLedger,
  PostgresWorkJournal,
  PostgresWorkspaceJournal,
  type PostgresPool,
} from "../../postgres-storage/index.ts";
import { BoundPrincipalSessions, SelfHostWorkApi } from "../src/index.ts";

const db = process.env.WOYENGI_TEST_DATABASE_URL;
const driverRoot = process.env.WOYENGI_PG_MODULE_ROOT;
const timestamp = "2026-10-18T01:00:00Z";
const ownerToken = "pg-owner-" + "a".repeat(48);
const reviewerToken = "pg-reviewer-" + "b".repeat(48);
const observerToken = "pg-observer-" + "c".repeat(48);
const outsiderToken = "pg-outsider-" + "d".repeat(48);
const agentToken = "pg-agent-" + "e".repeat(48);

test("authenticated Work HTTP on two independently connected PostgreSQL-backed servers", {
  skip: db && driverRoot ? false : "requires PostgreSQL and isolated pg driver",
}, async (t) => {
  const { Pool } = createRequire(join(driverRoot!, "package.json"))("pg") as {
    readonly Pool: new (input: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const poolA = new Pool({ connectionString: db!, max: 4 });
  const poolB = new Pool({ connectionString: db!, max: 4 });
  const suffix = randomUUID().replaceAll("-", "");
  const workspaceNamespace = `workspace_${suffix}`;
  const workNamespace = `work_${suffix}`;
  let serverA: Awaited<ReturnType<SelfHostWorkApi["listen"]>> | undefined;
  let serverB: Awaited<ReturnType<SelfHostWorkApi["listen"]>> | undefined;
  t.after(async () => {
    await Promise.all([serverA?.close(), serverB?.close()]);
    await Promise.all([poolA.end(), poolB.end()]);
  });

  await migratePostgresCanonicalLedger(poolA);
  const workspaceA = PostgresWorkspaceJournal.open({ pool: poolA, namespace: workspaceNamespace });
  const workspaceB = PostgresWorkspaceJournal.open({ pool: poolB, namespace: workspaceNamespace });
  const owner = await workspaceA.registerPrincipal({
    operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt: timestamp,
  });
  const reviewer = await workspaceB.registerPrincipal({
    operationId: "workspace-operation:reviewer", id: "principal:reviewer", kind: "human", recordedAt: timestamp,
  });
  const observer = await workspaceA.registerPrincipal({
    operationId: "workspace-operation:observer", id: "principal:observer", kind: "human", recordedAt: timestamp,
  });
  const outsider = await workspaceA.registerPrincipal({
    operationId: "workspace-operation:outsider", id: "principal:outsider", kind: "human", recordedAt: timestamp,
  });
  const agent = await workspaceB.registerPrincipal({
    operationId: "workspace-operation:agent", id: "principal:agent", kind: "agent", recordedAt: timestamp,
  });

  const org = await workspaceA.createOrganization({
    operationId: "workspace-operation:team", id: "organization:team",
    workspaceId: "workspace:team", ownerPrincipalId: owner.id,
    ownerMembershipId: "membership:owner", recordedAt: timestamp,
  });
  for (const participant of [reviewer, observer]) {
    const invitation = await workspaceA.inviteMember({
      operationId: `workspace-operation:invite-${participant.id}`,
      id: `membership:${participant.id.slice(10)}`,
      organizationId: org.organization.id,
      principalId: participant.id, invitedByPrincipalId: owner.id, recordedAt: timestamp,
    });
    await workspaceB.acceptInvitation({
      operationId: `workspace-operation:accept-${participant.id}`,
      membershipId: invitation.id, principalId: participant.id, recordedAt: timestamp,
    });
  }
  const workA = PostgresWorkJournal.open({ pool: poolA, namespace: workNamespace, workspaces: workspaceA });
  const workB = PostgresWorkJournal.open({ pool: poolB, namespace: workNamespace, workspaces: workspaceB });
  const credentials = [
    { principalId: owner.id, token: ownerToken },
    { principalId: reviewer.id, token: reviewerToken },
    { principalId: observer.id, token: observerToken },
    { principalId: outsider.id, token: outsiderToken },
    { principalId: agent.id, token: agentToken },
  ];
  const sessionsA = new BoundPrincipalSessions(credentials);
  const sessionsB = new BoundPrincipalSessions(credentials);
  serverA = await new SelfHostWorkApi({ workspaces: workspaceA, work: workA, sessions: sessionsA })
    .listen({ hostname: "127.0.0.1", port: 0 });
  serverB = await new SelfHostWorkApi({ workspaces: workspaceB, work: workB, sessions: sessionsB })
    .listen({ hostname: "127.0.0.1", port: 0 });

  const prefix = `/v1/workspaces/${encodeURIComponent(org.workspace.id)}`;
  const headers = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
  const createPayload = {
    id: "work-instance:postgres-api",
    intent: "Verify concurrent HTTP clients",
    participants: [owner.id, reviewer.id],
    roles: {
      workOwners: [owner.id], decisionAuthorities: [owner.id],
      reviewers: [reviewer.id], approvers: [owner.id],
    },
    context: { issue: "integration:postgres-http" },
  };
  const create = await fetch(`${serverA.url}${prefix}/work`, {
    method: "POST",
    headers: { ...headers(ownerToken), "idempotency-key": "pg-create" },
    body: JSON.stringify(createPayload),
  });
  assert.equal(create.status, 201);
  assert.equal((await create.json()).data.work.version, 1);
  const workPath = `${prefix}/work/${encodeURIComponent(createPayload.id)}`;

  const remoteRead = await fetch(`${serverB.url}${workPath}`, { headers: headers(reviewerToken) });
  assert.equal(remoteRead.status, 200);
  assert.equal((await remoteRead.json()).data.work.version, 1);
  assert.equal((await fetch(`${serverB.url}${workPath}`, { headers: headers(observerToken) })).status, 403);
  assert.equal((await fetch(`${serverB.url}${workPath}`, { headers: headers(outsiderToken) })).status, 403);
  assert.equal((await fetch(`${serverA.url}${workPath}`, { headers: headers(agentToken) })).status, 403);
  assert.equal((await fetch(`${serverA.url}${workPath}`)).status, 401);
  const streamPreview = await fetch(`${serverB.url}${workPath}/events`, { headers: headers(reviewerToken) });
  assert.equal(streamPreview.status, 200);
  await streamPreview.body?.cancel();

  const forgeActor = await fetch(`${serverA.url}${workPath}/episodes`, {
    method: "POST", headers: { ...headers(reviewerToken), "idempotency-key": "pg-forgery" },
    body: JSON.stringify({
      id: "work-episode:forgery", objective: "Act as owner",
      expectedVersion: 1, context: {}, actorPrincipalId: owner.id,
    }),
  });
  assert.equal(forgeActor.status, 400);
  const episode = (id: string) => JSON.stringify({ id, objective: "Check changes", expectedVersion: 1, context: {} });
  const [first, second] = await Promise.all([
    fetch(`${serverA.url}${workPath}/episodes`, {
      method: "POST", headers: { ...headers(ownerToken), "idempotency-key": "pg-update-a" },
      body: episode("work-episode:api-a"),
    }),
    fetch(`${serverB.url}${workPath}/episodes`, {
      method: "POST", headers: { ...headers(reviewerToken), "idempotency-key": "pg-update-b" },
      body: episode("work-episode:api-b"),
    }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [201, 409]);

  const historyResponse = await fetch(`${serverA.url}${workPath}/history`, { headers: headers(reviewerToken) });
  assert.equal(historyResponse.status, 200);
  const operations = (await historyResponse.json()).data.operations;
  assert.deepEqual(operations.map((op: { ledgerSequence: number }) => op.ledgerSequence), [1, 2]);
  assert.equal(operations[1].kind, "work-episode.started");

  const duplicate = await fetch(`${serverB.url}${prefix}/work`, {
    method: "POST", headers: { ...headers(ownerToken), "idempotency-key": "pg-create" },
    body: JSON.stringify(createPayload),
  });
  assert.equal(duplicate.status, 409);

  await serverA.close();
  serverA = undefined;
  const restartedWork = PostgresWorkJournal.open({
    pool: poolA, namespace: workNamespace,
    workspaces: PostgresWorkspaceJournal.open({ pool: poolA, namespace: workspaceNamespace }),
  });
  serverA = await new SelfHostWorkApi({ workspaces: workspaceA, work: restartedWork, sessions: sessionsA })
    .listen({ hostname: "127.0.0.1", port: 0 });
  const afterRestart = await fetch(`${serverA.url}${workPath}`, { headers: headers(ownerToken) });
  assert.equal(afterRestart.status, 200);
  assert.equal((await afterRestart.json()).data.work.version, 2);
});
