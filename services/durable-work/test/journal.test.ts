import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { WorkspaceRegistry } from "../../../packages/workspace/src/index.ts";
import { DurableWorkJournal } from "../src/index.ts";

const instant = "2026-10-17T06:00:00Z";

function membership() {
  const registry = new WorkspaceRegistry();
  const owner = registry.registerPrincipal({ operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt: instant });
  const reviewer = registry.registerPrincipal({ operationId: "workspace-operation:reviewer", id: "principal:reviewer", kind: "human", recordedAt: instant });
  const outsider = registry.registerPrincipal({ operationId: "workspace-operation:outsider", id: "principal:outsider", kind: "human", recordedAt: instant });
  const agent = registry.registerPrincipal({ operationId: "workspace-operation:agent", id: "principal:agent", kind: "agent", recordedAt: instant });
  const observer = registry.registerPrincipal({ operationId: "workspace-operation:observer", id: "principal:observer", kind: "human", recordedAt: instant });
  registry.createAccount({
    operationId: "workspace-operation:outsider-account", id: "account:outsider", ownerPrincipalId: outsider.id,
    personalWorkspaceId: "workspace:outsider", recordedAt: instant,
  });
  const organization = registry.createOrganization({
    operationId: "workspace-operation:organization", id: "organization:team", workspaceId: "workspace:team",
    ownerMembershipId: "membership:owner", ownerPrincipalId: owner.id, recordedAt: instant,
  });
  registry.inviteMember({
    operationId: "workspace-operation:reviewer-invited", id: "membership:reviewer",
    organizationId: organization.organization.id, principalId: reviewer.id,
    invitedByPrincipalId: owner.id, recordedAt: instant,
  });
  registry.acceptInvitation({
    operationId: "workspace-operation:reviewer-accepted",
    membershipId: "membership:reviewer", principalId: reviewer.id, recordedAt: instant,
  });
  registry.inviteMember({
    operationId: "workspace-operation:observer-invited", id: "membership:observer",
    organizationId: organization.organization.id, principalId: observer.id,
    invitedByPrincipalId: owner.id, recordedAt: instant,
  });
  registry.acceptInvitation({
    operationId: "workspace-operation:observer-accepted",
    membershipId: "membership:observer", principalId: observer.id, recordedAt: instant,
  });
  return { registry, owner, reviewer, outsider, agent, observer };
}

function createInput(owner: ReturnType<typeof membership>["owner"], reviewer: ReturnType<typeof membership>["reviewer"]) {
  return {
    operationId: "work-operation:z-create",
    id: "work-instance:team-review",
    workspaceId: "workspace:team",
    intent: "Review the fix",
    createdByPrincipalId: owner.id,
    participants: [owner, reviewer],
    roles: {
      workOwners: [owner.id],
      decisionAuthorities: [owner.id],
      reviewers: [reviewer.id],
      approvers: [owner.id],
    },
    context: { ticket: "issue:123" },
    recordedAt: instant,
  };
}

test("durably records shared Work with causal episode order and restores it after restart", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-durable-work-"));
  const journals: DurableWorkJournal[] = [];
  t.after(async () => {
    for (const journal of journals.toReversed()) await journal.close();
    await rm(root, { recursive: true, force: true });
  });
  const { registry, owner, reviewer } = membership();
  const ledgerPath = join(root, "work-ledger.json");
  const journal = await DurableWorkJournal.open({ ledgerPath, workspaces: registry });
  journals.push(journal);

  const instance = await journal.createWorkInstance(createInput(owner, reviewer));
  assert.equal(instance.version, 1);
  await journal.startEpisode({
    operationId: "work-operation:a-episode", id: "work-episode:review", workspaceId: instance.workspaceId,
    workInstanceId: instance.id, expectedVersion: 1, objective: "Check proposed fix",
    actorPrincipalId: reviewer.id, context: { status: "in-progress" }, recordedAt: instant,
  });
  assert.equal(journal.workInstance({ principalId: reviewer.id, workspaceId: instance.workspaceId, id: instance.id }).version, 2);
  assert.deepEqual(journal.history({ principalId: owner.id, workspaceId: instance.workspaceId }).map((op) => op.ledgerSequence), [1, 2]);

  await journal.close();
  const reloaded = await DurableWorkJournal.open({
    ledgerPath, workspaces: WorkspaceRegistry.replay(registry.history().toReversed()),
  });
  journals.push(reloaded);
  assert.deepEqual(reloaded.workInstance({ principalId: reviewer.id, workspaceId: instance.workspaceId, id: instance.id }).episodeIds, ["work-episode:review"]);
  assert.deepEqual(reloaded.history({ principalId: owner.id, workspaceId: instance.workspaceId }).map((op) => op.kind), ["work-instance.created", "work-episode.started"]);
  assert.deepEqual(reloaded.history({ principalId: owner.id, workspaceId: instance.workspaceId }).map((op) => op.ledgerSequence), [1, 2]);
});

