import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import {
  PostgresEpisodeCapabilityJournal, PostgresEpisodeKnowledgeJournal,
  createEpisodeKnowledgeGateway,
} from "../index.ts";
import { migratePostgresCanonicalLedger, PostgresCanonicalLedger, type PostgresPool } from "../../postgres-storage/index.ts";
import type { EpisodeContextRequest } from "../../../packages/context-gateway/src/index.ts";
import type { PrincipalId, WorkspaceId } from "../../../packages/workspace/src/index.ts";
import type { WorkEpisodeId, WorkInstanceId } from "../../../packages/work/src/index.ts";

const url = process.env.WOYENGI_TEST_DATABASE_URL;
const root = process.env.WOYENGI_PG_MODULE_ROOT;
const t0 = "2026-10-19T02:00:00Z";
const request: EpisodeContextRequest = {
  principalId: "principal:agent" as PrincipalId,
  workspaceId: "workspace:one" as WorkspaceId,
  workInstanceId: "work-instance:one" as WorkInstanceId,
  workEpisodeId: "work-episode:one" as WorkEpisodeId,
  purpose: "repair", validAt: "2026-10-19T02:10:00Z",
  transactionAt: "2026-10-19T02:20:00Z",
};
const candidate = {
  id: "episode-capability:provider-one",
  kind: "provider" as const,
  workspaceId: request.workspaceId,
  workInstanceId: request.workInstanceId,
  workEpisodeId: request.workEpisodeId,
  details: { provider: "provider:local-repair", operation: "repair:inspect" },
  validTime: { from: t0 },
  transactionTime: { from: t0 },
};

test("WYG-013 canonical capability context limits read, publication and revocation to trusted episode scope across PostgreSQL pools", {
  skip: url && root ? false : "requires live PostgreSQL and isolated pg driver",
}, async () => {
  const { Pool } = createRequire(join(root!, "package.json"))("pg") as {
    readonly Pool: new (arg: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const poolA = new Pool({ connectionString: url!, max: 4 });
  const poolB = new Pool({ connectionString: url!, max: 4 });
  try {
    await migratePostgresCanonicalLedger(poolA);
    const suffix = randomUUID().replaceAll("-", "");
    const ns = "episode_cap_" + suffix;
    const knowledgeNs = "episode_knowledge_" + suffix;
    let allowRead = true;
    const authorize = async (x: { readonly actorPrincipalId: string;
      readonly operation: "READ" | "PUBLISH" | "REVOKE";
      readonly workspaceId: string; readonly workInstanceId: string;
      readonly workEpisodeId: string }) =>
      x.workspaceId === "workspace:one" && x.workInstanceId === "work-instance:one"
      && x.workEpisodeId === "work-episode:one"
      && (x.operation === "READ" ? allowRead && x.actorPrincipalId === "principal:agent"
        : x.actorPrincipalId === "principal:human");
    const a = PostgresEpisodeCapabilityJournal.open({ pool: poolA, namespace: ns, authorize });
    const b = PostgresEpisodeCapabilityJournal.open({ pool: poolB, namespace: ns, authorize });
    const reader = (journal: PostgresEpisodeCapabilityJournal, r = request) =>
      journal.query({ actorPrincipalId: r.principalId, request: r });
    assert.deepEqual(await reader(a), []);
    await assert.rejects(a.publish({
      actorPrincipalId: "principal:agent", candidate,
      authorityReference: "decision:capability", recordedAt: t0,
      rationale: "worker self-granted capability",
    }), /denied/);
    await assert.rejects(a.publish({
      actorPrincipalId: "principal:human", candidate: {
        ...candidate, workspaceId: "workspace:other" as WorkspaceId,
      }, authorityReference: "decision:capability", recordedAt: t0,
      rationale: "wrong workspace",
    }), /denied/);
    await a.publish({
      actorPrincipalId: "principal:human", candidate,
      authorityReference: "decision:capability", recordedAt: t0,
      rationale: "workspace operator approved scoped local provider",
    });
    assert.deepEqual((await reader(b)).map(x => x.id), [candidate.id]);
    const gateway = (journal: PostgresEpisodeCapabilityJournal, r = request) =>
      createEpisodeKnowledgeGateway({
        journal: PostgresEpisodeKnowledgeJournal.open({
          pool: poolB, namespace: knowledgeNs, authorize: async () => false,
        }),
        capabilities: journal,
        request: r,
        evaluateApplicability: (c, scope) => ({
          applicable: c.kind === "provider" && c.workEpisodeId === scope.workEpisodeId,
          rationale: "trusted episode applicability decision",
        }),
      });
    const context = await gateway(b).buildEpisodeCapabilityContext({
      ...request, id: "episode-capability-context:one",
    });
    assert.equal(context.providers.length, 1);
    assert.deepEqual(context.providers[0]?.details, candidate.details);
    assert.equal(context.authority.length, 0);
    assert.equal(context.budgets.length, 0);
    assert.equal(context.journal[0]?.decision, "included");
    await assert.rejects(gateway(b).buildEpisodeCapabilityContext({
      ...request, workEpisodeId: "work-episode:other" as WorkEpisodeId,
      id: "episode-capability-context:other",
    }), /bound authenticated/);
    const race = await Promise.allSettled([a.publish({
      actorPrincipalId: "principal:human", candidate, authorityReference: "decision:capability",
      recordedAt: t0, rationale: "duplicate",
    }), b.publish({
      actorPrincipalId: "principal:human", candidate, authorityReference: "decision:capability",
      recordedAt: t0, rationale: "duplicate",
    })]);
    assert.deepEqual(race.map(x => x.status), ["rejected", "rejected"]);
    const prior = await reader(b, { ...request, transactionAt: "2026-10-19T01:59:59Z" });
    assert.deepEqual(prior, []);
    await b.revoke({
      actorPrincipalId: "principal:human", workspaceId: candidate.workspaceId,
      capabilityId: candidate.id, recordedAt: "2026-10-19T02:25:00Z",
      reason: "provider no longer authorized",
    });
    const before = await reader(a);
    assert.equal(before.length, 1);
    const after = await reader(b, { ...request, transactionAt: "2026-10-19T02:30:00Z" });
    assert.equal(after.length, 1);
    assert.equal(after[0]?.revokedAt !== undefined, true);
    const later = { ...request, transactionAt: "2026-10-19T02:30:00Z" };
    assert.equal((await gateway(a, later).buildEpisodeCapabilityContext({
      ...later, id: "episode-capability-context:later",
    })).providers.length, 0);
    allowRead = false;
    await assert.rejects(reader(a), /read denied/);
    await assert.rejects(b.revoke({
      actorPrincipalId: "principal:human", workspaceId: candidate.workspaceId,
      capabilityId: candidate.id, recordedAt: "2026-10-19T02:35:00Z",
      reason: "repeat",
    }), /already revoked/);
    assert.deepEqual((await a.history({ workspaceId: "workspace:one" }))
      .map(x => x.ledgerSequence), [1, 2]);
    const raw = PostgresCanonicalLedger.open({ pool: poolA, namespace: ns });
    await raw.append({
      id: "episode-capability:forged-op", kind: "episode.capability.root-granted",
      workspaceId: "workspace:one", transactionTime: { from: t0 },
    });
    await assert.rejects(b.history({ workspaceId: "workspace:one" }), /unsupported/);
  } finally {
    await Promise.all([poolA.end(), poolB.end()]);
  }
});
