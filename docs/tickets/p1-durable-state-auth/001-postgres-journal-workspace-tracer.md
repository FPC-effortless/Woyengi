# DSA-001 — PostgreSQL durable journal + Workspace directory tracer

Parent: #14  
Spec: `docs/specs/p1-durable-state-auth.md`  
Type: coding tracer bullet  
Status: BLOCKED until P0 is verified and explicitly human-accepted.

## Outcome contract

From a clean PostgreSQL database, register a human Principal, create its Account/Personal Workspace, create an Organization Workspace, invite/accept a Membership, then destroy all service objects and reconstruct from PostgreSQL. The reconstructed `WorkspaceRegistry` behavior and operation history must match the pre-restart state. Two concurrent writers starting from the same durable sequence must not both publish.

This ticket establishes the only durable-journal abstraction later DSA tickets use. It must not modify constitutional kernel semantics or make SQL rows the domain model.

## Prerequisites / blockers

- Hard P0 gate from the P1 spec is closed with executable verification and human acceptance.
- PostgreSQL 18-compatible test service is available. Existing `deploy/docker/compose.yaml` may be used without modification.
- Dependency/security review permits a maintained Node PostgreSQL client. If not, stop; do not hand-roll the PostgreSQL wire protocol.

## Exclusive future file ownership

This ticket may create/edit only:

- `packages/persistence/src/index.ts`
- `packages/persistence/test/postgres-journal.test.ts`
- `packages/workspace-persistence/src/index.ts`
- `packages/workspace-persistence/test/workspace-directory.test.ts`
- `migrations/p1-durable-state-auth/001_durable_journals.sql`
- `migrations/p1-durable-state-auth/README.md`
- `migrations/manifest.json`
- `package.json`
- `pnpm-lock.yaml`

Do not edit `packages/core/**`, `packages/workspace/**`, shared ADRs, `prd.json`, `progress.txt`, platform API files, Work/App files, or another ticket's files.

`package.json`, `pnpm-lock.yaml`, and `migrations/manifest.json` are reserved to DSA-001 for the duration of this implementation. Parallel agents must not modify them.

## State inputs and outputs

### Inputs

- Existing `WorkspaceOperation` contract and `WorkspaceRegistry.replay()` from `packages/workspace/src/index.ts`.
- A PostgreSQL connection URL supplied at runtime/test time.
- Commands equivalent to existing WorkspaceRegistry commands: register Principal, create Account/Organization, invite/accept Membership.

### Outputs

- Committed durable envelopes with provider-assigned `ledgerSequence`.
- A reconstructed Workspace registry/service derived from durable operations.
- Typed compare-and-append conflicts rather than overwrite.

## Public seam

Implement and export from `packages/persistence/src/index.ts` the spec's `DurableEnvelope` and `DurableJournalPort` responsibilities. Exact TypeScript names may vary only if the same semantics remain explicit:

- read one named journal partition after an optional sequence;
- compare-and-append with `expectedSequence`;
- storage assigns the next positive sequence;
- operation ID is unique within a journal;
- same operation ID + same normalized payload is an idempotent retry;
- same operation ID + different payload is a hard conflict;
- transaction time is retained but never used to break causal ties.

The PostgreSQL adapter must publish operation identity, sequence assignment, payload, and required idempotency/uniqueness state in one transaction.

Implement `WorkspaceStatePort`/service in `packages/workspace-persistence/src/index.ts`. It composes the existing `WorkspaceRegistry` rather than duplicating its access rules. The durable directory journal may preserve the current global WorkspaceRegistry sequence as one `workspace-directory:v1` partition for P1 correctness. Sharding is a later optimization.

The service's mutation protocol is:

1. load/reconstruct the last committed directory state;
2. run the existing domain command against a candidate replay/registry to validate invariants;
3. take only the candidate operation payload, not its in-memory sequence, as the append proposal;
4. compare-and-append against the durable expected sequence;
5. use the storage-returned sequence as the committed sequence;
6. rebuild/apply committed history for the returned domain state;
7. on stale sequence, return a typed conflict or reload/revalidate according to the method contract — never silently overwrite.

## Database contract

