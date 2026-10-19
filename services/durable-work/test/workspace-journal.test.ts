import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DurableWorkJournal } from "../src/index.ts";
import { DurableWorkspaceJournal } from "../src/workspace-journal.ts";

const at = "2026-10-17T08:00:00Z";

test("durably reconstructs workspace principals, memberships and Work after restart in causal order", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "woyengi-workspace-journal-"));
  const workspacesPath = join(dir, "workspace-operations.json");
  const workPath = join(dir, "work-operations.json");
  let workspace = await DurableWorkspaceJournal.open({ ledgerPath: workspacesPath });
  let work: DurableWorkJournal | undefined;
  t.after(async () => {
    await work?.close();
    await workspace.close();
    await rm(dir, { recursive: true, force: true });
  });

  const owner = await workspace.registerPrincipal({
    operationId: "workspace-operation:z-owner", id: "principal:owner", kind: "human", recordedAt: at,
  });
  const reviewer = await workspace.registerPrincipal({
    operationId: "workspace-operation:y-reviewer", id: "principal:reviewer", kind: "human", recordedAt: at,
  });
  const outsider = await workspace.registerPrincipal({
    operationId: "workspace-operation:x-outsider", id: "principal:outsider", kind: "human", recordedAt: at,
  });
  await workspace.createAccount({
    operationId: "workspace-operation:a-account", id: "account:owner",
    ownerPrincipalId: owner.id, personalWorkspaceId: "workspace:owner", recordedAt: at,
  });
  await workspace.createAccount({
    operationId: "workspace-operation:b-other-account", id: "account:outsider",
    ownerPrincipalId: outsider.id, personalWorkspaceId: "workspace:other", recordedAt: at,
  });
  const org = await workspace.createOrganization({
    operationId: "workspace-operation:c-org", id: "organization:team", workspaceId: "workspace:team",
    ownerMembershipId: "membership:owner", ownerPrincipalId: owner.id, recordedAt: at,
  });
  const invitation = await workspace.inviteMember({
    operationId: "workspace-operation:d-invite", id: "membership:reviewer",
    organizationId: org.organization.id, principalId: reviewer.id,
    invitedByPrincipalId: owner.id, recordedAt: at,
  });

  assert.equal(invitation.status, "invited");
  assert.throws(() => workspace.workspaceFor({ principalId: reviewer.id, workspaceId: org.workspace.id }), /workspace access denied/);
  await assert.rejects(workspace.acceptInvitation({
    operationId: "workspace-operation:e-forged-accept", membershipId: invitation.id,
    principalId: outsider.id, recordedAt: at,
  }), /only the invited principal/);
  assert.equal(workspace.history().length, 7);
  assert.equal((await readFile(workspacesPath, "utf8")).includes("e-forged-accept"), false);

  await workspace.acceptInvitation({
    operationId: "workspace-operation:f-accept", membershipId: invitation.id,
    principalId: reviewer.id, recordedAt: at,
  });
  assert.equal(workspace.workspaceFor({ principalId: reviewer.id, workspaceId: org.workspace.id }).kind, "organization");
  assert.throws(() => workspace.workspaceFor({ principalId: outsider.id, workspaceId: org.workspace.id }), /workspace access denied/);
  assert.deepEqual(workspace.history().map((op) => op.ledgerSequence), [1, 2, 3, 4, 5, 6, 7, 8]);

  // Detached registry snapshots cannot mutate the journal's canonical state.
  const detached = workspace.snapshot();
  detached.registerPrincipal({
    operationId: "workspace-operation:detached", id: "principal:uncommitted", kind: "human", recordedAt: at,
  });
  assert.equal(workspace.history().length, 8);

  work = await DurableWorkJournal.open({ ledgerPath: workPath, workspaces: workspace.snapshot() });
  const instance = await work.createWorkInstance({
    operationId: "work-operation:z-create", id: "work-instance:review", workspaceId: org.workspace.id,
    intent: "Verify the release", createdByPrincipalId: owner.id,
    participants: [owner, reviewer],
    roles: { workOwners: [owner.id], decisionAuthorities: [owner.id], reviewers: [reviewer.id], approvers: [owner.id] },
    context: { ticket: "issue:22" }, recordedAt: at,
  });
  await work.startEpisode({
    operationId: "work-operation:a-episode", id: "work-episode:review",
    workspaceId: org.workspace.id, workInstanceId: instance.id,
    expectedVersion: 1, objective: "Review changes", actorPrincipalId: reviewer.id,
    context: { phase: "review" }, recordedAt: at,
  });
  assert.equal(work.workInstance({ principalId: reviewer.id, workspaceId: org.workspace.id, id: instance.id }).version, 2);
  await work.close();
  work = undefined;
  await workspace.close();

  workspace = await DurableWorkspaceJournal.open({ ledgerPath: workspacesPath });
  work = await DurableWorkJournal.open({ ledgerPath: workPath, workspaces: workspace.snapshot() });
  assert.deepEqual(workspace.history().map((op) => op.kind), [
    "principal.registered", "principal.registered", "principal.registered",
    "account.created", "account.created", "organization.created", "membership.invited", "membership.accepted",
  ]);
  assert.equal(workspace.membershipsFor(reviewer.id)[0]?.status, "active");
  assert.equal(work.workInstance({ principalId: reviewer.id, workspaceId: org.workspace.id, id: instance.id }).version, 2);
  assert.deepEqual(work.history({ principalId: owner.id, workspaceId: org.workspace.id }).map((op) => op.ledgerSequence), [1, 2]);
  assert.equal(workspace.history().some((op) => op.id === "workspace-operation:detached"), false);
  assert.throws(() => work?.workInstance({ principalId: outsider.id, workspaceId: org.workspace.id, id: instance.id }), /workspace access denied/);
});

