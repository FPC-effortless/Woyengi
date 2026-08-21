import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkspaceRegistry } from "../../workspace/src/index.ts";
import { WorkRegistry } from "../src/index.ts";

test("replays workspace-scoped multiplayer work with durable handoff context", () => {
  const workspaces = new WorkspaceRegistry();
  const owner = workspaces.registerPrincipal({
    operationId: "workspace-operation:owner",
    id: "principal:owner",
    kind: "human",
    recordedAt: at(0),
  });
  const reviewer = workspaces.registerPrincipal({
    operationId: "workspace-operation:reviewer",
    id: "principal:reviewer",
    kind: "human",
    recordedAt: at(1),
  });
  const agent = workspaces.registerPrincipal({
    operationId: "workspace-operation:agent",
    id: "principal:repair-agent",
    kind: "agent",
    recordedAt: at(2),
  });
  const service = workspaces.registerPrincipal({
    operationId: "workspace-operation:service",
    id: "principal:ci-service",
    kind: "service",
    recordedAt: at(3),
  });
  const automation = workspaces.registerPrincipal({
    operationId: "workspace-operation:automation",
    id: "principal:release-automation",
    kind: "automation",
    recordedAt: at(4),
  });
  const organization = workspaces.createOrganization({
    operationId: "workspace-operation:organization",
    id: "organization:acme",
    workspaceId: "workspace:acme",
    ownerMembershipId: "membership:owner",
    ownerPrincipalId: owner.id,
    recordedAt: at(5),
  });
  const workspaceId = organization.workspace.id;
  const work = new WorkRegistry();

  const instance = work.createWorkInstance({
    operationId: "work-operation:create-incident",
    id: "work-instance:incident-481",
    workspaceId,
    intent: "Restore checkout and verify recovery",
    createdByPrincipalId: owner.id,
    participants: [owner, reviewer, agent, service, automation],
    roles: {
      workOwners: [owner.id],
      decisionAuthorities: [owner.id],
      reviewers: [reviewer.id],
      approvers: [owner.id],
    },
    context: { incident: "incident:481", severity: "high" },
    recordedAt: at(6),
  });
  const investigation = work.startEpisode({
    operationId: "work-operation:start-investigation",
    id: "work-episode:investigation",
    workspaceId,
    workInstanceId: instance.id,
    expectedVersion: 1,
    objective: "Find the checkout failure",
    actorPrincipalId: owner.id,
    context: { phase: "investigation" },
    recordedAt: at(7),
  });
  work.startEpisode({
    operationId: "work-operation:start-verification",
    id: "work-episode:verification",
    workspaceId,
    workInstanceId: instance.id,
    expectedVersion: 2,
    objective: "Independently verify recovery",
    actorPrincipalId: reviewer.id,
    context: { phase: "verification" },
    recordedAt: at(8),
  });
  const activity = work.addActivity({
    operationId: "work-operation:add-diagnosis",
    id: "activity:diagnose-checkout",
    activityType: "activity:investigate",
    workspaceId,
    workInstanceId: instance.id,
    workEpisodeId: investigation.id,
    expectedVersion: 3,
    actorPrincipalId: owner.id,
    context: { repository: "repository:checkout" },
    recordedAt: at(9),
  });
  const assignment = work.assignActivity({
    operationId: "work-operation:assign-agent",
    id: "assignment:diagnosis",
    workspaceId,
    workInstanceId: instance.id,
    activityId: activity.id,
    expectedVersion: 4,
    assignedByPrincipalId: owner.id,
    assignee: agent,
    authorizationReference: "capability:assign-agent",
    context: { issue: "issue:147" },
    recordedAt: at(10),
  });
  work.handoffActivity({
    operationId: "work-operation:handoff-reviewer",
    workspaceId,
    workInstanceId: instance.id,
    assignmentId: assignment.id,
    expectedVersion: 5,
    actorPrincipalId: agent.id,
    to: reviewer,
    authorizationReference: "capability:agent-handoff",
    context: { finding: "timeout in payment provider" },
    recordedAt: at(11),
  });
  work.takeOverActivity({
    operationId: "work-operation:agent-takeover",
    workspaceId,
    workInstanceId: instance.id,
    assignmentId: assignment.id,
    expectedVersion: 6,
    actor: agent,
    authorizationReference: "capability:agent-takeover",
    context: { patch: "artifact:patch-147" },
    recordedAt: at(12),
  });
  work.giveBackActivity({
    operationId: "work-operation:give-back",
    workspaceId,
    workInstanceId: instance.id,
    assignmentId: assignment.id,
    expectedVersion: 7,
    actorPrincipalId: agent.id,
    authorizationReference: "capability:agent-give-back",
    context: { tests: "artifact:test-results" },
    recordedAt: at(13),
  });
  work.suspendActivity({
    operationId: "work-operation:suspend-review",
    workspaceId,
    workInstanceId: instance.id,
    assignmentId: assignment.id,
    expectedVersion: 8,
    actorPrincipalId: reviewer.id,
    authorizationReference: "capability:review-suspend",
    context: { blockedBy: "approval:production" },
    recordedAt: at(14),
  });
  const resumed = work.resumeActivity({
    operationId: "work-operation:resume-review",
    workspaceId,
    workInstanceId: instance.id,
    assignmentId: assignment.id,
    expectedVersion: 9,
    actorPrincipalId: reviewer.id,
    authorizationReference: "capability:review-resume",
    context: { approval: "approval:production" },
    recordedAt: at(15),
  });
  work.recordOutcome({
    operationId: "work-operation:record-outcome",
    id: "work-outcome:recovery-verified",
    workspaceId,
    workInstanceId: instance.id,
    expectedVersion: 10,
    actorPrincipalId: reviewer.id,
    value: { summary: "checkout recovery verified" },
    recordedAt: at(16),
  });

  const projected = work.workInstance({ workspaceId, id: instance.id });
  const episodes = work.episodesFor({ workspaceId, workInstanceId: instance.id });
  const stream = work.activityStream({ workspaceId, workInstanceId: instance.id });

  assert.equal(projected.version, 11);
  assert.equal(episodes.length, 2);
  assert.equal(projected.participants.find((item) => item.principalId === agent.id)?.kind, "agent");
  assert.deepEqual(projected.roles.workOwners, [owner.id]);
  assert.deepEqual(projected.roles.decisionAuthorities, [owner.id]);
  assert.deepEqual(projected.roles.reviewers, [reviewer.id]);
  assert.deepEqual(projected.roles.approvers, [owner.id]);
  assert.equal(resumed.assignee.principalId, reviewer.id);
  assert.equal(resumed.status, "active");
  assert.deepEqual(resumed.context, {
    issue: "issue:147",
    finding: "timeout in payment provider",
    patch: "artifact:patch-147",
    tests: "artifact:test-results",
    blockedBy: "approval:production",
    approval: "approval:production",
  });
  assert.deepEqual(projected.outcomes.map((outcome) => outcome.id), [
    "work-outcome:recovery-verified",
  ]);
  assert.deepEqual(stream.map((entry) => entry.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(stream.slice(-6, -1).map((entry) => entry.kind), [
    "activity.handed-off",
    "activity.taken-over",
    "activity.given-back",
    "activity.suspended",
    "activity.resumed",
  ]);
  assert.throws(
    () =>
      work.startEpisode({
        operationId: "work-operation:stale-episode",
        id: "work-episode:stale",
        workspaceId,
        workInstanceId: instance.id,
        expectedVersion: 2,
        objective: "Use stale state",
        actorPrincipalId: owner.id,
        context: {},
        recordedAt: at(17),
      }),
    /work version conflict: expected 2, actual 11/,
  );
  assert.throws(
    () => work.workInstance({ workspaceId: "workspace:other", id: instance.id }),
    /work instance is outside workspace/,
  );

  const replayed = WorkRegistry.replay([...work.history()].reverse());
  assert.deepEqual(replayed.workInstance({ workspaceId, id: instance.id }), projected);
  assert.deepEqual(replayed.assignment({ workspaceId, id: assignment.id }), resumed);
  assert.equal(JSON.stringify(projected).includes("presence"), false);
  assert.equal(JSON.stringify(work.history()).includes("presence"), false);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(resumed.context), true);
  assert.equal(Object.isFrozen(stream), true);
});

function at(minute: number): string {
  return `2026-08-21T10:${String(minute).padStart(2, "0")}:00+01:00`;
}
