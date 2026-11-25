import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import {
  PostgresWorkJournal, PostgresWorkspaceJournal, migratePostgresCanonicalLedger,
  type PostgresPool,
} from "../../postgres-storage/index.ts";
import {
  createWorkBoundEpisodePolicies, PostgresEpisodeCapabilityJournal,
  PostgresEpisodeKnowledgeJournal,
} from "../index.ts";
import type { EpisodeContextRequest } from "../../../packages/context-gateway/src/index.ts";
import type { PrincipalId, WorkspaceId } from "../../../packages/workspace/src/index.ts";
import type { WorkInstanceId, WorkEpisodeId } from "../../../packages/work/src/index.ts";

const database = process.env.WOYENGI_TEST_DATABASE_URL;
const driver = process.env.WOYENGI_PG_MODULE_ROOT;
const at = "2026-10-19T04:00:00Z";
const request: EpisodeContextRequest = {
  principalId: "principal:agent" as PrincipalId,
  workspaceId: "workspace:team" as WorkspaceId,
  workInstanceId: "work-instance:service" as WorkInstanceId,
  workEpisodeId: "work-episode:inspect" as WorkEpisodeId,
  purpose: "inspection",
  validAt: "2026-10-19T04:01:00Z",
  transactionAt: "2026-10-19T04:03:00Z",
};

