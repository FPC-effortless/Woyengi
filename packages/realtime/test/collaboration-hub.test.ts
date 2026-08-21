import assert from "node:assert/strict";
import { test } from "node:test";

import type { EventDelivery, PlatformEvent, Subscription } from "../../event-bus/src/index.ts";
import { WorkRegistry } from "../../work/src/index.ts";
import { WorkspaceRegistry } from "../../workspace/src/index.ts";
import { CollaborationHub, type DurableCollaborationEventPort } from "../src/index.ts";

test("resumes authorized collaboration while presence stays ephemeral and public sessions stay filtered", async () => {
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
  const organization = workspaces.createOrganization({
    operationId: "workspace-operation:organization",
    id: "organization:acme",
    workspaceId: "workspace:acme",
    ownerMembershipId: "membership:owner",
    ownerPrincipalId: owner.id,
    recordedAt: at(2),
  });
  const invitation = workspaces.inviteMember({
    operationId: "workspace-operation:invite-reviewer",
    id: "membership:reviewer",
    organizationId: organization.organization.id,
    principalId: reviewer.id,
    invitedByPrincipalId: owner.id,
    recordedAt: at(3),
  });
  workspaces.acceptInvitation({
    operationId: "workspace-operation:accept-reviewer",
    membershipId: invitation.id,
    principalId: reviewer.id,
    recordedAt: at(4),
  });
  const ownerContext = workspaces.switchWorkspace({
    principalId: owner.id,
    workspaceId: organization.workspace.id,
  });
  const reviewerContext = workspaces.switchWorkspace({
    principalId: reviewer.id,
    workspaceId: organization.workspace.id,
  });
  const work = new WorkRegistry();
  const instance = work.createWorkInstance({
    operationId: "work-operation:create-incident",
    id: "work-instance:incident-481",
    workspaceId: organization.workspace.id,
    intent: "Restore checkout",
    createdByPrincipalId: owner.id,
    participants: [owner, reviewer],
    roles: {
      workOwners: [owner.id],
      decisionAuthorities: [owner.id],
      reviewers: [reviewer.id],
      approvers: [owner.id],
    },
    context: {},
    recordedAt: at(5),
  });
  const events = new MemoryDurableEventPort();
  const authorize = (request: {
    readonly principalId: string;
    readonly workspaceId: string;
    readonly workInstanceId: string;
    readonly operation: "SUBSCRIBE" | "PUBLISH" | "PRESENCE";
  }): boolean =>
    request.workspaceId === organization.workspace.id &&
    request.workInstanceId === instance.id &&
    [owner.id, reviewer.id].includes(request.principalId as typeof owner.id);
  const hub = new CollaborationHub({ events, authorize });
  const ownerSession = hub.connect({
    id: "collaboration-session:owner",
    principal: owner,
    workspaceId: organization.workspace.id,
    workspaceContext: ownerContext,
    workInstanceId: instance.id,
    visibility: "internal",
  });
  const reviewerSession = hub.connect({
    id: "collaboration-session:reviewer",
    principal: reviewer,
    workspaceId: organization.workspace.id,
    workspaceContext: reviewerContext,
    workInstanceId: instance.id,
    visibility: "internal",
  });
  const publicSession = hub.connect({
    id: "collaboration-session:public-owner",
    principal: owner,
    workspaceId: organization.workspace.id,
    workspaceContext: ownerContext,
    workInstanceId: instance.id,
    visibility: "public",
  });

  hub.updatePresence(ownerSession, {
    state: "viewing",
    targetId: instance.id,
    recordedAt: at(6),
  });
  assert.equal(events.eventCount, 0);
  assert.equal(hub.presence(ownerSession)[0]?.principalId, owner.id);

  const mutableInternalPayload = {
    summary: "repair agent assigned",
    capabilityId: "capability:deploy-production",
  };
  const internal = await hub.publish(ownerSession, {
    id: "platform-event:collaboration-internal-1",
    expectedVersion: 0,
    visibility: "internal",
    eventType: "work.activity.updated",
    payload: mutableInternalPayload,
    recordedAt: at(7),
  });
  const shared = await hub.publish(reviewerSession, {
    id: "platform-event:collaboration-public-1",
    expectedVersion: 1,
    visibility: "public",
    eventType: "work.status.updated",
    payload: { summary: "incident investigation underway" },
    recordedAt: at(8),
  });

  assert.equal(internal.version, 1);
  assert.equal(shared.version, 2);
  assert.equal(Object.isFrozen(mutableInternalPayload), false);
  mutableInternalPayload.summary = "caller changed this after publish";
  assert.equal(events.events[0]?.kind, "platform-event");
  const ownerEvents = await hub.receive(ownerSession);
  assert.deepEqual(ownerEvents.map((event) => event.version), [1, 2]);
  assert.equal(
    (ownerEvents[0]?.payload as { readonly summary?: string } | undefined)?.summary,
    "repair agent assigned",
  );
  assert.deepEqual((await hub.receive(reviewerSession)).map((event) => event.version), [1, 2]);
  const publicEvents = await hub.receive(publicSession);
  assert.deepEqual(publicEvents.map((event) => event.version), [2]);
  assert.equal(JSON.stringify(publicEvents).includes("capability:deploy-production"), false);
  await assert.rejects(
    () =>
      hub.publish(ownerSession, {
        id: "platform-event:collaboration-stale",
        expectedVersion: 0,
        visibility: "internal",
        eventType: "work.activity.updated",
        payload: {},
        recordedAt: at(9),
      }),
    /collaboration version conflict: expected 0, actual 2/,
  );
  await assert.rejects(
    () =>
      hub.publish(publicSession, {
        id: "platform-event:public-capability-leak",
        expectedVersion: 2,
        visibility: "public",
        eventType: "work.status.updated",
        payload: { capabilities: ["capability:internal"] },
        recordedAt: at(10),
      }),
    /public collaboration payload contains internal capability data/,
  );
  await assert.rejects(
    () =>
      hub.publish(publicSession, {
        id: "platform-event:public-capability-value-leak",
        expectedVersion: 2,
        visibility: "public",
        eventType: "work.status.updated",
        payload: { summary: "capability:deploy-production" },
        recordedAt: at(10),
      }),
    /public collaboration payload contains internal capability data/,
  );
  assert.throws(
    () =>
      hub.connect({
        id: "collaboration-session:mismatch",
        principal: owner,
        workspaceId: organization.workspace.id,
        workspaceContext: reviewerContext,
        workInstanceId: instance.id,
        visibility: "internal",
      }),
    /principal does not match workspace context/,
  );

  await hub.publish(reviewerSession, {
    id: "platform-event:collaboration-public-2",
    expectedVersion: 2,
    visibility: "public",
    eventType: "work.status.updated",
    payload: { summary: "repair ready for verification" },
    recordedAt: at(11),
  });
  const reconnectedHub = new CollaborationHub({ events, authorize });
  const reconnectedOwner = reconnectedHub.connect({
    id: ownerSession.id,
    principal: owner,
    workspaceId: organization.workspace.id,
    workspaceContext: ownerContext,
    workInstanceId: instance.id,
    visibility: "internal",
  });

  assert.deepEqual((await reconnectedHub.receive(reconnectedOwner)).map((event) => event.version), [3]);
  assert.deepEqual(reconnectedHub.presence(reconnectedOwner), []);
  assert.equal(events.events.some((event) => event.topic.includes("presence")), false);
  assert.equal(Object.isFrozen(internal), true);
  assert.equal(Object.isFrozen(publicEvents), true);
});

