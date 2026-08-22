import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { createEvent } from "../../core/src/index.ts";
import type { LedgerRecord } from "../../ledger/src/index.ts";
import { PostgresCanonicalLedger } from "../src/index.ts";

const connectionString = process.env.WOYENGI_TEST_POSTGRES_URL;

test("commits canonical bundles atomically with causal order across PostgreSQL clients and restart", {
  skip: connectionString === undefined ? "WOYENGI_TEST_POSTGRES_URL is not configured" : false,
}, async (context) => {
  assert.ok(connectionString);
  const suffix = randomUUID();
  const workspaceId = `workspace:postgres-${suffix}`;
  const first = record("first", suffix, workspaceId);
  const second = record("second", suffix, workspaceId);
  const rolledBack = record("rolled-back", suffix, workspaceId);

  const left = await PostgresCanonicalLedger.open<LedgerRecord>({ connectionString });
  const right = await PostgresCanonicalLedger.open<LedgerRecord>({ connectionString });
  const stale = await PostgresCanonicalLedger.open<LedgerRecord>({ connectionString });
  context.after(async () => Promise.all([left.close(), right.close(), stale.close()]));

  await Promise.all([left.append(first), right.append(second)]);

  await assert.rejects(stale.appendBatch([rolledBack, first]), /already exists/);

  const reopened = await PostgresCanonicalLedger.open<LedgerRecord>({ connectionString });
  context.after(async () => reopened.close());
  const persisted = reopened.query().filter((item) => item.workspaceId === workspaceId);
  assert.deepEqual(persisted.map((item) => item.ledgerSequence), [1, 2]);
  assert.deepEqual(new Set(persisted.map((item) => item.id)), new Set([first.id, second.id]));
  assert.equal(reopened.get(rolledBack.id), undefined);
});

function record(name: string, suffix: string, workspaceId: string): LedgerRecord {
  return {
    ...createEvent({
      id: `event:postgres-${name}-${suffix}`,
      eventType: "storage:postgres-transaction",
      participants: [{ entityId: "entity:storage-test", role: "actor" }],
      validTime: { from: "2026-08-22T00:00:00Z" },
      recordedAt: "2026-08-22T00:00:00Z",
    }),
    workspaceId,
  };
}
