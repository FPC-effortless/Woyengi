# PostgreSQL canonical operation ledger — WYG-019 incremental P1 slice

This is the first PostgreSQL-compatible **storage adapter**, not yet the
whole self-hosted runtime. It provides parameterized SQL, transaction-scoped
counter row locks, atomic operation batches and independent journal
namespaces. The existing LocalCanonicalLedger, offline CLI and local Work API
are unchanged. **No production API is switched to PostgreSQL by this PR.**

## Storage contract

`PostgresCanonicalLedger` is backed by two tables:

- `woyengi_ledger_counters`: `(namespace,scope)` primary key with the next
  immutable causal sequence number. Each append transaction creates and locks
  its scope row using `SELECT ... FOR UPDATE`.
- `woyengi_ledger_records`: immutable JSONB records plus typed, indexed
  columns: namespace, workspace scope, causal sequence, unique operation ID,
  kind and PostgreSQL transaction-time timestamp. The primary key prevents
  duplicate causal positions; `UNIQUE(namespace,record_id)` prevents
  duplicate operations even when scope differs.

`migratePostgresCanonicalLedger(pool)` is an **explicit privileged
migration**, separate from request-serving code. DB migrations require a
trusted migration role. Application roles should have the minimum table
permissions, with `SELECT` on records and counters, `INSERT` on records and
counters, and `UPDATE` only on counters. Do not expose the tables directly
to end users or agent principals. Further DB policies, immutable-record
database triggers, replication/backup, RLS, disaster recovery and isolation
audits remain deployment requirements.

The adapter accepts a *structural* PostgreSQL pool/connection port. For
example, an installed and separately configured `pg.Pool` implements the
port's `connect/query/release` shape (the `pg` dependency is deliberately
not added to the core pnpm lockfile in this first seam):

```ts
import { Pool } from "pg"; // deployment-managed dependency, not bundled here
import {
  migratePostgresCanonicalLedger,
  PostgresCanonicalLedger,
} from "./index.ts";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

try {
  // Execute using a privileged migration role during deployment, not on every
  // API start or under end-user credentials:
  await migratePostgresCanonicalLedger(pool);

  const work = PostgresCanonicalLedger.open({ pool, namespace: "work" });
  await work.append({
    id: "work-operation:example",
    kind: "work-instance.created",
    workspaceId: "workspace:team",
    transactionTime: { from: new Date().toISOString() },
  });
  const operations = await work.load({ workspaceId: "workspace:team" });
  // Pass operations through WorkRegistry.replay before treating as Work state.
} finally {
  await pool.end();
}
```

The code is illustrative: a real installation should configure authenticated
TLS to PostgreSQL, application/migration credentials separately, and **not**
automatically grant an application role schema creation rights. A `Pool`
configuration also needs a connection timeout and bounded connection limit.
Avoid exposing DATABASE_URL or JSONB payload contents in logs.

## Causal / replay invariants

- The adapter never accepts a caller-assigned `ledgerSequence`. SQL row
  locks and a transaction-local counter generate the sequence, surviving
  restart and competing process writers.
- Counter rows are locked in deterministic scope order. Record IDs are
  inserted in deterministic ID order, preserving **input** order for causal
  sequence assignment and minimizing unique-key lock inversions.
- An operation batch commits the records and counters together or rolls back
  both; a duplicate or invalid record cannot consume a causal position.
- `namespace` isolates Work, Workspace and session operation IDs. The
  `scope` is `workspaceId`, or a single legacy/global scope for canonical
  operations without a workspaceId. Namespace/scope/id values are always
  SQL *parameters*, not interpolated SQL.
- `load()`, `load({workspaceId})`, and `get(id)` fetch fresh rows through
  PostgreSQL; no mutable in-process projection is treated as authoritative.
  Query results must still pass domain-specific replay/validation before
  becoming Work, Workspace or session authority.
- The SQL adapter is **asynchronous**, deliberately separate from the
  synchronous `LocalCanonicalLedger` contract. A later domain repository
  composition must make Work, Workspace and sessions replay and commit against
  this provider using asynchronous domain validation inside the transaction
  boundary. This PR does **not** make the existing API multi-host safe.

## Verification and limitations

```shell
node --test services/postgres-storage/test/postgres-ledger.test.ts
pnpm typecheck
pnpm boundaries
pnpm test:all
pnpm benchmark
```

The unit/regression suite tests SQL ordering, transaction rollback,
multi-scope causality, duplicate operation constraints, separation between
journal namespaces and competing writer behavior using a deterministic
PostgreSQL-port test double. **It does not establish successful execution
against a live PostgreSQL server.** A real PostgreSQL integration gate
(including multiple independent clients/processes and failover) is still
required before accepting PostgreSQL-backed WYG-019.

No realtime cluster coordination, distributed sessions, domain repository
integration, agent capability grants, network/TLS server hardening,
independent compute or human QA is supplied by this slice. `passes=false`,
and release readiness remains `NO-GO`.