test("WYG-013 reads real Work membership, role and active episode on every delegated agent context request", {
  skip: database && driver ? false : "requires PostgreSQL 16 and isolated pg driver",
}, async () => {
  const { Pool } = createRequire(join(driver!, "package.json"))("pg") as {
    readonly Pool: new (arg: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const poolA = new Pool({ connectionString: database!, max: 4 });
  const poolB = new Pool({ connectionString: database!, max: 4 });
  try {
    await migratePostgresCanonicalLedger(poolA);
    const suffix = randomUUID().replaceAll("-", "");
    const workspacesA = PostgresWorkspaceJournal.open({ pool: poolA, namespace: "ws_" + suffix });
    const workspacesB = PostgresWorkspaceJournal.open({ pool: poolB, namespace: "ws_" + suffix });
    const workA = PostgresWorkJournal.open({ pool: poolA, namespace: "work_" + suffix, workspaces: workspacesA });
    const workB = PostgresWorkJournal.open({ pool: poolB, namespace: "work_" + suffix, workspaces: workspacesB });
    const owner = await workspacesA.registerPrincipal({
      operationId: "workspace-operation:owner", id: "principal:owner", kind: "human", recordedAt: at,
    });
    const reviewer = await workspacesA.registerPrincipal({
      operationId: "workspace-operation:reviewer", id: "principal:reviewer", kind: "human", recordedAt: at,
    });
    await workspacesA.registerPrincipal({
      operationId: "workspace-operation:outside", id: "principal:outside", kind: "human", recordedAt: at,
    });
    const agent = await workspacesB.registerPrincipal({
      operationId: "workspace-operation:agent", id: "principal:agent", kind: "agent", recordedAt: at,
    });
    const org = await workspacesA.createOrganization({
      operationId: "workspace-operation:org", id: "organization:team",
      workspaceId: "workspace:team", ownerPrincipalId: owner.id,
      ownerMembershipId: "membership:owner", recordedAt: at,
    });
    const invite = await workspacesB.inviteMember({
      operationId: "workspace-operation:invite", id: "membership:reviewer",
      organizationId: org.organization.id, principalId: reviewer.id,
      invitedByPrincipalId: owner.id, recordedAt: at,
    });
    await workspacesA.acceptInvitation({
      operationId: "workspace-operation:accept", membershipId: invite.id,
      principalId: reviewer.id, recordedAt: at,
    });
    const instance = await workA.createWorkInstance({
      operationId: "work-operation:create", id: "work-instance:service",
      workspaceId: "workspace:team", intent: "inspect governed workload",
      createdByPrincipalId: owner.id, participants: [owner, reviewer],
      roles: { workOwners: [owner.id], decisionAuthorities: [owner.id],
        reviewers: [reviewer.id], approvers: [owner.id] },
      context: {}, recordedAt: at,
    });
    await workB.startEpisode({
      operationId: "work-operation:episode", id: "work-episode:inspect",
      workInstanceId: instance.id, workspaceId: instance.workspaceId,
      expectedVersion: 1, objective: "inspect", actorPrincipalId: owner.id,
      context: {}, recordedAt: at,
    });

    let delegated = false;
    let delegateCalls = 0;
    const delegate = async (input: {
      readonly agentPrincipalId: string; readonly workspaceId: string;
      readonly workInstanceId: string; readonly workEpisodeId: string;
      readonly operation: string;
    }) => {
      delegateCalls++;
      return delegated && input.agentPrincipalId === agent.id
        && input.workspaceId === "workspace:team"
        && input.workInstanceId === "work-instance:service"
        && input.workEpisodeId === "work-episode:inspect"
        && (input.operation === "READ" || input.operation === "PROPOSE")
        ? { sponsorPrincipalId: owner.id } : undefined;
    };
    const policyA = createWorkBoundEpisodePolicies({
      workspaces: workspacesA, work: workA, authorizeAgentDelegation: delegate,
    });
    const policyB = createWorkBoundEpisodePolicies({
      workspaces: workspacesB, work: workB, authorizeAgentDelegation: delegate,
    });
    const knowledge = PostgresEpisodeKnowledgeJournal.open({
      pool: poolA, namespace: "kn_" + suffix, authorize: policyA.knowledge,
    });
    const capabilities = PostgresEpisodeCapabilityJournal.open({
      pool: poolB, namespace: "cap_" + suffix, authorize: policyB.capability,
    });
    const candidate = {
      id: "episode-capability:inspect", kind: "provider" as const,
      workspaceId: request.workspaceId,
      workInstanceId: request.workInstanceId,
      workEpisodeId: request.workEpisodeId,
      details: { provider: "provider:local", action: "read-only-inspection" },
      validTime: { from: at }, transactionTime: { from: at },
    };
    await capabilities.publish({
      actorPrincipalId: owner.id, candidate, authorityReference: "decision:operator",
      rationale: "approved inspected provider only", recordedAt: at,
    });
    await assert.rejects(capabilities.publish({
      actorPrincipalId: reviewer.id, candidate: { ...candidate, id: "episode-capability:forged" },
      authorityReference: "decision:forged", rationale: "role escalation", recordedAt: at,
    }), /denied/);
    await assert.rejects(capabilities.publish({
      actorPrincipalId: agent.id, candidate: { ...candidate, id: "episode-capability:self" },
      authorityReference: "decision:self", rationale: "self grant", recordedAt: at,
    }), /denied/);
    await assert.rejects(capabilities.query({
      actorPrincipalId: agent.id, request,
    }), /read denied/);
    assert.equal(delegateCalls > 0, true);
    delegated = true;
    assert.deepEqual((await capabilities.query({ actorPrincipalId: agent.id, request }))
      .map(x => x.id), [candidate.id]);

    await knowledge.propose({
      actorPrincipalId: agent.id, rationale: "unverified inspection finding",
      segment: {
        id: "context-segment:inspection", workspaceId: request.workspaceId,
        workInstanceId: request.workInstanceId, workEpisodeId: request.workEpisodeId,
        content: { note: "provider inspection suggested follow-up" },
        source: { id: "agent-output:inspection", kind: "agent-proposal" },
        trustClass: "inferred", validTime: { from: at },
        transactionTime: { from: at }, provenance: ["work-episode:inspect"],
      },
    });
    assert.equal((await knowledge.query({ actorPrincipalId: agent.id, request })).length, 1);
    await assert.rejects(knowledge.publishTrusted({
      actorPrincipalId: agent.id, recordedAt: at, rationale: "self promotion",
      segment: {
        id: "context-segment:verified", workspaceId: request.workspaceId,
        workInstanceId: request.workInstanceId, workEpisodeId: request.workEpisodeId,
        content: { note: "claiming authority" },
        source: { id: "procedure:inspection", kind: "procedure" },
        trustClass: "verified", validTime: { from: at },
        transactionTime: { from: at }, provenance: ["work-episode:inspect"],
      },
    }), /denied/);
    await assert.rejects(knowledge.query({
      actorPrincipalId: agent.id,
      request: { ...request, workEpisodeId: "work-episode:uncreated" as WorkEpisodeId },
    }), /read denied/);

    // Revocation in independent authority source is reflected on the very
    // next read or proposal, not delayed until the SQL connection restarts.
    delegated = false;
    await assert.rejects(capabilities.query({
      actorPrincipalId: agent.id, request,
    }), /read denied/);
    await assert.rejects(knowledge.propose({
      actorPrincipalId: agent.id, rationale: "after revocation",
      segment: {
        id: "context-segment:after-revocation", workspaceId: request.workspaceId,
        workInstanceId: request.workInstanceId, workEpisodeId: request.workEpisodeId,
        content: { note: "not authorized" },
        source: { id: "agent-output:after", kind: "agent-proposal" },
        trustClass: "inferred", validTime: { from: at },
        transactionTime: { from: at }, provenance: ["work-episode:inspect"],
      },
    }), /denied/);
    assert.equal((await knowledge.history({ workspaceId: request.workspaceId })).length, 1);
    await assert.rejects(capabilities.query({
      actorPrincipalId: "principal:outside",
      request: { ...request, principalId: "principal:outside" as PrincipalId },
    }), /read denied/);
    assert.deepEqual((await capabilities.query({
      actorPrincipalId: owner.id, request: { ...request, principalId: owner.id },
    })).map(x => x.id), [candidate.id]);
  } finally {
    await Promise.all([poolA.end(), poolB.end()]);
  }
});
