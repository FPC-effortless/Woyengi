import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import {
  PostgresCanonicalLedger, PostgresPrincipalSessions, PostgresWorkJournal,
  PostgresWorkspaceJournal, migratePostgresCanonicalLedger, type PostgresPool,
} from "../../postgres-storage/index.ts";
import { SelfHostWorkApi } from "../src/index.ts";

const db = process.env.WOYENGI_TEST_DATABASE_URL;
const driverRoot = process.env.WOYENGI_PG_MODULE_ROOT;
const at = "2026-10-18T02:00:00Z";
const expiry = "2026-10-19T02:00:00Z";
const ownerToken = "owner-" + "a".repeat(48);
const secondToken = "other-" + "b".repeat(48);


test("PostgreSQL principal sessions authorize across API instances and immediately enforce remote revocation", {
  skip: db && driverRoot ? false : "requires isolated pg driver and PostgreSQL service",
}, async (t) => {
  const { Pool } = createRequire(join(driverRoot!, "package.json"))("pg") as {
    readonly Pool: new (input: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const poolA = new Pool({ connectionString: db!, max: 4 });
  const poolB = new Pool({ connectionString: db!, max: 4 });
  const id = randomUUID().replaceAll("-", "");
  const workspaceNamespace = `workspace_${id}`;
  const workNamespace = `work_${id}`;
  const sessionsNamespace = `sessions_${id}`;
  let clock = Date.parse(at);
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
    operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt: at,
  });
  const other = await workspaceB.registerPrincipal({
    operationId: "workspace-operation:other", id: "principal:other", kind: "human", recordedAt: at,
  });
  const agent = await workspaceB.registerPrincipal({
    operationId: "workspace-operation:agent", id: "principal:agent", kind: "agent", recordedAt: at,
  });
  await workspaceA.createAccount({
    operationId: "workspace-operation:account", id: "account:owner",
    ownerPrincipalId: owner.id, personalWorkspaceId: "workspace:owner", recordedAt: at,
  });
  const workA = PostgresWorkJournal.open({ pool: poolA, namespace: workNamespace, workspaces: workspaceA });
  const workB = PostgresWorkJournal.open({ pool: poolB, namespace: workNamespace, workspaces: workspaceB });
  const sessionsA = PostgresPrincipalSessions.open({
    pool: poolA, namespace: sessionsNamespace, workspaces: workspaceA, now: () => clock,
  });
  const sessionsB = PostgresPrincipalSessions.open({
    pool: poolB, namespace: sessionsNamespace, workspaces: workspaceB, now: () => clock,
  });
  const path = "/v1/workspaces/workspace%3Aowner";
  const get = (base: string, token?: string) => fetch(base + path,
    { headers: token ? { authorization: `Bearer ${token}` } : {} });

  serverA = await new SelfHostWorkApi({ workspaces: workspaceA, work: workA, sessions: sessionsA })
    .listen({ hostname: "127.0.0.1", port: 0 });
  serverB = await new SelfHostWorkApi({ workspaces: workspaceB, work: workB, sessions: sessionsB })
    .listen({ hostname: "127.0.0.1", port: 0 });
  assert.equal((await get(serverA.url)).status, 401);
  assert.equal((await get(serverB.url, ownerToken)).status, 401);

  await assert.rejects(sessionsA.provision({
    operationId: "session-operation:agent", sessionId: "session:agent",
    principalId: agent.id, token: ownerToken, expiresAt: expiry, recordedAt: at,
  }), /human/);
  await assert.rejects(sessionsA.provision({
    operationId: "session-operation:unknown", sessionId: "session:unknown",
    principalId: "principal:unknown", token: ownerToken, expiresAt: expiry, recordedAt: at,
  }), /registered/);
  assert.equal((await sessionsA.history()).length, 0);

  await sessionsA.provision({
    operationId: "session-operation:owner", sessionId: "session:owner",
    principalId: owner.id, token: ownerToken, expiresAt: expiry, recordedAt: at,
  });
  assert.equal((await get(serverA.url, ownerToken)).status, 200);
  assert.equal((await get(serverB.url, ownerToken)).status, 200);
  assert.equal((await get(serverB.url, secondToken)).status, 401);
  assert.equal((await get(serverA.url, ownerToken + "x")).status, 401);
  assert.equal((await get(serverB.url, ownerToken + " more")).status, 401);

  await assert.rejects(sessionsB.provision({
    operationId: "session-operation:reuse", sessionId: "session:second",
    principalId: other.id, token: ownerToken, expiresAt: expiry, recordedAt: at,
  }), /duplicate/);
  assert.equal((await sessionsB.history()).length, 1);
  const issued = (await sessionsB.history())[0];
  assert.equal(issued?.kind, "session.issued");
  assert.equal(JSON.stringify(issued).includes(ownerToken), false);
  assert.match(JSON.stringify(issued), /sha256:[a-f0-9]{64}/);

  await sessionsB.revoke({
    operationId: "session-operation:revoke-owner", sessionId: "session:owner", recordedAt: at,
  });
  assert.equal((await get(serverA.url, ownerToken)).status, 401);
  assert.equal((await get(serverB.url, ownerToken)).status, 401);
  await assert.rejects(sessionsA.revoke({
    operationId: "session-operation:revoke-again", sessionId: "session:owner", recordedAt: at,
  }), /already revoked/);
  await assert.rejects(sessionsA.provision({
    operationId: "session-operation:reuse-revoked", sessionId: "session:third",
    principalId: owner.id, token: ownerToken, expiresAt: expiry, recordedAt: at,
  }), /duplicate/);
  assert.deepEqual((await sessionsA.history()).map(x => x.ledgerSequence), [1, 2]);

  const attempts = await Promise.allSettled([
    sessionsA.provision({
      operationId: "session-operation:race-a", sessionId: "session:race-a",
      principalId: owner.id, token: secondToken, expiresAt: expiry, recordedAt: at,
    }),
    sessionsB.provision({
      operationId: "session-operation:race-b", sessionId: "session:race-b",
      principalId: owner.id, token: secondToken, expiresAt: expiry, recordedAt: at,
    }),
  ]);
  assert.deepEqual(attempts.map(x => x.status).sort(), ["fulfilled", "rejected"]);
  assert.equal((await get(serverB.url, secondToken)).status, 200);

  await serverB.close();
  serverB = undefined;
  const reopened = PostgresPrincipalSessions.open({
    pool: poolB, namespace: sessionsNamespace, workspaces: workspaceB, now: () => clock,
  });
  serverB = await new SelfHostWorkApi({ workspaces: workspaceB, work: workB, sessions: reopened })
    .listen({ hostname: "127.0.0.1", port: 0 });
  assert.equal((await get(serverB.url, ownerToken)).status, 401);
  assert.equal((await get(serverB.url, secondToken)).status, 200);
  clock = Date.parse(expiry);
  assert.equal((await get(serverB.url, secondToken)).status, 401);
  assert.equal((await get(serverA.url, secondToken)).status, 401);

  // If a privileged writer corrupts the session namespace, authentication
  // must not treat it as empty or regain access to any old credential.
  const raw = PostgresCanonicalLedger.open({ pool: poolA, namespace: sessionsNamespace });
  await raw.append({
    id: "session-operation:corruption", kind: "session.elevated",
    transactionTime: { from: at },
  });
  assert.equal((await get(serverA.url, ownerToken)).status, 500);
  assert.equal((await get(serverB.url, secondToken)).status, 500);
});

