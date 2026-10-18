import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { createEpisodeKnowledgeGateway, PostgresEpisodeKnowledgeJournal } from "../index.ts";
import type { EpisodeContextRequest } from "../../../packages/context-gateway/src/index.ts";
import type { PrincipalId, WorkspaceId } from "../../../packages/workspace/src/index.ts";
import type { WorkInstanceId, WorkEpisodeId } from "../../../packages/work/src/index.ts";
import { migratePostgresCanonicalLedger, type PostgresPool } from "../../postgres-storage/index.ts";

const url = process.env.WOYENGI_TEST_DATABASE_URL;
const root = process.env.WOYENGI_PG_MODULE_ROOT;
const at = "2026-10-19T00:01:00Z";
const req: EpisodeContextRequest = {
  principalId: "principal:agent" as PrincipalId,
  workspaceId: "workspace:one" as WorkspaceId,
  workInstanceId: "work-instance:one" as WorkInstanceId,
  workEpisodeId: "work-episode:one" as WorkEpisodeId,
  purpose: "repair", validAt: "2026-10-19T00:08:00Z",
  transactionAt: "2026-10-19T00:10:00Z",
};
const draft = {
  id: "context-segment:draft", workspaceId: req.workspaceId,
  workInstanceId: req.workInstanceId, workEpisodeId: req.workEpisodeId,
  content: { note: "draft" },
  source: { id: "agent-output:draft", kind: "agent-proposal" },
  trustClass: "inferred" as const, validTime: { from: "2026-10-19T00:00:00Z" },
  transactionTime: { from: at }, provenance: ["work-episode:one"],
};
test("WYG-013 durable ContextGateway reads authorized historical episode state", {
  skip: url && root ? false : "requires PostgreSQL and isolated driver",
}, async () => {
  const { Pool } = createRequire(join(root!, "package.json"))("pg") as {
    readonly Pool: new (x: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const poolA = new Pool({ connectionString: url!, max: 4 });
  const poolB = new Pool({ connectionString: url!, max: 4 });
  try {
    await migratePostgresCanonicalLedger(poolA);
    const namespace = "episode_gateway_" + randomUUID().replaceAll("-", "");
    let allowed = true;
    const authorize = async (x: { readonly actorPrincipalId: string;
      readonly workspaceId: string; readonly operation: string }) =>
      allowed && x.workspaceId === req.workspaceId
      && x.actorPrincipalId === (x.operation === "READ" || x.operation === "PROPOSE"
        ? "principal:agent" : "principal:human");
    const a = PostgresEpisodeKnowledgeJournal.open({ pool: poolA, namespace, authorize });
    const b = PostgresEpisodeKnowledgeJournal.open({ pool: poolB, namespace, authorize });
    const gateway = (journal: PostgresEpisodeKnowledgeJournal, request = req) =>
      createEpisodeKnowledgeGateway({
        journal, request,
        evaluateRead: () => ({ allowed: true, rationale: "trusted read" }),
        evaluateWrite: () => ({ allowed: true, rationale: "trusted write" }),
      });
    const read = (journal: PostgresEpisodeKnowledgeJournal, request = req) =>
      gateway(journal, request).reconstructAgentKnowledgeWorkspace({
        ...request, id: "agent-knowledge-workspace:one",
      });
    await gateway(a).writeContextSegment({ request: req, segment: draft });
    assert.deepEqual((await read(b)).segments.map(x => x.id), ["context-segment:draft"]);
    await b.publishTrusted({
      actorPrincipalId: "principal:human", recordedAt: at, rationale: "reviewed",
      segment: { ...draft, id: "context-segment:runbook", trustClass: "verified",
        source: { id: "procedure:runbook", kind: "procedure" } },
    });
    assert.equal((await read(a)).segments.length, 2);
    await a.revoke({
      actorPrincipalId: "principal:human", workspaceId: req.workspaceId,
      segmentId: "context-segment:runbook",
      recordedAt: "2026-10-19T00:15:00Z", reason: "superseded",
    });
    assert.equal((await read(b)).segments.length, 2);
    const later = { ...req, transactionAt: "2026-10-19T00:20:00Z" };
    const projected = await read(b, later);
    assert.deepEqual(projected.segments.map(x => x.id), ["context-segment:draft"]);
    assert.equal(projected.journal.find(x => x.subjectId === "context-segment:runbook")?.reasons[0],
      "revoked");
    await assert.rejects(gateway(b).reconstructAgentKnowledgeWorkspace({
      ...later, id: "agent-knowledge-workspace:wrong",
    }), /does not match bound/);
    allowed = false;
    await assert.rejects(read(b, later), /context read denied/);
  } finally {
    await Promise.all([poolA.end(), poolB.end()]);
  }
});