`001_durable_journals.sql` must create the minimum provider-neutral journal schema needed by all P1 DSA domain adapters. Required constraints:

- journal name + partition + positive sequence is unique and monotonically assigned under transaction serialization;
- journal name + operation ID is unique;
- payload is immutable after publication;
- transaction time is stored as an instant;
- partition head/sequence update and operation insert commit atomically;
- no plaintext credential-specific column is needed in this ticket.

Prefer additive schema and transaction-safe DDL. `migrations/p1-durable-state-auth/README.md` must state forward compatibility and rollback policy: previous binaries remain supported during the rollback window; destructive down migration is not the default.

Update `migrations/manifest.json` once with this migration. Later DSA tickets must use the generic journal and must not require manifest edits.

## Non-goals

- No session issuance or bearer handling.
- No Work or ApplicationInstance persistence.
- No API routes.
- No current-state snapshot/checkpoint optimization.
- No RLS as a substitute for application WorkspaceContext checks. PostgreSQL RLS may be evaluated later as defense in depth, not correctness authority for this tracer.
- No automatic migration from personal-runtime state.

## Falsifiers / tests

Write failing tests first.

### F1 restart/replay

1. Write Principal -> Account/Personal Workspace -> Organization -> Membership invitation -> acceptance.
2. Capture `WorkspaceStatePort` results and full operation order.
3. Close database client/service and construct a fresh instance.
4. Reload and switch into both authorized workspaces.
5. Assert same IDs, membership state, workspace kinds, and exact committed causal sequence.

Fails if reconstruction depends on process memory or timestamps/IDs reorder equal-time operations.

### F2 concurrent writers

Open two independent service/database clients at the same directory head. Make both attempt distinct valid writes with the same `expectedSequence`.

Required: exactly one compare-and-append succeeds at that sequence. The loser gets a typed stale/conflict result and cannot overwrite or publish the same sequence.

### F3 duplicate operation identity

- Same operation ID + same canonical payload -> deterministic idempotent result/no duplicate row.
- Same operation ID + different payload -> conflict/no second publication.

### F4 partial write

Use an injectable transaction failure point after the operation insert/head update has been attempted but before commit. Reconnect with a new client.

Required: neither journal row nor advanced partition head is visible. Retrying the operation can commit normally.

### F5 domain invariant preservation

Persist/replay negative cases already enforced in `WorkspaceRegistry`: duplicate Personal Workspace ownership, accepting an invalid invitation, and switching a non-member into an Organization Workspace. Durable wrapper must fail with no journal advance.

## Verification ladder

Run and record actual evidence in this order:

1. targeted pure adapter/unit tests;
2. start/use a real PostgreSQL test service;
3. `WOYENGI_TEST_POSTGRES_URL=... node --test packages/persistence/test/postgres-journal.test.ts packages/workspace-persistence/test/workspace-directory.test.ts`;
4. existing workspace tests;
5. `pnpm typecheck`;
6. `pnpm boundaries`;
7. `pnpm test:all`;
8. relevant security/production gate if dependency/schema changes are covered by it.

A skipped/mocked PostgreSQL run does not satisfy F1-F4.

## Evidence to preserve

- Exact migration version applied.
- PostgreSQL version/test topology.
- Test command + pass/fail output.
- A restart trace showing before/after operation IDs and sequences.
- Concurrent-writer result proving only one publication at the contested head.
- Failure-injection result proving transaction rollback.
- Dependency audit result for the selected PostgreSQL client.

Never include database passwords/URLs containing credentials in the handoff.

## Authority / external effects

This ticket creates internal durable-state effects in a test/self-host database only. It does not create semantic commits or external business effects. Database migration is an operator effect; destructive migration is prohibited in this ticket.

## Rollback / replay

- Replay is always from committed journal sequence.
- Rollback of the code release uses the previous binary against the additive schema.
- No migration step deletes older local JSON state or domain history.
- If a migration cannot be applied transactionally and safely, block and escalate rather than partially publishing schema.

## Completion gate

Done only when the real-PostgreSQL restart, concurrency, duplicate-ID, partial-write, and WorkspaceRegistry invariant falsifiers pass and the public journal/Workspace ports are stable for DSA-002/003/004.