test("rejects unauthorized access, agent auto-grants, stale versions and concurrent writers without partial commits", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-durable-work-gates-"));
  const journals: DurableWorkJournal[] = [];
  t.after(async () => {
    for (const journal of journals.toReversed()) await journal.close();
    await rm(root, { recursive: true, force: true });
  });
  const { registry, owner, reviewer, outsider, agent, observer } = membership();
  const ledgerPath = join(root, "work-ledger.json");
  const journal = await DurableWorkJournal.open({ ledgerPath, workspaces: registry });
  journals.push(journal);

  await assert.rejects(DurableWorkJournal.open({ ledgerPath, workspaces: registry }), /writer lock/);
  await assert.rejects(
    journal.createWorkInstance({ ...createInput(owner, reviewer), createdByPrincipalId: outsider.id }),
    /workspace access denied/,
  );
  await assert.rejects(
    journal.createWorkInstance({ ...createInput(owner, reviewer), participants: [owner, reviewer, agent] }),
    /requires explicit delegated capability/,
  );
  await assert.rejects(
    journal.createWorkInstance({ ...createInput(owner, reviewer), participants: [owner, reviewer, { ...agent, kind: "human" }] }),
    /principal kind mismatch/,
  );
  assert.equal(journal.history({ principalId: owner.id, workspaceId: "workspace:team" }).length, 0);

  const work = await journal.createWorkInstance(createInput(owner, reviewer));
  await assert.rejects(
    journal.startEpisode({
      operationId: "work-operation:bad-version", id: "work-episode:bad", workspaceId: work.workspaceId,
      workInstanceId: work.id, expectedVersion: 2, objective: "Should not commit",
      actorPrincipalId: reviewer.id, context: {}, recordedAt: instant,
    }),
    /version/,
  );
  assert.throws(
    () => journal.workInstance({ principalId: outsider.id, workspaceId: work.workspaceId, id: work.id }),
    /workspace access denied/,
  );
  assert.throws(
    () => journal.history({ principalId: outsider.id, workspaceId: work.workspaceId }),
    /workspace access denied/,
  );
  assert.throws(
    () => journal.workInstance({ principalId: observer.id, workspaceId: work.workspaceId, id: work.id }),
    /Work participant access denied/,
  );
  assert.deepEqual(journal.history({ principalId: observer.id, workspaceId: work.workspaceId }), []);
  assert.equal(journal.history({ principalId: owner.id, workspaceId: work.workspaceId }).length, 1);
  assert.equal(JSON.parse(await readFile(ledgerPath, "utf8")).length, 1);
  await journal.close();
  await writeFile(ledgerPath, "{broken", "utf8");
  await assert.rejects(DurableWorkJournal.open({ ledgerPath, workspaces: registry }), /JSON|Unexpected|parse/i);
});

test("serializes parallel starts, preserving optimistic version rejection and allowing recovery", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-durable-work-queue-"));
  const journals: DurableWorkJournal[] = [];
  t.after(async () => {
    for (const journal of journals.toReversed()) await journal.close();
    await rm(root, { recursive: true, force: true });
  });
  const { registry, owner, reviewer } = membership();
  const ledgerPath = join(root, "work-ledger.json");
  const journal = await DurableWorkJournal.open({ ledgerPath, workspaces: registry });
  journals.push(journal);
  const work = await journal.createWorkInstance(createInput(owner, reviewer));

  const attempt = (operationId: string, id: string) => journal.startEpisode({
    operationId, id, workspaceId: work.workspaceId, workInstanceId: work.id,
    expectedVersion: 1, objective: id, actorPrincipalId: reviewer.id, context: {}, recordedAt: instant,
  });
  const settled = await Promise.allSettled([
    attempt("work-operation:episode-1", "work-episode:first"),
    attempt("work-operation:episode-2", "work-episode:second"),
  ]);
  assert.deepEqual(settled.map((entry) => entry.status), ["fulfilled", "rejected"]);
  assert.equal(journal.workInstance({ principalId: owner.id, workspaceId: work.workspaceId, id: work.id }).version, 2);
  assert.deepEqual(journal.history({ principalId: owner.id, workspaceId: work.workspaceId }).map((op) => op.ledgerSequence), [1, 2]);
});
