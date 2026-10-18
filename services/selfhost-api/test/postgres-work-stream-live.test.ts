import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import {
  migratePostgresCanonicalLedger, PostgresPrincipalSessions, PostgresWorkJournal,
  PostgresWorkspaceJournal, type PostgresPool,
} from "../../postgres-storage/index.ts";
import { SelfHostWorkApi } from "../src/index.ts";

const databaseUrl = process.env.WOYENGI_TEST_DATABASE_URL;
const driverRoot = process.env.WOYENGI_PG_MODULE_ROOT;
const issuedAt = "2026-10-18T04:00:00Z";
const expiresAt = "2026-10-19T04:00:00Z";
const ownerToken = "owner-" + "a".repeat(48);
const reviewerToken = "reviewer-" + "b".repeat(48);
const observerToken = "observer-" + "c".repeat(48);

class Events {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #decoder = new TextDecoder();
  #buffer = "";

  constructor(response: Response) {
    assert.ok(response.body);
    this.#reader = response.body.getReader();
  }

  async next(): Promise<{ id: number; operation: { kind: string; ledgerSequence: number } } | undefined> {
    for (;;) {
      const boundary = this.#buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const frame = this.#buffer.slice(0, boundary);
        this.#buffer = this.#buffer.slice(boundary + 2);
        const data = frame.split("\n").find(line => line.startsWith("data: "));
        if (!data) continue;
        const id = frame.split("\n").find(line => line.startsWith("id: "));
        assert.ok(id, "cursor is required");
        return { id: Number(id.slice(4)), ...JSON.parse(data.slice(6)) };
      }
      const fragment = await this.#reader.read();
      if (fragment.done) return undefined;
      this.#buffer += this.#decoder.decode(fragment.value, { stream: true });
    }
  }

  async close(): Promise<void> { await this.#reader.cancel().catch(() => undefined); }
}

