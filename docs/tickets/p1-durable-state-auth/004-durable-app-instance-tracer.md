# DSA-004 — Durable ApplicationInstance install/update/rollback tracer

Parent: #14  
Spec: `docs/specs/p1-durable-state-auth.md`  
Type: coding tracer bullet  
Status: BLOCKED until P0 is accepted and DSA-001 is complete.

## Outcome contract

In one Workspace, install ApplicationPackage v1 into an ApplicationInstance, update it to compatible v2, destroy all installer/service objects, reconstruct the v2 instance from PostgreSQL, then roll back to v1 and prove the rollback also survives a second restart. No package operation may move the instance across Workspaces or smuggle workspace authority/credentials into the portable package definition.

Because `ApplicationInstaller` currently has no operation-history/replay seam, this ticket adds a persistence integration journal outside `packages/apps` and treats the existing installer as the domain behavior oracle.

## Prerequisites / blockers

- P0 verification + human acceptance gate is closed.
- DSA-001 durable journal is stable and verified against real PostgreSQL.
- P0 AppBlueprint projection work (#8) is accepted on the baseline. If it changes `ApplicationPackage` / `ApplicationInstance` projection contracts, rebase this ticket's adapter semantics to the accepted public package API without editing P0-owned files.

## Exclusive future file ownership

This ticket may create/edit only:

- `packages/app-persistence/src/index.ts`
- `packages/app-persistence/test/durable-app.test.ts`

Do not edit `packages/apps/**`, composer/operational-spec files, Workspace/session/API/Work source, persistence-provider source, migrations, root dependencies, shared ADRs, `prd.json`, or `progress.txt`.

If accepted P0 contracts make the existing public `packages/apps` API insufficient for deterministic replay, report the minimum interface change required rather than modifying that package in this ticket.

## State inputs and outputs

### Inputs

- Existing public `ApplicationPackage`, `ApplicationInstance`, `ApplicationInstaller`, `InstallApplicationInput` and update/rollback behavior.
- DSA-001 `DurableJournalPort`.
- A trusted WorkspaceContext from the caller.
- Immutable normalized ApplicationPackage material for each version used by an operation.

### Durable journal

Use journal `application-instance:v1`, partitioned by immutable Workspace ID. Define integration operations owned by this adapter, not by the portable package contract:

- `application.installed`
- `application.updated`
- `application.rolled-back`

Each operation carries only what is necessary to replay the ApplicationInstance transition:

- immutable instance/workspace/package identity;
- package version and content identity;
- normalized portable package material or an immutable resolvable content reference sufficient for restart replay;
- installation/binding/configuration input required by the transition;
- actor/authorization evidence reference supplied by the caller, if the public contract provides one;
- transaction time and operation identity via the durable envelope.

No raw credentials, Workspace capability context, private production data, or package-external semantic object payloads may be embedded merely to make replay convenient.

### Outputs

- Reconstructed current ApplicationInstance.
- Exact committed instance operation history.
- Deterministic update/rollback result after restart.
- Typed conflict for stale partition head, incompatible update, missing/corrupt package material or Workspace mismatch.

## Public seam

Export `DurableApplicationInstancePort` / service with equivalent responsibilities:

```ts
interface DurableApplicationInstancePort {
  install(context: WorkspaceContext, pkg: ApplicationPackage, input: InstallApplicationInput, meta: DurableCommandMeta): Promise<ApplicationInstance>;
  update(context: WorkspaceContext, instanceId: string, pkg: ApplicationPackage, meta: DurableCommandMeta): Promise<ApplicationInstance>;
  rollback(context: WorkspaceContext, instanceId: string, targetVersion: string, meta: DurableCommandMeta): Promise<ApplicationInstance>;
  get(context: WorkspaceContext, instanceId: string): Promise<ApplicationInstance | undefined>;
  history(context: WorkspaceContext, instanceId: string): Promise<readonly ApplicationInstanceOperation[]>;
}
```

The implementation must reconstruct by replaying committed adapter operations through a fresh `ApplicationInstaller`. It must not make a SQL current-state row the only source capable of rollback.

Mutation protocol mirrors DSA-003:

1. read current Workspace partition;
2. reconstruct a fresh installer/service state from committed operations;
3. verify WorkspaceContext matches instance/input Workspace;
4. run existing installer behavior against a candidate to validate install/update/rollback;
5. compare-and-append the normalized transition at the durable head;
6. return state reconstructed from committed operations;
7. on stale head, reload/revalidate rather than overwrite.

## Package-material rule

For P1, it is acceptable for a journal operation to include a canonical normalized copy of the portable `ApplicationPackage` manifest needed to replay that transition, because the package is software definition rather than private Workspace data. Prefer a content hash plus canonical bytes/snapshot within the operation payload so replay verifies the hash before invoking `ApplicationInstaller`.

This does **not** authorize embedding:

- Workspace semantic object contents;
- credentials/secrets;
- capability tokens/authority context;
- private evaluator data;
- generated target answers.

If package material later moves to ObjectStore, the journal remains authoritative for the immutable content reference and replay fails closed if referenced bytes are unavailable/hash-invalid.

## Non-goals

- No changes to `ApplicationPackage` portability semantics.
- No changes to AppBlueprint/OperationalSystemSpec projection contracts.
- No durable storage of Workspace business objects inside an App.
- No marketplace/package discovery service.
- No package signing redesign.
- No API route changes.
- No external application execution/effects.

## Falsifiers / tests

Write failing behavior tests first.

### F1 install/update/restart/rollback/restart

1. Create WorkspaceContext A.
2. Install compatible package v1.
3. Update same instance to v2 with required migration metadata.
4. Destroy service objects/reconnect; assert current instance is v2 and history contains v1 -> v2.
5. Roll back to v1.
6. Destroy/reconnect again; assert current instance is v1 and history retains the full transition chain.

### F2 Workspace isolation

Use an instance from Workspace B with WorkspaceContext A for get/update/rollback. Also craft installation input whose `workspaceId` disagrees with the context.

Required: deny/fail before journal append and return no B instance payload.

### F3 semantic binding leakage

Attempt install/update with semantic object binding outside the target Workspace namespace using the existing App contract's negative case.

Required: fail with no durable operation. Persistence wrapper must not normalize away the domain rejection.

### F4 incompatible update / invalid rollback

Attempt incompatible version update, update without required migration, and rollback to a version not present in committed package history.

Required: no durable publication for each invalid transition.

### F5 corrupt package replay

Tamper with canonical package bytes/snapshot while preserving claimed content identity in a negative fixture, then reconstruct in a fresh service.

Required: content verification fails closed before invoking a transition or returning a trusted current instance.

### F6 partial write / stale writer

Inject transaction failure and independently race two service instances against the same Workspace journal head.

Required: failed transaction leaves no visible instance transition; concurrent conflict serializes/reloads rather than overwriting.

### F7 secret/authority leakage

Serialize committed ApplicationInstance operations and scan fixture strings for supplied fake secret/capability-token/private-workspace payload sent through rejected/irrelevant inputs.

Required: only declared portable package + binding/config identifiers needed by the App contract are present; no credential or authority token is captured by the persistence adapter.

## Verification ladder

1. `node --test packages/app-persistence/test/durable-app.test.ts` against real PostgreSQL DSA-001 provider;
2. existing `packages/apps/test/application-package.test.ts`;
3. accepted P0 App projection tests relevant to package/blueprint compatibility;
4. DSA-001 persistence tests;
5. `pnpm typecheck`;
6. `pnpm boundaries`;
7. `pnpm test:all`.

## Evidence to preserve

- non-sensitive Workspace/instance/package IDs and content hashes;
- before/after restart version/history chain;
- rollback chain evidence;
- negative Workspace/binding/package-corruption outcomes;
- exact commands run.

Do not include credentials/private Workspace data in evidence.

## Authority / external effects

Application install/update/rollback is durable product configuration state, not authority to execute the App's external effects. DSA-004 accepts an already-resolved WorkspaceContext and enforces identity equality; DSA-005 supplies policy authorization. Package capability requirements are declarations, not granted capabilities.

## Rollback / replay

- Replay uses only committed adapter operations in provider sequence and validates package content identity.
- Application rollback is a new append operation; it never deletes v2 history.
- Code rollback must retain the ability to read operations written by the compatible P1 schema.

## Completion gate

Done only when the full two-restart install/update/rollback tracer and Workspace, binding, compatibility, corruption, partial-write, concurrency and leakage falsifiers pass, with no edits to P0 or `packages/apps` ownership.
