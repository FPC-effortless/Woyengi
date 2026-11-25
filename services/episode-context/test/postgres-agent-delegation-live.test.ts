import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import {
  migratePostgresCanonicalLedger, PostgresCanonicalLedger,
  PostgresWorkJournal, PostgresWorkspaceJournal, type PostgresPool,
} from "../../postgres-storage/index.ts";
import {
  PostgresEpisodeDelegationJournal, PostgresEpisodeCapabilityJournal,
  createWorkBoundEpisodePolicies,
} from "../index.ts";
import type { EpisodeContextRequest } from "../../../packages/context-gateway/src/index.ts";
import type { PrincipalId, WorkspaceId } from "../../../packages/workspace/src/index.ts";
import type { WorkInstanceId, WorkEpisodeId } from "../../../packages/work/src/index.ts";

const databaseUrl = process.env.WOYENGI_TEST_DATABASE_URL;
const pgRoot = process.env.WOYENGI_PG_MODULE_ROOT;
const issued = "2026-10-19T10:00:00Z";
const deadline = "2026-10-19T12:00:00Z";

test("WYG-013 immutable SQL agent grants issue, expire and revoke through independently connected Work-bound context readers", {
  skip: databaseUrl && pgRoot ? false : "requires live PostgreSQL and isolated pg module",
}, async () => {
  const { Pool } = createRequire(join(pgRoot!, "package.json"))("pg") as {
    readonly Pool: new (args: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const aPool = new Pool({ connectionString: databaseUrl!, max: 4 });
  const bPool = new Pool({ connectionString: databaseUrl!, max: 4 });
  try {
    await migratePostgresCanonicalLedger(aPool);
    const ns = randomUUID().replaceAll("-", "");
    const wsA = PostgresWorkspaceJournal.open({ pool: aPool, namespace: "ws_" + ns });
    const wsB = PostgresWorkspaceJournal.open({ pool: bPool, namespace: "ws_" + ns });
    const workA = PostgresWorkJournal.open({ pool: aPool, workspaces: wsA, namespace: "work_" + ns });
    const workB = PostgresWorkJournal.open({ pool: bPool, workspaces: wsB, namespace: "work_" + ns });
    const owner = await wsA.registerPrincipal({
      operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt: issued,
    });
    const reviewer = await wsA.registerPrincipal({
      operationId: "workspace-operation:reviewer", id: "principal:reviewer", kind: "human", recordedAt: issued,
    });
    const agent = await wsB.registerPrincipal({
      operationId: "workspace-operation:agent", id: "principal:agent", kind: "agent", recordedAt: issued,
    });
    await wsB.registerPrincipal({
      operationId: "workspace-operation:outsider", id: "principal:outsider", kind: "agent", recordedAt: issued,
    });
    const org = await wsA.createOrganization({
      operationId: "workspace-operation:org", id: "organization:team",
      workspaceId: "workspace:team", ownerPrincipalId: owner.id,
      ownerMembershipId: "membership:owner", recordedAt: issued,
    });
    const invited = await wsB.inviteMember({
      operationId: "workspace-operation:reviewer-invite", id: "membership:reviewer",
      organizationId: org.organization.id, principalId: reviewer.id,
      invitedByPrincipalId: owner.id, recordedAt: issued,
    });
    await wsA.acceptInvitation({
      operationId: "workspace-operation:reviewer-accept",
      membershipId: invited.id, principalId: reviewer.id, recordedAt: issued,
    });
    const work = await workA.createWorkInstance({
      operationId: "work-operation:created", id: "work-instance:one",
      workspaceId: "workspace:team", intent: "Inspect governed state",
      createdByPrincipalId: owner.id, participants: [owner, reviewer],
      roles: { workOwners: [owner.id], decisionAuthorities: [owner.id],
        reviewers: [reviewer.id], approvers: [owner.id] },
      context: {}, recordedAt: issued,
    });
    await workB.startEpisode({
      operationId: "work-operation:episode", id: "work-episode:one",
      workspaceId: work.workspaceId, workInstanceId: work.id,
      actorPrincipalId: owner.id, expectedVersion: 1, objective: "Investigate",
      context: {}, recordedAt: issued,
    });

    let clock = Date.parse(issued);
    const grantNs = "delegations_" + ns;
    const grantsA = PostgresEpisodeDelegationJournal.open({
      pool: aPool, namespace: grantNs, workspaces: wsA, work: workA, now: () => clock,
    });
    const grantsB = PostgresEpisodeDelegationJournal.open({
      pool: bPool, namespace: grantNs, workspaces: wsB, work: workB, now: () => clock,
    });
    const scope = {
      workspaceId: "workspace:team", workInstanceId: "work-instance:one",
      workEpisodeId: "work-episode:one",
    };
    const grant = {
      grantId: "agent-delegation:one", ...scope,
      agentPrincipalId: agent.id, sponsorPrincipalId: owner.id,
      issuerPrincipalId: owner.id,
      operations: ["READ", "PROPOSE"] as const,
      issuedAt: issued, expiresAt: deadline, authorityReference: "decision:human-owner",
      rationale: "Human owner delegates bounded context inspection",
    };
    const query = {
      ...scope, agentPrincipalId: agent.id,
      operation: "READ" as const,
    };
    const context: EpisodeContextRequest = {
      principalId: agent.id as PrincipalId, workspaceId: scope.workspaceId as WorkspaceId,
      workInstanceId: scope.workInstanceId as WorkInstanceId,
      workEpisodeId: scope.workEpisodeId as WorkEpisodeId,
      validAt: "2026-10-19T10:01:00Z", transactionAt: "2026-10-19T10:01:00Z",
      purpose: "inspection",
    };
    const policyB = createWorkBoundEpisodePolicies({
      workspaces: wsB, work: workB, authorizeAgentDelegation: request => grantsB.resolve(request),
    });
    const capabilitiesB = PostgresEpisodeCapabilityJournal.open({
      pool: bPool, namespace: "caps_" + ns, authorize: policyB.capability,
    });
    await assert.rejects(capabilitiesB.query({
      actorPrincipalId: agent.id, request: context,
    }), /read denied/);

    await assert.rejects(grantsA.issue({
      ...grant, issuerPrincipalId: agent.id,
    }), /issuer|sponsor|denied/);
    await assert.rejects(grantsA.issue({
      ...grant, issuerPrincipalId: reviewer.id, sponsorPrincipalId: reviewer.id,
    }), /sponsor|role|denied/);
    await assert.rejects(grantsA.issue({
      ...grant, agentPrincipalId: "principal:missing",
    }), /agent|registered/);
    await assert.rejects(grantsA.issue({
      ...grant, operations: ["READ", "PUBLISH"] as unknown as ["READ", "PROPOSE"],
    }), /delegation operations|READ|PROPOSE/);
    await assert.rejects(grantsA.issue({
      ...grant, workEpisodeId: "work-episode:missing",
    }), /episode|scope/);
    await grantsA.issue(grant);
    assert.deepEqual((await grantsB.history({ workspaceId: scope.workspaceId }))
      .map(x => [x.kind, x.ledgerSequence]), [["agent.delegation.issued", 1]]);
    const decision = await grantsB.resolve(query);
    assert.deepEqual(decision, { sponsorPrincipalId: owner.id });
    assert.equal((await grantsA.resolve({ ...query, operation: "PROPOSE" }))?.sponsorPrincipalId, owner.id);
    assert.equal(await grantsB.resolve({ ...query, workEpisodeId: "work-episode:other" }), undefined);
    assert.equal(await grantsB.resolve({ ...query, agentPrincipalId: "principal:outsider" }), undefined);
    assert.equal(await grantsB.resolve({
      ...query, operation: "PUBLISH" as "READ",
    }), undefined);
    assert.deepEqual(await capabilitiesB.query({
      actorPrincipalId: agent.id, request: context,
    }), []);

    const concurrent = await Promise.allSettled([
      grantsA.issue(grant), grantsB.issue(grant),
    ]);
    assert.deepEqual(concurrent.map(x => x.status), ["rejected", "rejected"]);
    clock = Date.parse("2026-10-19T10:30:00Z");
    const revoked = await grantsB.revoke({
      grantId: grant.grantId, workspaceId: grant.workspaceId,
      revokedByPrincipalId: owner.id, recordedAt: "2026-10-19T10:30:00Z",
      reason: "Owner ended the investigation",
    });
    assert.equal(revoked.kind, "agent.delegation.revoked");
    assert.equal(await grantsA.resolve(query), undefined);
    await assert.rejects(capabilitiesB.query({
      actorPrincipalId: agent.id, request: context,
    }), /read denied/);
    await assert.rejects(grantsA.revoke({
      grantId: grant.grantId, workspaceId: grant.workspaceId,
      revokedByPrincipalId: owner.id, recordedAt: "2026-10-19T10:30:00Z",
      reason: "repeat revocation",
    }), /already revoked/);
    clock = Date.parse("2026-10-19T10:31:00Z");
    const secondGrant = { ...grant, grantId: "agent-delegation:second",
      operations: ["READ"] as const, issuedAt: "2026-10-19T10:31:00Z" };
    await grantsB.issue(secondGrant);
    assert.equal((await grantsA.resolve(query))?.sponsorPrincipalId, owner.id);
    assert.equal(await grantsB.resolve({ ...query, operation: "PROPOSE" }), undefined);
    clock = Date.parse(deadline);
    assert.equal(await grantsA.resolve(query), undefined, "expiry denies without server restart");
    assert.deepEqual((await grantsB.history({ workspaceId: scope.workspaceId }))
      .map(x => [x.kind, x.ledgerSequence]),
    [["agent.delegation.issued", 1], ["agent.delegation.revoked", 2],
      ["agent.delegation.issued", 3]]);

    const raw = PostgresCanonicalLedger.open({ pool: aPool, namespace: grantNs });
    await raw.append({
      id: "agent-delegation-operation:forged", kind: "agent.delegation.superuser-granted",
      workspaceId: scope.workspaceId, transactionTime: { from: deadline },
    });
    await assert.rejects(grantsB.history({ workspaceId: scope.workspaceId }), /unsupported/);
    await assert.rejects(grantsA.resolve(query), /unsupported/);
  } finally {
    await Promise.all([aPool.end(), bPool.end()]);
  }
});
