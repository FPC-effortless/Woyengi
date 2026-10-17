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
} from "../src/index.ts";

const url = process.env.WOYENGI_TEST_DATABASE_URL;
const moduleRoot = process.env.WOYENGI_PG_MODULE_ROOT;
const at = "2026-10-17T20:00:00Z";
const ready = url !== undefined && moduleRoot !== undefined;

test("PostgreSQL Work and Workspace journals enforce causal ACL and replay across independent database pools", {
  skip: ready ? false : "requires PostgreSQL and the isolated pg driver",
}, async () => {
  const requireFrom = createRequire(join(moduleRoot!, "package.json"));
  const { Pool } = requireFrom("pg") as {
    readonly Pool: new (input: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const alphaPool = new Pool({ connectionString: url!, max: 4 });
  const betaPool = new Pool({ connectionString: url!, max: 4 });
  const suffix = randomUUID().replaceAll("-", "");
  const workspaceNamespace = `workspace_${suffix}`;
  const workNamespace = `work_${suffix}`;
  try {
    await migratePostgresCanonicalLedger(alphaPool);
    const workspaceA = PostgresWorkspaceJournal.open({ pool: alphaPool, namespace: workspaceNamespace });
    const workspaceB = PostgresWorkspaceJournal.open({ pool: betaPool, namespace: workspaceNamespace });
    const owner = await workspaceA.registerPrincipal({
      operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt: at,
    });
    const other = await workspaceB.registerPrincipal({
      operationId: "workspace-operation:other", id: "principal:other", kind: "human", recordedAt: at,
    });
    const outsider = await workspaceA.registerPrincipal({
      operationId: "workspace-operation:outsider", id: "principal:outsider", kind: "human", recordedAt: at,
    });
    await workspaceB.registerPrincipal({
      operationId: "workspace-operation:agent", id: "principal:agent", kind: "agent", recordedAt: at,
    });
    assert.deepEqual((await workspaceA.history()).map((op) => op.ledgerSequence), [1, 2, 3, 4]);

    const organization = await workspaceA.createOrganization({
      operationId: "workspace-operation:org", id: "organization:team",
      workspaceId: "workspace:team", ownerPrincipalId: owner.id, ownerMembershipId: "membership:owner",
      recordedAt: at,
    });
    const invite = await workspaceB.inviteMember({
      operationId: "workspace-operation:invite", id: "membership:other",
      organizationId: organization.organization.id, principalId: other.id,
      invitedByPrincipalId: owner.id, recordedAt: at,
    });
    await assert.rejects(workspaceA.workspaceFor({
      principalId: other.id, workspaceId: organization.workspace.id,
    }), /workspace access denied/);
    await workspaceA.acceptInvitation({
      operationId: "workspace-operation:accept", membershipId: invite.id,
      principalId: other.id, recordedAt: at,
    });
    assert.equal((await workspaceB.workspaceFor({
      principalId: other.id, workspaceId: organization.workspace.id,
    })).id, "workspace:team");

    const workA = PostgresWorkJournal.open({ pool: alphaPool, namespace: workNamespace, workspaces: workspaceA });
    const workB = PostgresWorkJournal.open({ pool: betaPool, namespace: workNamespace, workspaces: workspaceB });
    await assert.rejects(workB.createWorkInstance({
      operationId: "work-operation:forged", id: "work-instance:forged",
      workspaceId: "workspace:team", intent: "forgery", createdByPrincipalId: outsider.id,
      participants: [owner], roles: { workOwners: [owner.id], decisionAuthorities: [owner.id],
        reviewers: [], approvers: [owner.id] },
      context: {}, recordedAt: at,
    }), /workspace access denied/);
    await assert.rejects(workA.createWorkInstance({
      operationId: "work-operation:agent", id: "work-instance:agent",
      workspaceId: "workspace:team", intent: "agent enrollment", createdByPrincipalId: owner.id,
      participants: [owner, { id: "principal:agent", kind: "agent" }],
      roles: { workOwners: [owner.id], decisionAuthorities: [owner.id],
        reviewers: [], approvers: [owner.id] },
      context: {}, recordedAt: at,
    }), /delegated capability/);

    const created = await workA.createWorkInstance({
      operationId: "work-operation:create", id: "work-instance:team",
      workspaceId: "workspace:team", intent: "Review a release", createdByPrincipalId: owner.id,
      participants: [owner, other],
      roles: { workOwners: [owner.id], decisionAuthorities: [owner.id],
        reviewers: [other.id], approvers: [owner.id] },
      context: { goal: "integration" }, recordedAt: at,
    });
    assert.equal(created.version, 1);
    assert.equal((await workB.workInstance({
      principalId: other.id, workspaceId: "workspace:team", id: created.id,
    })).version, 1);

    // Both independent pools race from the same optimistic version. Only one
    // action can commit; the transaction lock protects domain replay + append.
    const attempts = await Promise.allSettled([
      workA.startEpisode({
        operationId: "work-operation:episode-a", id: "work-episode:a",
        workInstanceId: created.id, workspaceId: "workspace:team",
        objective: "Inspect release", actorPrincipalId: owner.id,
        expectedVersion: 1, context: {}, recordedAt: at,
      }),
      workB.startEpisode({
        operationId: "work-operation:episode-b", id: "work-episode:b",
        workInstanceId: created.id, workspaceId: "workspace:team",
        objective: "Inspect release", actorPrincipalId: other.id,
        expectedVersion: 1, context: {}, recordedAt: at,
      }),
    ]);
    assert.deepEqual(attempts.map((x) => x.status).sort(), ["fulfilled", "rejected"]);
    assert.equal((await workA.workInstance({
      principalId: owner.id, workspaceId: "workspace:team", id: created.id,
    })).version, 2);
    const history = await workB.history({ principalId: other.id, workspaceId: "workspace:team" });
    assert.deepEqual(history.map((op) => op.ledgerSequence), [1, 2]);
    assert.equal(history[0]?.kind, "work-instance.created");
    assert.equal(history[1]?.kind, "work-episode.started");

    await assert.rejects(workB.history({ principalId: outsider.id, workspaceId: "workspace:team" }),
      /workspace access denied/);
    await assert.rejects(workB.workInstance({
      principalId: outsider.id, workspaceId: "workspace:team", id: created.id,
    }), /workspace access denied/);
    const outsiderWorkspace = await workspaceB.createAccount({
      operationId: "workspace-operation:outsider-account", id: "account:outsider",
      ownerPrincipalId: outsider.id, personalWorkspaceId: "workspace:outsider", recordedAt: at,
    });
    assert.equal(outsiderWorkspace.workspace.id, "workspace:outsider");
    assert.equal((await workA.history({ principalId: owner.id, workspaceId: "workspace:team" })).length, 2);
  } finally {
    await Promise.all([alphaPool.end(), betaPool.end()]);
  }
});
