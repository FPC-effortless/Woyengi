import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DurableWorkspaceJournal, DurableWorkJournal } from "../../durable-work/index.ts";
import { BoundPrincipalSessions, SelfHostWorkApi } from "../src/index.ts";

const recordedAt = "2026-10-17T18:45:00Z";
const ownerToken = "owner-" + "a".repeat(48);
const reviewerToken = "reviewer-" + "b".repeat(48);
const observerToken = "observer-" + "c".repeat(48);
const outsiderToken = "outsider-" + "d".repeat(48);

interface WorkEvent {
  readonly id: number;
  readonly operation: { readonly kind: string; readonly ledgerSequence: number; readonly workInstanceId: string };
}

class SseReader {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #decoder = new TextDecoder();
  #buffer = "";

  constructor(response: Response) {
    if (response.body === null) throw new Error("missing SSE body");
    this.#reader = response.body.getReader();
  }

  async next(): Promise<WorkEvent | undefined> {
    for (;;) {
      const boundary = this.#buffer.indexOf("\n\n");
      if (boundary !== -1) {
        const frame = this.#buffer.slice(0, boundary);
        this.#buffer = this.#buffer.slice(boundary + 2);
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (data === undefined) continue;
        const id = frame.split("\n").find((line) => line.startsWith("id: "));
        if (id === undefined) throw new Error("SSE event has no cursor");
        return { id: Number(id.slice(4)), ...JSON.parse(data.slice(6)) } as WorkEvent;
      }
      const result = await this.#reader.read();
      if (result.done) return undefined;
      this.#buffer += this.#decoder.decode(result.value, { stream: true });
    }
  }

  async close(): Promise<void> {
    await this.#reader.cancel().catch(() => undefined);
  }
}