test("PostgreSQL session operator rejects weak tokens and invalid issuance windows", {
  skip: db && driverRoot ? false : "requires isolated pg driver and PostgreSQL service",
}, async () => {
  const { Pool } = createRequire(join(driverRoot!, "package.json"))("pg") as {
    readonly Pool: new (input: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const pool = new Pool({ connectionString: db!, max: 2 });
  try {
    await migratePostgresCanonicalLedger(pool);
    const suffix = randomUUID().replaceAll("-", "");
    const ws = PostgresWorkspaceJournal.open({ pool, namespace: `workspace_${suffix}` });
    const owner = await ws.registerPrincipal({
      operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt: at,
    });
    const sessions = PostgresPrincipalSessions.open({
      pool, namespace: `sessions_${suffix}`, workspaces: ws, now: () => Date.parse(at),
    });
    const issue = (token: string, expiresAt: string) => sessions.provision({
      operationId: "session-operation:test", sessionId: "session:test",
      principalId: owner.id, token, expiresAt, recordedAt: at,
    });
    await assert.rejects(issue("weak", expiry), /at least 32/);
    await assert.rejects(issue("x".repeat(40), at), /expire after/);
    await assert.rejects(issue("x".repeat(40), "2027-02-01T00:00:00Z"), /30 days/);
    assert.deepEqual(await sessions.history(), []);
  } finally {
    await pool.end();
  }
});
