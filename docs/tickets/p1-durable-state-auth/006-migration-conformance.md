# DSA-006 — Personal-runtime migration + full durable-state/auth conformance

Parent: #14  
Spec: `docs/specs/p1-durable-state-auth.md`  
Type: coding tracer bullet / final conformance  
Status: BLOCKED until P0 is accepted and DSA-005 is complete.

## Outcome contract

Prove the entire DSA lane as one adversarial tracer and provide a non-destructive migration path for the existing JSON-backed Personal Runtime.

A seeded `services/personal-runtime` v1 state must be dry-runnable, copied into PostgreSQL, replay-verified as the same Principal/Account/Personal Workspace/ApplicationInstance identity, and left intact as rollback source. Separately, the full conformance tracer must prove restart, cross-workspace isolation, session revocation, causal order, concurrent compare-and-append and partial-write behavior across the DSA public ports/API.

This ticket creates evidence; it does not change P0, domain semantics or deployment claims.

## Prerequisites / blockers

- P0 verification + human acceptance gate is closed.
- DSA-001 through DSA-005 are complete and their public ports stable.
- Real PostgreSQL test service available.
- Existing personal-runtime v1 format remains readable. If its schema changed on the implementation baseline, update only this ticket's versioned migrator after inspecting the accepted source; do not modify personal-runtime's existing writer to suit the migration.

## Exclusive future file ownership

This ticket may create/edit only:

- `services/personal-runtime/src/durable-migration.ts`
- `services/personal-runtime/test/durable-migration.test.ts`
- `benchmarks/conformance/test/p1-durable-state-auth.test.ts`
- one uniquely named `.agents/handoffs/*-p1-durable-state-auth.md` for the future implementation agent

Do not edit existing personal-runtime `index.ts`, DSA packages/API, migrations, root dependencies, shared ADRs, `prd.json`, `progress.txt`, or another lane's handoff.

## Existing migration source contract

The current Personal Runtime writes:

- `${localStateDirectory}/canonical-ledger.json` through `LocalCanonicalLedger`;
- content-addressed state bytes under `${localStateDirectory}/objects`;
- artifact ID `artifact:personal-runtime-state-v1` with media type `application/vnd.woyengi.personal-runtime-state+json`;
- state schema version `1` containing `platformApiVersion`, `owner`, `workspaceOperations`, `applicationPackage`, `installation`, and `packageSourceDirectory`.

The migrator may implement a **version-pinned read-only decoder** for that v1 format in `durable-migration.ts`. It must verify:

1. state artifact exists and has the expected kind/media type;
2. referenced object bytes exist;
3. SHA-256 of bytes equals the artifact content hash;
4. JSON schemaVersion is exactly 1;
5. `WorkspaceRegistry.replay(workspaceOperations)` succeeds and reconstructs the declared owner/account/workspace;
6. `defineApplicationPackage` + a fresh `ApplicationInstaller` can reconstruct the declared installation;
7. package/installation Workspace IDs match the Personal Workspace.

Do not import private functions from `services/personal-runtime/src/index.ts` or edit that file merely to expose them.

## Migration public seam

Export equivalent functions from `durable-migration.ts`:

```ts
interface PersonalRuntimeMigrationPlan {
  readonly sourceStateContentHash: string;
  readonly principalId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly applicationInstanceId: string;
  readonly applicationPackageId: string;
  readonly sourceWorkspaceOperationIds: readonly string[];
  readonly conflicts: readonly MigrationConflict[];
  readonly targetWrites: readonly MigrationWriteDescription[];
}

planPersonalRuntimeMigration(input): Promise<PersonalRuntimeMigrationPlan>;
applyPersonalRuntimeMigration(input): Promise<PersonalRuntimeMigrationReceipt>;
verifyPersonalRuntimeMigration(input): Promise<PersonalRuntimeMigrationVerification>;
```

### Dry-run

`plan...` reads/verifies source and target but performs **zero target writes**. It reports:

- source content hash;
- exact source Principal/Account/Workspace/App IDs;
- source operation IDs/order;
- target collisions;
- which source operations are already present identically vs new;
- deterministic ApplicationInstance migration operation identity derived from source state content hash + instance ID;
- no credentials.

Any same immutable ID/operation ID with materially different target payload is a conflict and blocks apply.

### Apply

`apply...` requires a conflict-free plan tied to the same source content hash. It revalidates source immediately before writes. It then:

1. replays source Workspace operations for domain validity;
2. translates them in source causal order through DSA-001 Workspace command methods, preserving source operation IDs and transaction times while accepting new provider-assigned durable sequences;
3. installs the source ApplicationPackage/installation through DSA-004 using a deterministic migration operation ID;
4. does **not** import/create a session token; sessions are security credentials and must be newly issued after migration;
5. does not delete, rewrite or mark the local source as consumed.

If any target write conflicts, apply fails closed. Already-identical operations are idempotent. If the generic provider cannot make the whole multi-domain migration one transaction, the receipt must explicitly record each idempotent committed operation and `verify...` must be required before cutover; partial apply is recoverable only by rerunning the same deterministic migration IDs, never by deleting history.

### Verify

