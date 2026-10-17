import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PostgresCanonicalLedger,
  migratePostgresCanonicalLedger,
  type PostgresConnection,
  type PostgresPool,
} from "../src/index.ts";

interface Row {
  namespace: string;
  scope: string;
  ledger_sequence: number;
  record_id: string;
  record_kind: string;
  record: Record<string, unknown>;
}

class FakePostgres implements PostgresPool {
  counters = new Map<string, number>();
  rows: Row[] = [];
  statements: { sql: string; params: readonly unknown[] }[] = [];
  migrations = 0;
  #active = false;
  #waiting: (() => void)[] = [];

  async connect(): Promise<PostgresConnection> {
    let inTransaction = false;
    let counters = new Map<string, number>();
    let rows: Row[] = [];
    const query = async (sql: string, params: readonly unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> => {
      this.statements.push({ sql, params });
      if (sql.startsWith("CREATE TABLE")) { this.migrations++; return { rows: [] }; }
      if (sql === "BEGIN") {
        if (this.#active) await new Promise<void>((resolve) => this.#waiting.push(resolve));
        this.#active = true;
        inTransaction = true;
        counters = new Map(this.counters);
        rows = structuredClone(this.rows);
        return { rows: [] };
      }
      if (sql === "COMMIT" || sql === "ROLLBACK") {
        if (sql === "COMMIT") { this.counters = counters; this.rows = rows; }
        inTransaction = false;
        this.#active = false;
        this.#waiting.shift()?.();
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO woyengi_ledger_counters")) {
        assert.equal(inTransaction, true);
        const key = String(params[0]) + "|" + String(params[1]);
        if (!counters.has(key)) counters.set(key, 1);
        return { rows: [] };
      }
      if (sql.startsWith("SELECT next_sequence FROM")) {
        const key = String(params[0]) + "|" + String(params[1]);
        const value = counters.get(key);
        if (value === undefined) throw new Error("counter missing");
        return { rows: [{ next_sequence: String(value) }] };
      }
      if (sql.startsWith("UPDATE woyengi_ledger_counters")) {
        counters.set(String(params[0]) + "|" + String(params[1]), Number(params[2]));
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO woyengi_ledger_records")) {
        const [namespace, scope, sequence, id, kind, , payload] = params;
        if (rows.some((row) => row.namespace === namespace && (row.record_id === id
          || row.scope === scope && row.ledger_sequence === sequence))) {
          const error = new Error("duplicate key");
          Object.assign(error, { code: "23505" });
          throw error;
        }
        rows.push({
          namespace: String(namespace), scope: String(scope), ledger_sequence: Number(sequence),
          record_id: String(id), record_kind: String(kind),
          record: JSON.parse(String(payload)) as Record<string, unknown>,
        });
        return { rows: [] };
      }
      if (sql.startsWith("SELECT record FROM")) {
        const wanted = rows.filter((row) => row.namespace === params[0])
          .filter((row) => params.length < 2
            || (sql.includes("AND scope = $2") ? row.scope === params[1] : row.record_id === params[1]))
          .sort((a, b) => a.scope.localeCompare(b.scope) || a.ledger_sequence - b.ledger_sequence);
        return { rows: wanted.map((row) => ({ record: structuredClone(row.record) })) };
      }
      throw new Error("unexpected PostgreSQL SQL: " + sql);
    };
    return { query, release() { if (inTransaction) throw new Error("transaction was not closed"); } };
  }
}

const timestamp = "2026-10-17T18:00:00Z";

test("PostgreSQL ledger migrations and causal sequences persist across reopened adapters", async () => {
  const pool = new FakePostgres();
  await migratePostgresCanonicalLedger(pool);
  assert.equal(pool.migrations, 2);
  const work = PostgresCanonicalLedger.open({ pool, namespace: "work" });
  const registration = { id: "work-operation:z-parent", kind: "work-instance.created",
    workspaceId: "workspace:team", transactionTime: { from: timestamp } };
  const episode = { id: "work-operation:a-child", kind: "work-episode.started",
    workspaceId: "workspace:team", transactionTime: { from: timestamp } };
  const other = { id: "work-operation:other", kind: "work-instance.created",
    workspaceId: "workspace:other", transactionTime: { from: timestamp } };
  await work.appendBatch([registration, episode, other]);
  assert.deepEqual((await work.load({ workspaceId: "workspace:team" })).map((row) => [row.id, row.ledgerSequence]), [
    ["work-operation:z-parent", 1], ["work-operation:a-child", 2],
  ]);
  const reopened = PostgresCanonicalLedger.open({ pool, namespace: "work" });
  await reopened.append({ id: "work-operation:third", kind: "work-episode.started",
    workspaceId: "workspace:team", transactionTime: { from: timestamp } });
  assert.deepEqual((await reopened.load({ workspaceId: "workspace:team" })).map((row) => row.ledgerSequence), [1, 2, 3]);
  assert.deepEqual((await reopened.load({ workspaceId: "workspace:other" })).map((row) => row.ledgerSequence), [1]);
  const workspace = PostgresCanonicalLedger.open({ pool, namespace: "workspace" });
  await workspace.append({ id: "work-operation:z-parent", kind: "principal.registered",
    transactionTime: { from: timestamp } });
  assert.equal((await workspace.load()).length, 1);
  assert.equal((await workspace.load())[0]?.ledgerSequence, 1);
  assert.equal((await reopened.load()).length, 4);
  assert.equal(pool.statements.some((s) => s.sql.includes("FOR UPDATE")), true);
  assert.equal(pool.statements.every((s) => !s.sql.includes("workspace:team") && !s.sql.includes("work-operation:z-parent")), true);
});

test("PostgreSQL ledger rolls back a multi-record duplicate without consuming causal sequence", async () => {
  const pool = new FakePostgres();
  await migratePostgresCanonicalLedger(pool);
  const ledger = PostgresCanonicalLedger.open({ pool, namespace: "work" });
  await ledger.append({ id: "event:existing", kind: "work-instance.created", workspaceId: "workspace:team",
    transactionTime: { from: timestamp } });
  await assert.rejects(ledger.appendBatch([
    { id: "event:next", kind: "work-episode.started", workspaceId: "workspace:team",
      transactionTime: { from: timestamp } },
    { id: "event:existing", kind: "work-episode.started", workspaceId: "workspace:team",
      transactionTime: { from: timestamp } },
  ]), /duplicate/);
  const stored = await ledger.load();
  assert.deepEqual(stored.map((row) => row.id), ["event:existing"]);
  await ledger.append({ id: "event:after-rollback", kind: "work-episode.started",
    workspaceId: "workspace:team", transactionTime: { from: timestamp } });
  assert.deepEqual((await ledger.load()).map((row) => row.ledgerSequence), [1, 2]);
});

test("PostgreSQL ledger serializes competing writers by scoped row locks", async () => {
  const pool = new FakePostgres();
  await migratePostgresCanonicalLedger(pool);
  const first = PostgresCanonicalLedger.open({ pool, namespace: "work" });
  const second = PostgresCanonicalLedger.open({ pool, namespace: "work" });
  const attempts = await Promise.all([
    first.append({ id: "event:first", kind: "work-instance.created", workspaceId: "workspace:team",
      transactionTime: { from: timestamp } }),
    second.append({ id: "event:second", kind: "work-instance.created", workspaceId: "workspace:team",
      transactionTime: { from: timestamp } }),
  ]);
  assert.deepEqual(attempts, [undefined, undefined]);
  assert.deepEqual((await first.load()).map((row) => row.ledgerSequence), [1, 2]);
  assert.equal(pool.statements.filter((s) => s.sql === "COMMIT").length, 2);
});

test("PostgreSQL ledger refuses caller sequences, malformed time, and invalid namespaces before SQL mutation", async () => {
  const pool = new FakePostgres();
  assert.throws(() => PostgresCanonicalLedger.open({ pool, namespace: "work;DROP TABLE" }), /namespace/);
  const ledger = PostgresCanonicalLedger.open({ pool, namespace: "work" });
  await assert.rejects(ledger.append({ id: "bad:sequence", kind: "record.created",
    ledgerSequence: 77, transactionTime: { from: timestamp } }), /assigned by/);
  await assert.rejects(ledger.append({ id: "bad:clock", kind: "record.created",
    transactionTime: { from: "2026-10-17T18:00:00" } }), /offset/);
  assert.equal(pool.rows.length, 0);
});