test("two humans receive durable Work SSE with replay on reconnect, ordered cursor and isolated access", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "woyengi-sse-"));
  const workspacePath = join(dir, "workspace.json");
  const workPath = join(dir, "work.json");
  let workspace = await DurableWorkspaceJournal.open({ ledgerPath: workspacePath });
  const owner = await workspace.registerPrincipal({ operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt });
  const reviewer = await workspace.registerPrincipal({ operationId: "workspace-operation:reviewer", id: "principal:reviewer", kind: "human", recordedAt });
  const observer = await workspace.registerPrincipal({ operationId: "workspace-operation:observer", id: "principal:observer", kind: "human", recordedAt });
  const outsider = await workspace.registerPrincipal({ operationId: "workspace-operation:outsider", id: "principal:outsider", kind: "human", recordedAt });
  await workspace.createAccount({ operationId: "workspace-operation:outsider-account", id: "account:outsider", ownerPrincipalId: outsider.id, personalWorkspaceId: "workspace:outsider", recordedAt });
  const organization = await workspace.createOrganization({ operationId: "workspace-operation:team", id: "organization:team", workspaceId: "workspace:team", ownerMembershipId: "membership:owner", ownerPrincipalId: owner.id, recordedAt });
  for (const principal of [reviewer, observer]) {
    const invite = await workspace.inviteMember({
      operationId: `workspace-operation:invite-${principal.id}`, id: `membership:${principal.id.slice(10)}`,
      organizationId: organization.organization.id, principalId: principal.id, invitedByPrincipalId: owner.id, recordedAt,
    });
    await workspace.acceptInvitation({
      operationId: `workspace-operation:accept-${principal.id}`, membershipId: invite.id,
      principalId: principal.id, recordedAt,
    });
  }

  let work = await DurableWorkJournal.open({ ledgerPath: workPath, workspaces: () => workspace.snapshot() });
  const sessions = new BoundPrincipalSessions([
    { principalId: owner.id, token: ownerToken }, { principalId: reviewer.id, token: reviewerToken },
    { principalId: observer.id, token: observerToken }, { principalId: outsider.id, token: outsiderToken },
  ]);
  let server = await new SelfHostWorkApi({ workspaces: workspace, work, sessions }).listen({ hostname: "127.0.0.1", port: 0 });
  const liveReaders: SseReader[] = [];
  t.after(async () => {
    for (const reader of liveReaders) await reader.close();
    await server.close();
    await work.close();
    await workspace.close();
    await rm(dir, { recursive: true, force: true });
  });
  const prefix = `/v1/workspaces/${encodeURIComponent(organization.workspace.id)}/work`;
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const create = await fetch(`${server.url}${prefix}`, {
    method: "POST",
    headers: { ...auth(ownerToken), "content-type": "application/json", "idempotency-key": "create-stream" },
    body: JSON.stringify({
      id: "work-instance:stream", intent: "Investigate production issue",
      participants: [owner.id, reviewer.id],
      roles: { workOwners: [owner.id], decisionAuthorities: [owner.id], reviewers: [reviewer.id], approvers: [owner.id] },
      context: { issue: "issue:stream" },
    }),
  });
  assert.equal(create.status, 201);
  const url = `${server.url}${prefix}/work-instance%3Astream/events`;
  const outsiderStream = await fetch(url, { headers: auth(outsiderToken) });
  assert.equal(outsiderStream.status, 403);
  const observerStream = await fetch(url, { headers: auth(observerToken) });
  assert.equal(observerStream.status, 403);
  const anonymousStream = await fetch(url);
  assert.equal(anonymousStream.status, 401);
  const invalidCursor = await fetch(`${url}?after=-5`, { headers: auth(reviewerToken) });
  assert.equal(invalidCursor.status, 400);

  const stream = await fetch(url, { headers: auth(reviewerToken) });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.equal(stream.headers.get("cache-control"), "no-store");
  const reader = new SseReader(stream);
  liveReaders.push(reader);
  const initial = await reader.next();
  assert.equal(initial?.id, 1);
  assert.equal(initial.operation.kind, "work-instance.created");
  assert.equal(initial.operation.ledgerSequence, 1);
  // Both human Work participants can independently resume the same causal
  // stream without using presence or a non-canonical event cache.
  const ownerStream = await fetch(url, { headers: auth(ownerToken) });
  assert.equal(ownerStream.status, 200);
  const ownerReader = new SseReader(ownerStream);
  liveReaders.push(ownerReader);
  assert.equal((await ownerReader.next())?.id, 1);

  const episode = await fetch(`${server.url}${prefix}/work-instance%3Astream/episodes`, {
    method: "POST", headers: { ...auth(ownerToken), "content-type": "application/json", "idempotency-key": "stream-episode" },
    body: JSON.stringify({ id: "work-episode:live", objective: "Check logs", expectedVersion: 1, context: {} }),
  });
  assert.equal(episode.status, 201);
  const live = await reader.next();
  assert.equal(live?.id, 2);
  assert.equal(live.operation.kind, "work-episode.started");
  const ownerLive = await ownerReader.next();
  assert.equal(ownerLive?.id, 2);
  assert.equal(ownerLive.operation.kind, "work-episode.started");
  await reader.close();
  await ownerReader.close();

  await server.close();
  await work.close();
  await workspace.close();
  workspace = await DurableWorkspaceJournal.open({ ledgerPath: workspacePath });
  work = await DurableWorkJournal.open({ ledgerPath: workPath, workspaces: () => workspace.snapshot() });
  server = await new SelfHostWorkApi({ workspaces: workspace, work, sessions }).listen({ hostname: "127.0.0.1", port: 0 });

  const resumedUrl = `${server.url}${prefix}/work-instance%3Astream/events`;
  const resumed = await fetch(resumedUrl, { headers: { ...auth(reviewerToken), "last-event-id": "1" } });
  assert.equal(resumed.status, 200);
  const resumedReader = new SseReader(resumed);
  liveReaders.push(resumedReader);
  const replayed = await resumedReader.next();
  assert.equal(replayed?.id, 2);
  assert.equal(replayed.operation.kind, "work-episode.started");
  assert.equal(replayed.operation.workInstanceId, "work-instance:stream");

  sessions.revokePrincipal(reviewer.id);
  const finalEpisode = await fetch(`${server.url}${prefix}/work-instance%3Astream/episodes`, {
    method: "POST", headers: { ...auth(ownerToken), "content-type": "application/json", "idempotency-key": "stream-episode-final" },
    body: JSON.stringify({ id: "work-episode:later", objective: "Check correction", expectedVersion: 2, context: {} }),
  });
  assert.equal(finalEpisode.status, 201);
  // A revoked bearer cannot stay connected to receive future Work history.
  assert.equal(await resumedReader.next(), undefined);
  const revokedReconnect = await fetch(resumedUrl, { headers: auth(reviewerToken) });
  assert.equal(revokedReconnect.status, 401);
});

test("denies forged SSE cursors and mismatched Last-Event-ID without opening a stream", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "woyengi-sse-cursor-"));
  const workspace = await DurableWorkspaceJournal.open({ ledgerPath: join(dir, "workspace.json") });
  const owner = await workspace.registerPrincipal({ operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt });
  await workspace.createAccount({ operationId: "workspace-operation:personal", id: "account:owner", ownerPrincipalId: owner.id, personalWorkspaceId: "workspace:owner", recordedAt });
  const work = await DurableWorkJournal.open({ ledgerPath: join(dir, "work.json"), workspaces: () => workspace.snapshot() });
  const sessions = new BoundPrincipalSessions([{ principalId: owner.id, token: ownerToken }]);
  const api = new SelfHostWorkApi({ workspaces: workspace, work, sessions });
  const server = await api.listen({ hostname: "127.0.0.1", port: 0 });
  t.after(async () => { await server.close(); await work.close(); await workspace.close(); await rm(dir, { recursive: true, force: true }); });
  const url = `${server.url}/v1/workspaces/workspace%3Aowner/work/work-instance%3Aabsent/events`;
  const headers = { authorization: `Bearer ${ownerToken}` };
  assert.equal((await fetch(`${url}?after=1e8`, { headers })).status, 400);
  assert.equal((await fetch(`${url}?after=1`, { headers: { ...headers, "last-event-id": "2" } })).status, 400);
  assert.equal((await fetch(url, { headers })).status, 404);
});