`verify...` reconstructs target Workspace/App state through the public DSA ports, not SQL row inspection, and compares all migration-owned semantics:

- Principal/Account/Personal Workspace identity;
- Workspace access/context;
- operation identity/order mapping;
- ApplicationInstance ID, package/version, blueprint reference and all installation bindings/configuration represented in the source;
- source package content identity.

Provider ledger sequences may differ from local source sequence numbers; relative causal operation order and operation IDs must match.

## Cutover / rollback authority

The migration library does not switch endpoints, delete source state or claim completion automatically.

Operator sequence:

`dry-run -> review conflicts/evidence -> apply(copy) -> verify(replay equivalence) -> human-authorized cutover`

Rollback before/after cutover means the operator can point the old Personal Runtime binary back at the untouched local source. DSA-006 never deletes that source. Database schema rollback follows DSA-001 compatibility policy.

Any future source deletion/schema contraction needs a separate human-authorized ticket.

## Full conformance tracer

`benchmarks/conformance/test/p1-durable-state-auth.test.ts` is an integration/conformance test, not a performance benchmark. It composes only public DSA/API seams and a real PostgreSQL provider.

Required scenario:

1. Provision Principal A / Workspace A and Principal B / Workspace B.
2. Give A an active session and an explicit narrow allow-policy fixture for the tested A operations.
3. Through DSA-005/API, create WorkInstance + episode and install ApplicationInstance in A.
4. Use independent service/database clients to race equal-time/stale-head operations.
5. Destroy/reconstruct API + DSA service objects using the same database.
6. Verify A sees the same Work/App state and exact causal history.
7. Attack A session against B via path/header/body/Work/App identifiers and shared/aliased IDs.
8. Revoke A session, retry immediately, reconstruct services, retry again.
9. Inject one transaction failure at the durable provider boundary and prove no partial authoritative state survives reconnect.
10. Run the personal-runtime dry-run/apply/verify tracer against a separate target namespace/database fixture.

## Required falsifier matrix

### F1 restart

Fresh service objects reconstruct Workspace, Work, App and active-session state solely from durable state.

### F2 cross-workspace leakage

Every B attack by A is denied before returning B payload or committing mutation. Error shape must not reveal B object existence.

### F3 revocation

Revoked A bearer fails immediately and after restart. No stale in-process cache revives it.

### F4 causal ordering / concurrency

Equal-time operations preserve storage publication order. Two writers at one head cannot both commit the same next sequence. Stale Work/App mutations surface conflict and revalidation.

### F5 partial write

Injected failure leaves journal/head/projection/idempotency state at the prior committed point after reconnect.

### F6 migration dry-run purity

Capture target journal heads before/after `plan...`. Required: identical. Corrupt source bytes/hash/schema/cross-workspace bindings all fail with no target mutation.

### F7 migration idempotency/conflict

Run valid migration apply twice: second run produces no duplicate domain state. Seed target with same ID + different payload: plan/apply must block rather than merge/overwrite.

### F8 migration rollback source

Byte-hash local source files before and after dry-run/apply/verify. Required: source canonical ledger/object bytes unchanged and still openable by `openPersonalRuntime`.

### F9 secret leakage

Use sentinel bootstrap/session values. Scan conformance receipts, migration plans, serialized durable envelopes captured by the test and errors.

Required: no raw secret appears.

## Non-goals

- No automatic deployment cutover.
- No destructive cleanup of local state.
- No migration of Work/sessions that do not exist in the current personal-runtime v1 source format.
- No performance/SLO benchmark.
- No production-ready/frontier/scientific qualification claim.
- No modification of runtime/execution/realtime lanes.

## Verification ladder

Run and record actual results:

1. `node --test services/personal-runtime/test/durable-migration.test.ts` against real PostgreSQL;
2. `node --test benchmarks/conformance/test/p1-durable-state-auth.test.ts` against real PostgreSQL;
3. DSA-001 through DSA-005 targeted tests;
4. existing personal-runtime tests;
5. existing workspace/work/apps/permissions/platform-api tests;
6. `pnpm typecheck`;
7. `pnpm boundaries`;
8. `pnpm test:all`;
9. `pnpm benchmark` only if the implementation review determines canonical reconstruction semantics were touched; otherwise record why it is not applicable;
10. applicable architecture/security/production gates.

A skipped PostgreSQL integration test, mocked transaction test, or static review cannot close the ticket.

## Evidence to preserve

- source state content hash and byte-integrity before/after hash;
- migration plan/receipt/verification with no secrets;
- source operation ID -> target sequence mapping;
- restart causal histories;
- cross-workspace attack matrix;
- revocation before/after restart result;
- concurrency and failure-injection results;
- exact commands and environment topology (without credentials);
- final code-review findings and whether any gate remains open.

## Authority / external effects

Migration apply writes durable product state and cutover is an operator-authorized effect. The test database effects are requested development effects only. No semantic commit, external business action or product-readiness claim is authorized by these tests.

## Completion gate

Done only when migration dry-run/apply/verify is replay-equivalent and non-destructive, the full restart/isolation/revocation/order/partial-write falsifier matrix passes on real PostgreSQL, all verification gates actually execute, and the implementation handoff records any remaining human authority gate rather than declaring readiness through inference.
