# DSA-003 — Durable WorkInstance / WorkEpisode tracer

Parent: #14  
Spec: `docs/specs/p1-durable-state-auth.md`  
Type: coding tracer bullet  
Status: BLOCKED until P0 is accepted and DSA-001 is complete.

## Outcome contract

In an authorized Workspace, create a WorkInstance, start an episode, add an activity, create/complete an assignment and record an outcome; then destroy all Work service objects and reconstruct from PostgreSQL with the same Work version, episode state, activity/assignment/outcome state and causal operation order. Concurrent stale mutations must conflict rather than overwrite.

The tracer must reuse `WorkRegistry` domain validation/replay. PostgreSQL is the publication mechanism, not a second Work domain model.

## Prerequisites / blockers

- P0 verification + human acceptance gate is closed.
- DSA-001 `DurableJournalPort` and Workspace directory port are stable and real-PostgreSQL verified.
- No dependency on DSA-002 is required for package-level persistence tests; DSA-005 will compose authorization at the API edge.

## Exclusive future file ownership

This ticket may create/edit only:

- `packages/work-persistence/src/index.ts`
- `packages/work-persistence/test/durable-work.test.ts`

Do not edit `packages/work/**`, Workspace/session/API/App source, persistence-provider source, migrations, root dependency files, shared ADRs, `prd.json`, or `progress.txt`.

## State inputs and outputs

### Inputs

- Existing `WorkRegistry` / `WorkOperation` behavior from `packages/work/src/index.ts`.
- DSA-001 `DurableJournalPort`.
- A trusted `WorkspaceContext` already resolved by the caller; package service must reject a Work/resource Workspace mismatch.
- Existing Work command inputs including `expectedVersion` and any `authorizationReference` fields.

### Durable partition

Use journal `work:v1`, partitioned by immutable `workspaceId` so durable publication sequence remains per Workspace, matching the current Work causal-ledger semantics.

The committed `WorkOperation.ledgerSequence` is the provider-assigned durable envelope sequence. Work episode/activity sequence fields remain domain ordinals and must not be substituted for ledger order.

### Outputs

- Durable Work command results equivalent to current registry results.
- Reconstructed WorkInstance / WorkEpisode / activity / assignment / outcome state.
- Exact committed `WorkOperation` history by Workspace sequence.
- Typed conflict for stale partition head or stale `expectedVersion`.

## Public seam

Export a `DurableWorkStatePort` / `DurableWorkService` from `packages/work-persistence/src/index.ts` whose command surface covers the existing Work mutations required by the live product, including at minimum:

- create WorkInstance;
- start/complete WorkEpisode according to existing contract;
- add/complete activity;
- create/complete assignment;
- record outcome;
- read WorkInstance / WorkEpisode / activity stream;
- read committed Work history.

Do not expose PostgreSQL queries or mutable registry Maps.

Mutation protocol:

1. read the current Workspace `work:v1` journal partition;
2. reconstruct `WorkRegistry` from committed operations;
3. verify supplied WorkspaceContext matches the command/resource Workspace;
4. execute the current domain command against a candidate registry to obtain/validate the next operation;
5. remove the candidate's process-local causal sequence from authority and propose its payload through DSA-001 compare-and-append at the loaded durable head;
6. rebuild the committed operation with the provider-returned sequence;
7. return domain state reconstructed from committed history;
8. if the partition head changed, fail/reload/revalidate — never publish the stale candidate as last-writer-wins.

A caller-supplied `authorizationReference` remains evidence/reference data defined by the Work contract. This persistence package does not interpret it as authority. DSA-005 / execution policy must evaluate actual authorization through DSA-002.

## Non-goals

- No changes to Work domain types/invariants.
- No session or capability evaluation in this package.
- No API endpoint.
- No Work snapshot/checkpoint optimization.
- No realtime presence/transport.
- No external effect execution.

## Falsifiers / tests

Write failing public-behavior tests first.

### F1 full Work restart/replay

Create a WorkInstance and exercise episode/activity/assignment/outcome transitions with at least two operations sharing the same transaction timestamp. Capture Work version and history. Recreate the service/database client.

Required: reconstructed state is structurally equal, ledger sequence is exact append order, and equal times do not reorder operations.

### F2 Workspace mismatch

Resolve a valid WorkspaceContext for A. Attempt to create/mutate/read Work whose Workspace is B, including a valid Work ID obtained from B.

Required: fail before durable append and before returning B payload. Journal heads remain unchanged.

### F3 stale Work version across processes

Two independent service instances load the same Work version. Each submits a different mutation using the same `expectedVersion`.

Required: at most one publishes from that state. The other gets a typed stale/conflict result and must reload. No silent last-writer overwrite.

### F4 unrelated concurrent Workspace write

Race two valid Work operations in the same Workspace against the same partition head, even if they target different WorkInstances.

Required: provider compare-and-append serializes publication; losing caller reloads/revalidates. False contention is acceptable in P1; incorrect publication is not.

### F5 partial publication

Inject durable transaction failure for a validated candidate Work operation.

Required: caller cannot observe the candidate as committed state, journal head does not advance, and a fresh process reconstructs the previous version only.

### F6 duplicate operation identity

Retry the same normalized Work operation ID after a simulated response loss.

Required: no duplicate Work mutation/version increment. Contradictory same-ID payload conflicts.

### F7 authorization-reference non-authority

Pass a syntactically plausible `authorizationReference` while supplying the wrong WorkspaceContext.

Required: persistence denies the Workspace mismatch. The reference never bypasses WorkspaceContext.

## Verification ladder

1. `node --test packages/work-persistence/test/durable-work.test.ts` against a real PostgreSQL DSA-001 provider;
2. existing `packages/work/test/work-domain.test.ts`;
3. DSA-001 persistence/workspace tests;
4. `pnpm typecheck`;
5. `pnpm boundaries`;
6. `pnpm test:all`.

Record real PostgreSQL restart/concurrency evidence; a mock-only pass is insufficient.

## Evidence to preserve

- Workspace ID and non-sensitive Work/operation IDs used by the tracer;
- before/after restart Work versions and ledger sequences;
- contested concurrent mutation result;
- partial-write failure/reconnect result;
- exact commands run.

## Authority / external effects

This package assumes its caller already holds a resolved WorkspaceContext but independently enforces Workspace identity equality. It does not authorize external effects, capabilities or semantic commits. Durable Work publication is its only state effect.

## Rollback / replay

- Replay folds only committed `work:v1` operations in provider sequence.
- No code rollback deletes Work history.
- Existing WorkRegistry replay remains the behavioral oracle; if durable replay requires changing Work semantics, stop and report the minimum upstream interface change instead of duplicating divergent logic.

## Completion gate

Done only when restart, Workspace mismatch, stale-version concurrency, same-Workspace race, partial-write, idempotency and authorization-reference falsifiers pass and the durable Work port is stable for DSA-005/realtime consumers.
