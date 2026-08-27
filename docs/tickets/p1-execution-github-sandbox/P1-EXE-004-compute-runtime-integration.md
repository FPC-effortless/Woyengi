# P1-EXE-004 — Compute-Node/Runtime Integration, Budgets, Cancellation + Recovery

Status: **BLOCKED ON P0 ACCEPTANCE, P1-EXE-001 AND P1-EXE-003**  
Issue lane: #15  
Depends on: P1-EXE-001, P1-EXE-003  
Unblocks: P1-EXE-005, P1-EXE-006

## Outcome contract

Wire the real sandbox executor into the existing hosted compute/runtime path without weakening the observation-only compute boundary. The runtime must lease bounded work, execute it in the sandbox, publish sequenced observations/evidence, propagate cancellation, survive restart, and route ambiguous external-effect recovery into reconciliation rather than generic job retry.

Success means a hosted compute workload can execute a sandbox command through the current `HostedWorkloadEnvelope` correlation/authority/budget/idempotency contract, with restart and cancellation tests proving no process or external effect is duplicated.

## Future exclusive file ownership

The implementation agent owns **only**:

- `services/compute-node/**`;
- `services/runtime/**`.

`packages/compute/**`, `packages/effects/**`, `packages/execution/**`, `packages/sandbox/**`, GitHub provider files, #14/#16 files, shared ADRs, `prd.json`, and `progress.txt` are read-only.

If an imported public contract is insufficient, report the minimum interface change to its owning ticket rather than editing outside this ownership.

## Preconditions / blockers

1. P0 accepted.
2. P1-EXE-001 exposes stable execution/recovery contracts.
3. P1-EXE-003 exposes stable sandbox executor/lifecycle/evidence contracts.
4. Existing `HostedWorkloadEnvelope` observation-only semantics remain intact.

## Existing seam to preserve

`services/compute-node/index.ts` already defines:

- `HostedWorkloadEnvelope` with execution correlation, principal, authority reference, budget, idempotency key, workload, expected effect and reconciliation plan;
- `ComputeNodeStatePort` for registration/heartbeat/lease/authority/observation;
- `HostedComputeNodeRuntime` that rechecks authority before execution;
- `HostedComputeObservation` marked `observationOnly: true`, `acceptedTruth: false`, `semanticMutation: false`.

Do not collapse those semantics into a provider success result.

## Required implementation

### Sandbox-backed workload executor

Implement an adapter satisfying the existing `WorkloadExecutor` contract by:

1. validating the workload operation is an allowed sandbox operation;
2. deriving an immutable `SandboxSpec` from the hosted envelope/workload;
3. creating/starting the sandbox;
4. collecting bounded output and usage;
5. producing content-bound evidence descriptors/references;
6. mapping exit/timeout/cancel/budget states into a `WorkloadExecutionObservation`;
7. disposing runtime resources only after terminal evidence/inspection state is recorded.

Provider-specific GitHub operations do not execute inside this adapter.

### Runtime execution handler

Add a runtime handler that can:

- consume a durable execution command/lease;
- dispatch safe runtime work;
- persist/checkpoint state before and after sandbox transitions through the coordinator port;
- publish execution events through an injected event sink;
- handle explicit cancel commands;
- recover interrupted jobs deterministically.

### Generic worker retry guard

`PlatformWorker` currently retries failed jobs up to `maxAttempts`. Add a public classification/handler result or equivalent mechanism so execution handlers can distinguish:

- `SAFE_TO_RETRY_RUNTIME` — no consequential external mutation could have happened;
- `RECONCILE_ONLY` — external write may have happened; worker must not call the mutation handler again;
- `TERMINAL` — no retry.

The implementation may use a dedicated execution worker rather than modifying generic semantics if that keeps the boundary narrower, but there must be a test proving an ambiguous external effect cannot be blindly replayed by the runtime worker after restart.

## Budget semantics

Enforce the minimum of:

- P0 outcome/execution contract budget;
- hosted workload budget;
- compute-node registration/provider limit;
- sandbox local hard limit.

Track at minimum:

- wall-clock duration;
- output bytes;
- compute/provider cost when available;
- sandbox resource-limit outcome;
- attempt count.

A lower layer may enforce a stricter limit, never a broader one. Budget exhaustion stops new execution work and is surfaced as observation/evidence; it does not manufacture accepted outcome truth.

