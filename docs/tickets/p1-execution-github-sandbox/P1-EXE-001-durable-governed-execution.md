# P1-EXE-001 — Durable Governed Execution Coordinator

Status: **BLOCKED ON P0 ACCEPTANCE**  
Issue lane: #15  
Depends on: accepted P0 contracts only  
Unblocks: P1-EXE-002, P1-EXE-003, P1-EXE-004, P1-EXE-005

## Outcome contract

Provide a restart-safe, provider-neutral execution coordinator over the existing `packages/effects` governed-execution model. The coordinator must persist execution progress through ports, durably claim external effects before dispatch, restore/reconcile after restart, honor cancellation, and never reissue an ambiguous consequential effect.

Success means a fake external driver can be killed/recreated at every transition and the recovered coordinator either resumes safe deterministic work or performs observation/reconciliation only; it must never duplicate an external mutation.

## Future exclusive file ownership

The implementation agent for this ticket owns **only**:

- `packages/execution/**` (new package directory);
- `packages/effects/src/index.ts` for the minimum validated restore/rehydration seam;
- `packages/effects/test/governed-execution.test.ts` for restoration/replay falsifiers.

Everything else is read-only. Do not edit #14/#16 files, shared ADRs, `prd.json`, or `progress.txt`.

No later ticket may modify the `packages/effects` files above without first completing/merging this ticket and explicitly taking sequential ownership.

## Preconditions / blockers

1. Parent integration owner has explicitly accepted P0.
2. Accepted P0 public `OutcomeContract` can express allowed/forbidden effect classes, budgets/attempts/termination and verification/evidence requirements. If not, stop and request the minimum P0 interface addition.
3. Do not require #14's storage implementation to begin unit-level work; use a test double implementing the port. The live/restart claim remains blocked until #14 provides a durable adapter.

## Required inputs

- `ExecutionCorrelation`, `ActionIntent`, `EffectPlan`, `ExecutionManifest`, `ExecutionReceipt`, `ObservedEffect`, `EffectReconciliation`, evidence/verification/acceptance records from `packages/effects`;
- principal/workspace/work IDs and accepted P0 outcome-contract reference;
- authority/policy/budget/risk decisions;
- provider-neutral external driver registration;
- `ExecutionDurabilityPort` and `ExecutionPrincipalPort` adapters;
- clock/ID providers as explicit dependencies where determinism matters.

## Required outputs

- public `ExecutionCoordinator` command API;
- immutable execution/run projections;
- durable ordered journal/checkpoint records;
- durable external-effect claim/fingerprint state;
- cancellation/recovery projection;
- safe restart behavior;
- existing governed `AcceptanceOutcome` / semantic-commit behavior preserved.

## Public interfaces to implement

At minimum expose from `packages/execution/src/index.ts`:

```ts
export interface ExecutionDurabilityPort {
  createExecution(input: DurableExecutionCreate): Promise<void>;
  loadExecution(input: { workspaceId: string; manifestId: string }): Promise<DurableExecutionState | undefined>;
  append(input: {
    workspaceId: string;
    manifestId: string;
    expectedSequence: number;
    records: readonly DurableExecutionRecord[];
  }): Promise<{ nextSequence: number }>;
  claimExternalEffect(input: ExternalEffectClaimRequest): Promise<ExternalEffectClaimResult>;
  listRecoveryCandidates(input: RecoveryQuery): Promise<RecoveryPage>;
}

export interface ExecutionPrincipalPort {
  resolveSession(input: SessionResolutionRequest): Promise<SessionResolution>;
  authorize(input: ExecutionAuthorizationRequest): Promise<ExecutionAuthorizationDecision>;
}

export interface ExecutionCoordinator {
  create(input: CreateExecutionCommand): Promise<ExecutionProjection>;
  dispatch(input: DispatchExecutionCommand): Promise<ExecutionProjection>;
  cancel(input: CancelExecutionCommand): Promise<ExecutionProjection>;
  recover(input: RecoverExecutionCommand): Promise<ExecutionProjection>;
  get(input: ExecutionQuery): Promise<ExecutionProjection | undefined>;
}
```

The concrete type names may be refined, but the semantics in the lane spec are fixed.

## Minimum `packages/effects` change

Add a public, validated restoration seam such as `GovernedExecutionEngine.restore(snapshot)` or a semantically equivalent constructor/factory. Requirements:

