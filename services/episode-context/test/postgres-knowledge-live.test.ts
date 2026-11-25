import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { PostgresEpisodeKnowledgeJournal } from "../index.ts";
import type { ContextSegmentRecord } from "../../../packages/context-gateway/src/index.ts";
import { migratePostgresCanonicalLedger, type PostgresPool } from "../../postgres-storage/index.ts";

const url = process.env.WOYENGI_TEST_DATABASE_URL;
const root = process.env.WOYENGI_PG_MODULE_ROOT;
test("WYG-013 PostgreSQL episode knowledge records proposals and revocations durably", {
  skip: url && root ? false : "requires PostgreSQL 16 and isolated driver",
}, async () => {
  const { Pool } = createRequire(join(root!, "package.json"))("pg") as {
    readonly Pool: new (x: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const aPool = new Pool({ connectionString: url!, max: 4 });
  const bPool = new Pool({ connectionString: url!, max: 4 });
  try {
    await migratePostgresCanonicalLedger(aPool);
    const namespace = "episode_" + randomUUID().replaceAll("-", "");
    const authorize = async (x: { readonly actorPrincipalId: string;
      readonly workspaceId: string; readonly operation: string }) =>
      x.workspaceId === "workspace:one" && x.actorPrincipalId ===
        (x.operation === "READ" || x.operation === "PROPOSE"
          ? "principal:agent" : "principal:human");
    const a = PostgresEpisodeKnowledgeJournal.open({ pool: aPool, namespace, authorize });
    const b = PostgresEpisodeKnowledgeJournal.open({ pool: bPool, namespace, authorize });
    const segment = {
      id: "context-segment:one", workspaceId: "workspace:one",
      workInstanceId: "work-instance:one", workEpisodeId: "work-episode:one",
      content: { note: "proposal" }, source: { id: "agent-output:one", kind: "agent-proposal" },
      trustClass: "inferred" as const,
      validTime: { from: "2026-10-19T00:00:00Z" },
      transactionTime: { from: "2026-10-19T00:01:00Z" },
      provenance: ["work-episode:one"],
    } as unknown as ContextSegmentRecord;
    await a.propose({ actorPrincipalId: "principal:agent", segment, rationale: "approved proposal" });
    assert.equal((await b.history({ workspaceId: "workspace:one" })).length, 1);
    await b.revoke({ actorPrincipalId: "principal:human", workspaceId: "workspace:one",
      segmentId: segment.id, recordedAt: "2026-10-19T00:15:00Z", reason: "superseded" });
    assert.deepEqual((await a.history({ workspaceId: "workspace:one" }))
      .map(x => x.ledgerSequence), [1, 2]);
  } finally {
    await Promise.all([aPool.end(), bPool.end()]);
  }
});