## Cancellation semantics

Cancellation must:

1. be persisted/observable before new work is prevented;
2. stop new lease/command dispatch for the execution;
3. signal the active sandbox executor;
4. wait through configured grace/forced termination;
5. publish terminal or uncertain process state;
6. leave prior GitHub/external effects intact for reconciliation;
7. remain idempotent under duplicate cancel requests.

## Restart/recovery matrix

| Durable state at restart | Required runtime action |
| --- | --- |
| authorized, runtime work never started | may safely dispatch if not cancelled and authority still valid |
| sandbox `STARTING/RUNNING` with provider identity | inspect/reattach/terminate per policy; do not start duplicate process |
| sandbox terminal but completion event missing | reconstruct observation from sandbox inspection/evidence; do not rerun |
| external effect `DISPATCHING/UNKNOWN/UNCERTAIN` | call coordinator reconciliation path only |
| external effect `CONFIRMED` + verification pending | resume verification/evidence processing only |
| accepted/rejected | no execution replay |
| cancellation requested | terminate/inspect runtime work; no new dispatch |

## Event projection

Publish events through the injected #15 event-sink contract; do not implement WebSocket/SSE. Events require:

- workspace/execution/trace correlation;
- durable journal sequence or equivalent stable ordering key;
- sandbox/process identity where relevant;
- safe payloads with no secrets;
- explicit terminal/cancel/recovery states.

The durable journal remains authoritative for catch-up; event publication may be at-least-once.

## Non-goals

- implementing #14 persistence/auth store;
- implementing #16 realtime transport or shell UI;
- accepting output as truth;
- GitHub mutation logic;
- broad compute scheduler redesign;
- Kubernetes;
- automatic rerun of ambiguous external writes;
- putting credentials in runtime job payloads.

## Falsifiers / tests first

Write failing tests before implementation for:

1. hosted workload executes through sandbox-backed `WorkloadExecutor`, preserving exact correlation/principal/authority/idempotency/effect fields;
2. sandbox process exit 0 -> hosted observation remains `acceptedTruth: false`;
3. compute budget < sandbox request -> stricter compute budget wins;
4. sandbox/provider limit < workload budget -> stricter lower-layer budget wins;
5. output/time budget exceeded -> terminal budget observation, no later publish effect;
6. cancel before lease execution -> workload provider not called;
7. cancel during sandbox process -> process terminated and no new work starts;
8. duplicate cancel -> idempotent terminal state;
9. restart during running sandbox -> inspect/reattach, provider process start count one;
10. restart after sandbox exited but before runtime saved result -> reconstruct terminal observation, process start count one;
11. restart with ambiguous external effect -> mutation handler call count remains one and runtime calls reconcile-only path;
12. generic worker retry path cannot execute an item classified `RECONCILE_ONLY`;
13. authority revoked before recovered dispatch -> no runtime work begins;
14. stale/expired compute lease -> fail closed;
15. cross-workspace node/lease/sandbox execution -> fail closed;
16. event sink receives duplicate publication attempt -> durable sequence allows consumer dedupe; no mutation is repeated;
17. secret-shaped runtime fixture is redacted/absent from errors/events/checkpoints.

## Evidence required from implementation

- targeted compute-node/runtime test outputs;
- sandbox process-start call counts across restart;
- recovery-state table exercised in tests;
- budget precedence proof;
- cancellation terminal inspection;
- example event/journal projection with no secret material.

## Verification ladder

1. `node --test services/compute-node/test/*.test.ts services/runtime/test/*.test.ts`
2. run Docker-backed sandbox integration tests transitively used by the executor
3. `pnpm typecheck`
4. `pnpm boundaries`
5. `pnpm test:all`
6. `pnpm benchmark` for restart/replay/cancellation adversarial semantics
7. `pnpm prod:check` because this ticket changes production execution runtime paths

## Authority / effects

Compute and sandbox execution are runtime behavior governed by the manifest and current authority. `HostedComputeObservation` remains observation-only. Any external mutation is delegated to a separately governed external-effect driver and never replayed by compute/runtime.

## Rollback / replay

Runtime rollback may stop accepting new jobs and terminate runtime resources. Existing durable observations remain. Restart replay reconstructs and reconciles only; it cannot rerun a command whose prior provider identity proves it already started unless policy explicitly defines that runtime command as safely repeatable and no external consequence can result.