- validate all IDs/correlation/record relationships using the same invariants as live creation;
- require journal sequences to be contiguous and ordered;
- reject duplicate/nonmatching receipt, observation, reconciliation, evidence, verification, outcome and commit records;
- reconstruct in-memory aggregate state without executing any effect;
- never emit a new journal record merely because restoration occurred;
- preserve frozen/immutable public projections;
- do not broaden acceptance semantics.

If implementing validated restoration would require a large redesign of `packages/effects`, stop and report the smallest required refactor rather than introducing a parallel domain model in `packages/execution`.

## State transitions

Implement coordinator operational states from the spec:

- `PLANNED`, `AUTHORIZED`, `BLOCKED`, `DISPATCHING`, `OBSERVED`, `RECONCILING`, `VERIFYING`, `ACCEPTED`, `REJECTED`;
- controls `CANCEL_REQUESTED`, `CANCELLED`, `RECOVERY_REQUIRED`, `FAILED`.

External effect attempt state must distinguish at least:

- `CLAIMED`;
- `DISPATCHING`;
- `ACKNOWLEDGED`;
- `REJECTED`;
- `UNKNOWN`;
- `RECONCILING`;
- `CONFIRMED`;
- `DIVERGED`;
- `UNCERTAIN`.

These are orchestration states, not replacements for `EffectReconciliation` or `AcceptanceOutcome`.

## Idempotency algorithm

1. normalize request and stable fingerprint;
2. revalidate current principal/session authority before consequential dispatch;
3. atomically claim `(workspaceId, providerId, bindingId, idempotencyKey)` in durability port;
4. conflict on same key/different fingerprint;
5. append `DISPATCHING` before provider call;
6. call external mutation at most once for a new claim;
7. persist receipt/observation before attempting canonical reconciliation;
8. after timeout/connection loss where delivery is ambiguous, set `UNKNOWN` and call reconcile only;
9. on restart, `UNKNOWN/UNCERTAIN/DISPATCHING` external states are observation-only recovery paths;
10. a later compensating/retry mutation requires a new governed intent/effect.

## Non-goals

- GitHub-specific request types;
- Docker/process implementation;
- durable DB implementation owned by #14;
- WebSocket/SSE transport;
- shell UI;
- credentials or secrets;
- automatic provider retry policy for ambiguous external writes;
- replacing `GovernedExecutionEngine` acceptance logic.

## Falsifiers / tests first

Create failing public-behavior tests before implementation for all of the following:

1. same idempotency key + same fingerprint concurrently -> one durable claim and one provider dispatch;
2. same idempotency key + different fingerprint -> conflict before provider call;
3. crash after durable claim but before provider call -> recovery can determine no dispatch was recorded and may proceed only under an explicit safe transition;
4. crash after `DISPATCHING` before response -> recovery calls reconciliation, not dispatch;
5. transport timeout after fake provider applied mutation -> canonical reread confirms it with provider call count still one;
6. timeout + inconclusive reread -> `UNCERTAIN`, review required, no second dispatch across repeated restart;
7. cancellation before provider dispatch -> no provider call;
8. cancellation after ambiguous provider dispatch -> no retry; reconciliation remains required;
9. principal revoked between manifest creation and dispatch -> provider call count zero;
10. stale journal sequence writer -> CAS failure, no event reordering;
11. corrupted restored snapshot (gap/duplicate/mismatched correlation) -> restore fails closed;
12. restoring a completed execution -> zero provider calls and no new journal entries;
13. provider success without reconciliation/evidence/independent verification -> existing acceptance still rejects;
14. workspace A cannot load/claim/cancel workspace B execution.

## Evidence required from implementation

- targeted test command + output;
- one serialized redacted execution projection showing ordered state/journal;
- provider fake call-count evidence for duplicate/restart falsifiers;
- proof no credential-like material is present in durable execution records;
- documented mapping from accepted P0 `OutcomeContract` fields into execution gates.

## Verification ladder

Run, in order, and record only commands actually run:

1. `node --test packages/execution/test/*.test.ts packages/effects/test/governed-execution.test.ts`
2. `pnpm typecheck`
3. `pnpm boundaries`
4. `pnpm test:all`
5. `pnpm benchmark` because restart/replay/external-effect semantics are adversarial-state behavior
6. `pnpm prod:check` if the implementation is wired into production runtime paths in this ticket

## Authority / external effects

Implementation tests must use fakes only. No live GitHub, Docker host mutation, or credential is necessary for this ticket. The coordinator itself cannot grant authority; it consumes explicit current decisions and records decision references.

## Rollback / replay

Software rollback may remove the coordinator package only before other tickets depend on it. Persisted execution records must remain readable/migratable. Replay/restoration is observational and may not issue provider writes. External correction is always a new governed effect.