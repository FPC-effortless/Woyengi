import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import {
  PostgresCanonicalLedger,
  migratePostgresCanonicalLedger,
  type PostgresPool,
} from "../src/index.ts";

const databaseUrl = process.env.WOYENGI_TEST_DATABASE_URL;
const driverRoot = process.env.WOYENGI_PG_MODULE_ROOT;

/**
 * Runs against an actual PostgreSQL server in the dedicated Actions job.
 * The pg driver is installed in an isolated temporary prefix to avoid
 * pulling database dependencies into the core/offline pnpm lockfile.
 */
test("live PostgreSQL transactions, concurrent pools, rollback and reopen", {
  skip: databaseUrl === undefined || driverRoot === undefined
    ? "requires a live CI PostgreSQL and isolated pg driver" : false,
}, async () => {
  const fromRoot = createRequire(join(driverRoot!, "package.json"));
  const { Pool } = fromRoot("pg") as {
    readonly Pool: new (input: { readonly connectionString: string; readonly max: number }) =>
      PostgresPool & { end(): Promise<void> };
  };
  const primary = new Pool({ connectionString: databaseUrl!, max: 3 });
  const competing = new Pool({ connectionString: databaseUrl!, max: 3 });
  const namespace = "integration_" + randomUUID().replaceAll("-", "");
  const otherNamespace = namespace + "_other";
  const at = "2026-10-17T18:00:00Z";
  try {
    await migratePostgresCanonicalLedger(primary);
    const first = PostgresCanonicalLedger.open({ pool: primary, namespace });
    const second = PostgresCanonicalLedger.open({ pool: competing, namespace });
    const other = PostgresCanonicalLedger.open({ pool: primary, namespace: otherNamespace });

    await first.appendBatch([
      { id: "operation:z-parent", kind: "work-instance.created", workspaceId: "workspace:team",
        transactionTime: { from: at } },
      { id: "operation:a-child", kind: "work-episode.started", workspaceId: "workspace:team",
        transactionTime: { from: at } },
    ]);
    const initial = await second.load({ workspaceId: "workspace:team" });
    assert.deepEqual(initial.map((x) => [x.id, x.ledgerSequence]), [
      ["operation:z-parent", 1], ["operation:a-child", 2],
    ]);

    await Promise.all([
      first.append({ id: "operation:writer-one", kind: "work-episode.started",
        workspaceId: "workspace:team", transactionTime: { from: at } }),
      second.append({ id: "operation:writer-two", kind: "work-episode.started",
        workspaceId: "workspace:team", transactionTime: { from: at } }),
    ]);
    const merged = await second.load({ workspaceId: "workspace:team" });
    assert.deepEqual(merged.map((x) => x.ledgerSequence), [1, 2, 3, 4]);
    assert.deepEqual(merged.slice(2).map((x) => x.id).sort(), ["operation:writer-one", "operation:writer-two"]);

    await assert.rejects(first.appendBatch([
      { id: "operation:should-rollback", kind: "work-episode.started",
        workspaceId: "workspace:team", transactionTime: { from: at } },
      { id: "operation:a-child", kind: "work-episode.started",
        workspaceId: "workspace:team", transactionTime: { from: at } },
    ]));
    assert.equal((await first.load()).length, 4);

    await other.append({ id: "operation:a-child", kind: "principal.registered",
      transactionTime: { from: at } });
    assert.equal((await other.load())[0]?.ledgerSequence, 1);
    assert.equal((await first.get("operation:a-child"))?.ledgerSequence, 2);
    await second.append({ id: "operation:after-rollback", kind: "work-episode.started",
      workspaceId: "workspace:team", transactionTime: { from: at } });
    assert.deepEqual((await first.load({ workspaceId: "workspace:team" })).map((x) => x.ledgerSequence),
      [1, 2, 3, 4, 5]);
  } finally {
    await Promise.all([primary.end(), competing.end()]);
  }
});