class MemoryDurableEventPort implements DurableCollaborationEventPort {
  readonly events: PlatformEvent[] = [];
  readonly #cursors = new Map<string, string>();

  get eventCount(): number {
    return this.events.length;
  }

  async publish(event: PlatformEvent): Promise<void> {
    if (this.events.some((candidate) => candidate.id === event.id)) {
      throw new Error(`event already exists: ${event.id}`);
    }
    this.events.push(event);
  }

  async pending(subscription: Subscription): Promise<readonly EventDelivery[]> {
    const cursor = this.#cursors.get(subscription.id);
    const cursorIndex = cursor === undefined ? -1 : this.events.findIndex((event) => event.id === cursor);
    return this.events
      .slice(cursorIndex + 1)
      .filter((event) => subscription.topicPrefixes.some((prefix) => event.topic.startsWith(prefix)))
      .map((event) => ({
        deliveryId: `delivery:${subscription.id}:${event.id}`,
        subscriptionId: subscription.id,
        event,
      }));
  }

  async consume(
    subscription: Subscription,
    handler: (delivery: EventDelivery) => Promise<void>,
  ): Promise<void> {
    for (const delivery of await this.pending(subscription)) {
      await handler(delivery);
      this.#cursors.set(subscription.id, delivery.event.id);
    }
  }
}

function at(minute: number): string {
  return `2026-08-21T12:${String(minute).padStart(2, "0")}:00+01:00`;
}
