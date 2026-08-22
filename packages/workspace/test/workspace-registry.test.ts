import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkspaceRegistry } from "../src/index.ts";

test("replays account, workspace, principal, and membership operations with isolation", () => {
  const registry = new WorkspaceRegistry();
  const recordedAt = "2026-08-21T09:00:00+01:00";

  const owner = registry.registerPrincipal({
    operationId: "workspace-operation:register-owner",
    id: "principal:owner",
    kind: "human",
    recordedAt,
  });
  const agent = registry.registerPrincipal({
    operationId: "workspace-operation:register-agent",
    id: "principal:agent",
    kind: "agent",
    recordedAt: "2026-08-21T09:00:01+01:00",
  });
  const service = registry.registerPrincipal({
    operationId: "workspace-operation:register-service",
    id: "principal:service",
    kind: "service",
    recordedAt: "2026-08-21T09:00:02+01:00",
  });
  const automation = registry.registerPrincipal({
    operationId: "workspace-operation:register-automation",
    id: "principal:automation",
    kind: "automation",
    recordedAt: "2026-08-21T09:00:03+01:00",
  });

  const personal = registry.createAccount({
    operationId: "workspace-operation:create-account",
    id: "account:owner",
    ownerPrincipalId: owner.id,
    personalWorkspaceId: "workspace:personal-owner",
    recordedAt: "2026-08-21T09:01:00+01:00",
  });
  const organization = registry.createOrganization({
    operationId: "workspace-operation:create-organization",
    id: "organization:acme",
    workspaceId: "workspace:acme",
    ownerMembershipId: "membership:acme-owner",
    ownerPrincipalId: owner.id,
    recordedAt: "2026-08-21T09:02:00+01:00",
  });
  const invitation = registry.inviteMember({
    operationId: "workspace-operation:invite-agent",
    id: "membership:acme-agent",
    organizationId: organization.organization.id,
    principalId: agent.id,
    invitedByPrincipalId: owner.id,
    recordedAt: "2026-08-21T09:03:00+01:00",
  });

  assert.equal(personal.account.personalWorkspaceId, personal.workspace.id);
  assert.equal(personal.workspace.kind, "personal");
  assert.equal(organization.workspace.kind, "organization");
  assert.equal(organization.membership.status, "active");
  assert.equal(invitation.status, "invited");
  assert.deepEqual(
    [owner.kind, agent.kind, service.kind, automation.kind],
    ["human", "agent", "service", "automation"],
  );
  assert.throws(
    () => registry.switchWorkspace({ principalId: agent.id, workspaceId: organization.workspace.id }),
    /not an active member/,
  );

  const membership = registry.acceptInvitation({
    operationId: "workspace-operation:accept-agent",
    membershipId: invitation.id,
    principalId: agent.id,
    recordedAt: "2026-08-21T09:04:00+01:00",
  });
  const context = registry.switchWorkspace({
    principalId: agent.id,
    workspaceId: organization.workspace.id,
  });

  assert.equal(membership.status, "active");
  assert.equal(context.organizationId, organization.organization.id);
  assert.throws(
    () => registry.workspaceFor({ principalId: agent.id, workspaceId: personal.workspace.id }),
    /workspace access denied/,
  );
  assert.throws(
    () =>
      registry.createAccount({
        operationId: "workspace-operation:create-second-personal",
        id: "account:second-owner-account",
        ownerPrincipalId: owner.id,
        personalWorkspaceId: "workspace:second-personal",
        recordedAt: "2026-08-21T09:05:00+01:00",
      }),
    /principal already owns an account/,
  );
  assert.throws(
    () =>
      registry.registerPrincipal({
        operationId: "workspace-operation:invalid-principal",
        id: "principal id without namespace",
        kind: "human",
        recordedAt: "2026-08-21T09:06:00+01:00",
      }),
    /principal id must start with principal:/,
  );

  const replayed = WorkspaceRegistry.replay([...registry.history()].reverse());
  assert.deepEqual(replayed.workspaceFor(context), organization.workspace);
  assert.equal(replayed.membershipsFor(agent.id)[0]?.status, "active");
  assert.equal(Object.isFrozen(personal.account), true);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(registry.history()), true);
});

test("replays equal-time workspace dependencies by immutable causal sequence", () => {
  const registry = new WorkspaceRegistry();
  const recordedAt = "2026-08-22T00:00:00Z";
  const owner = registry.registerPrincipal({ operationId: "workspace-operation:z-owner", id: "principal:causal-owner", kind: "human", recordedAt });
  registry.createAccount({ operationId: "workspace-operation:a-account", id: "account:causal", ownerPrincipalId: owner.id, personalWorkspaceId: "workspace:causal-personal", recordedAt });

  assert.deepEqual(registry.history().map((operation) => operation.ledgerSequence), [1, 2]);
  const replayed = WorkspaceRegistry.replay([...registry.history()].reverse());
  assert.equal(replayed.workspaceFor({ principalId: owner.id, workspaceId: "workspace:causal-personal" }).kind, "personal");
});