test("PostgreSQL-backed SSE replays remote Work, resumes cursors, and terminates on cross-server credential revocation", {
  skip: databaseUrl && driverRoot ? false : "requires live PostgreSQL CI",
}, async (t) => {
  const { Pool } = createRequire(join(driverRoot!, "package.json"))("pg") as {
    readonly Pool: new (input: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const poolA = new Pool({ connectionString: databaseUrl!, max: 4 });
  const poolB = new Pool({ connectionString: databaseUrl!, max: 4 });
  const namespace = randomUUID().replaceAll("-", "");
  const wsName = "workspace_" + namespace;
  const workName = "work_" + namespace;
  const sessionsName = "sessions_" + namespace;
  let serverA: Awaited<ReturnType<SelfHostWorkApi["listen"]>> | undefined;
  let serverB: Awaited<ReturnType<SelfHostWorkApi["listen"]>> | undefined;
  const readers: Events[] = [];
  t.after(async () => {
    for (const reader of readers) await reader.close();
    await Promise.all([serverA?.close(), serverB?.close()]);
    await Promise.all([poolA.end(), poolB.end()]);
  });
  await migratePostgresCanonicalLedger(poolA);
  const wsA = PostgresWorkspaceJournal.open({ pool: poolA, namespace: wsName });
  const wsB = PostgresWorkspaceJournal.open({ pool: poolB, namespace: wsName });
  const owner = await wsA.registerPrincipal({
    operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt: issuedAt,
  });
  const reviewer = await wsB.registerPrincipal({
    operationId: "workspace-operation:reviewer", id: "principal:reviewer", kind: "human", recordedAt: issuedAt,
  });
  const observer = await wsA.registerPrincipal({
    operationId: "workspace-operation:observer", id: "principal:observer", kind: "human", recordedAt: issuedAt,
  });
  const org = await wsA.createOrganization({
    operationId: "workspace-operation:org", id: "organization:one", workspaceId: "workspace:one",
    ownerMembershipId: "membership:owner", ownerPrincipalId: owner.id, recordedAt: issuedAt,
  });
  for (const person of [reviewer, observer]) {
    const invited = await wsA.inviteMember({
      operationId: "workspace-operation:invite-" + person.id,
      id: "membership:" + person.id.slice(10), principalId: person.id,
      organizationId: org.organization.id, invitedByPrincipalId: owner.id, recordedAt: issuedAt,
    });
    await wsB.acceptInvitation({
      operationId: "workspace-operation:accept-" + person.id,
      membershipId: invited.id, principalId: person.id, recordedAt: issuedAt,
    });
  }
  const workA = PostgresWorkJournal.open({ pool: poolA, namespace: workName, workspaces: wsA });
  const workB = PostgresWorkJournal.open({ pool: poolB, namespace: workName, workspaces: wsB });
  const sessionsA = PostgresPrincipalSessions.open({
    pool: poolA, namespace: sessionsName, workspaces: wsA, now: () => Date.parse(issuedAt),
  });
  const sessionsB = PostgresPrincipalSessions.open({
    pool: poolB, namespace: sessionsName, workspaces: wsB, now: () => Date.parse(issuedAt),
  });
  for (const [i, person, token] of [
    [1, owner, ownerToken],
    [2, reviewer, reviewerToken],
    [3, observer, observerToken],
  ] as const) {
    await sessionsA.provision({
      operationId: "session-operation:issue-" + i, sessionId: "session:person-" + i,
      principalId: person.id, token, expiresAt, recordedAt: issuedAt,
    });
  }
  serverA = await new SelfHostWorkApi({
    workspaces: wsA, work: workA, sessions: sessionsA, streamPollIntervalMs: 70,
  }).listen({ hostname: "127.0.0.1", port: 0 });
  serverB = await new SelfHostWorkApi({
    workspaces: wsB, work: workB, sessions: sessionsB, streamPollIntervalMs: 70,
  }).listen({ hostname: "127.0.0.1", port: 0 });
  const auth = (token: string) => ({ authorization: "Bearer " + token });
  const create = await fetch(serverA.url + "/v1/workspaces/workspace%3Aone/work", {
    method: "POST",
    headers: { ...auth(ownerToken), "content-type": "application/json", "idempotency-key": "create" },
    body: JSON.stringify({
      id: "work-instance:one", intent: "Validate cross-server Work stream",
      participants: [owner.id, reviewer.id],
      roles: { workOwners: [owner.id], decisionAuthorities: [owner.id],
        reviewers: [reviewer.id], approvers: [owner.id] },
      context: {},
    }),
  });
  assert.equal(create.status, 201);
  const route = "/v1/workspaces/workspace%3Aone/work/work-instance%3Aone";
  const streamUrl = serverB.url + route + "/events";
  assert.equal((await fetch(streamUrl, { headers: auth(observerToken) })).status, 403);
  assert.equal((await fetch(streamUrl)).status, 401);
  assert.equal((await fetch(streamUrl + "?after=-1", { headers: auth(reviewerToken) })).status, 400);
  const stream = await fetch(streamUrl, { headers: auth(reviewerToken) });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = new Events(stream);
  readers.push(reader);
  assert.equal((await reader.next())?.id, 1);

  const episode = await fetch(serverA.url + route + "/episodes", {
    method: "POST",
    headers: { ...auth(ownerToken), "content-type": "application/json", "idempotency-key": "episode" },
    body: JSON.stringify({
      id: "work-episode:one", objective: "Test realtime", expectedVersion: 1, context: {},
    }),
  });
  assert.equal(episode.status, 201);
  const next = await reader.next();
  assert.equal(next?.id, 2);
  assert.equal(next.operation.kind, "work-episode.started");
  await reader.close();
  const resumed = await fetch(streamUrl, {
    headers: { ...auth(reviewerToken), "last-event-id": "1" },
  });
  assert.equal(resumed.status, 200);
  const resumedReader = new Events(resumed);
  readers.push(resumedReader);
  assert.equal((await resumedReader.next())?.id, 2);
  // Credential changes are authoritative on the other SQL connection.
  await sessionsA.revoke({
    operationId: "session-operation:revoke", sessionId: "session:person-2", recordedAt: issuedAt,
  });
  assert.equal(await resumedReader.next(), undefined);
  assert.equal((await fetch(streamUrl, { headers: auth(reviewerToken) })).status, 401);
});
