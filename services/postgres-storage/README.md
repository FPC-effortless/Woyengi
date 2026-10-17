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

The Node regression suite tests SQL ordering, transaction rollback,
multi-scope causality, duplicate operation constraints, separation between
journal namespaces and competing writer behavior using a deterministic
PostgreSQL-port test double.

A **separate GitHub Actions PostgreSQL integration job** also starts
PostgreSQL 16, installs `pg@8.16.3` in an isolated temporary prefix (not
in the core/offline lockfile), and runs
`services/postgres-storage/test/postgres-live.test.ts` against that real
server using **two independent database pools**. The live test verifies
migration, append/reload, identical-timestamp parent/child ordering,
simultaneous writer commits, duplicate rollback, causal sequence reuse
prevention, and independent namespaces. CI run
[#39063160754](https://github.com/FPC-effortless/Woyengi/actions/runs/39063160754)
passed all three jobs. The live test is skipped by default during
`pnpm test:all` unless both `WOYENGI_TEST_DATABASE_URL` and
`WOYENGI_PG_MODULE_ROOT` are set; CI's third job sets both.

**This is live evidence for the SQL adapter only**, not a test of
PostgreSQL-backed Work, Workspace, or sessions in a running server.
Multi-process domain-level authorization, cross-ledger transactional
coordination, failover and migration/recovery tests remain required before
accepting WYG-019.

No realtime cluster coordination, distributed sessions, domain repository
integration, agent capability grants, network/TLS server hardening,
independent compute or human QA is supplied by this slice. `passes=false`,
and release readiness remains `NO-GO`.

## PostgreSQL-backed domain journals (next WYG-019 increment)

`PostgresWorkspaceJournal` and `PostgresWorkJournal` compose the SQL
provider with the same `WorkspaceRegistry` / `WorkRegistry` replay
semantics as Woyengi's local journals. Both expose asynchronous, strongly
typed domain operations.

```ts
import {
  PostgresWorkspaceJournal,
  PostgresWorkJournal,
} from "./index.ts";

const workspace = PostgresWorkspaceJournal.open({ pool });
const work = PostgresWorkJournal.open({ pool, workspaces: workspace });

// Trusted operator bootstrap (not public registration/login):
const owner = await workspace.registerPrincipal({
  operationId: "workspace-operation:owner",
  id: "principal:owner",
  kind: "human",
  recordedAt: new Date().toISOString(),
});
// Workspace creation/membership is validated by the canonical registry.
// Only registered, active human workspace participants may join Work.
```

**Concurrency property:** `PostgresCanonicalLedger.appendValidated` takes a
scope's PostgreSQL counter row lock, retrieves the latest committed canonical
operations *inside that same transaction*, executes the domain decision
synchronously under the lock, and atomically appends exactly one validated
operation. Two independent database clients racing to start episodes from
`expectedVersion=1` cannot both commit; one must fail validation without
advancing the ledger sequence. No in-process work cache or filesystem lock
can substitute for this mechanism.

Workspace principal/organization/membership operations use a single global
scope. Work operations use workspace-specific causal scopes; reads rehydrate
authorized Work from PostgreSQL rather than cached projections. A registered
agent is **not** enrolled into Work without an explicit delegated capability.
Separate workspaces cannot read one another's participant-scoped Work history.

The GitHub Actions PostgreSQL 16 integration job now exercises both the
generic SQL adapter and **actual Workspace and Work domain journals**, using
two independently connected database pools, real organization invitations,
membership activation, outsider and agent refusals, repeated reads, causal
history, and an optimistic-version race.

**Not yet included:** the existing loopback `SelfHostWorkApi` and SSE
handler still call the local synchronous journal interfaces. Binding those
routes to these new async PostgreSQL journal methods requires an async API
adapter, authorization/session composition and cross-process notification.
Domain-level Workspace and Work checks currently read Workspace authority
from another PostgreSQL namespace *before* opening a Work transaction.
This is consistent with currently supported append-only invitation and
activation semantics, but **not** an atomic guarantee for any future
membership removal or authority revocation. A production version must
coordinate revocation and Work commits transactionally and address
cross-process realtime delivery, token session persistence in PostgreSQL,
trusted migration credentials and network TLS. No full WYG-019 or release
acceptance is claimed.