test("refuses a second writer, an invalid duplicate, and concurrent operations without partial durable commits", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "woyengi-workspace-writer-"));
  const ledgerPath = join(dir, "workspace-operations.json");
  const journal = await DurableWorkspaceJournal.open({ ledgerPath });
  t.after(async () => {
    await journal.close();
    await rm(dir, { recursive: true, force: true });
  });

  await assert.rejects(DurableWorkspaceJournal.open({ ledgerPath }), /writer lock/);
  await journal.registerPrincipal({
    operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt: at,
  });
  const attempts = await Promise.allSettled([
    journal.createAccount({ operationId: "workspace-operation:account-1", id: "account:one",
      ownerPrincipalId: "principal:owner", personalWorkspaceId: "workspace:one", recordedAt: at }),
    journal.createAccount({ operationId: "workspace-operation:account-2", id: "account:two",
      ownerPrincipalId: "principal:owner", personalWorkspaceId: "workspace:two", recordedAt: at }),
  ]);
  assert.deepEqual(attempts.map((entry) => entry.status), ["fulfilled", "rejected"]);
  assert.deepEqual(journal.history().map((op) => op.ledgerSequence), [1, 2]);
  assert.equal(JSON.parse(await readFile(ledgerPath, "utf8")).length, 2);
  await journal.close();
  await assert.rejects(journal.registerPrincipal({
    operationId: "workspace-operation:closed", id: "principal:closed", kind: "human", recordedAt: at,
  }), /closed/);

  const reopened = await DurableWorkspaceJournal.open({ ledgerPath });
  assert.deepEqual(reopened.history().map((op) => op.ledgerSequence), [1, 2]);
  await reopened.close();
});

test("fails closed when stored workspace operations are corrupted or have unknown kinds", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "woyengi-workspace-corruption-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const ledgerPath = join(dir, "workspace-operations.json");

  await writeFile(ledgerPath, "{corrupted", "utf8");
  await assert.rejects(DurableWorkspaceJournal.open({ ledgerPath }), /JSON|parse|Unexpected|position/i);

  await writeFile(ledgerPath, JSON.stringify([{
    id: "workspace-operation:unknown",
    kind: "workspace.superuser-granted",
    ledgerSequence: 1,
    transactionTime: { from: at },
  }]), "utf8");
  await assert.rejects(DurableWorkspaceJournal.open({ ledgerPath }), /unsupported workspace operation kind/);
});
