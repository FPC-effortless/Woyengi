# P1 Execution + GitHub + Sandbox Specification

Status: **PLANNING ONLY — implementation blocked until P0 acceptance**  
Issue: #15  
Parent: #6  
Branch: `plan/p1-execution-github-sandbox`  
Work mode: product engineering  
Lifecycle used: `wayfinder -> to-spec -> to-tickets -> handoff`

## 1. Problem and target outcome

P0 establishes Woyengi's canonical operational-contract lifecycle and preserves the existing governed execution spine. P1 now needs a live execution path that can turn an authorized `ActionIntent` into real computation and real GitHub effects without weakening Woyengi's truth, authority, evidence, replay, or isolation guarantees.

The target outcome is a tracer-bullet execution subsystem in which an authorized WorkEpisode can:

1. construct an execution manifest over the existing `ActionIntent -> EffectPlan -> ExecutionManifest` model;
2. dispatch bounded computation to a real Docker/process sandbox through compute/runtime ports;
3. execute GitHub reads and explicitly authorized GitHub writes;
4. persist receipts, observations, reconciliation, execution-journal records, cancellation and recovery state;
5. treat provider/transport success only as an observation;
6. block automatic replay of ambiguous external writes;
7. bind test/build evidence to the exact execution and resulting GitHub objects;
8. require reconciliation and independent verification before an outcome can be accepted; and
9. expose provider-neutral read/event/session ports for the durable-state/auth lane (#14) and realtime/shell lane (#16).

This specification does **not** create a second execution ontology. It operationalizes the contracts already present in `packages/effects`, `packages/permissions`, `packages/harness`, `packages/compute`, `services/compute-node`, and `services/platform-api`.

## 2. Wayfinder decision map

### Decision node A — reuse or replace governed execution?

- **Question:** should P1 introduce a new execution model for live providers?
- **Evidence:** `packages/effects/src/index.ts` already defines `ExecutionCorrelation`, `ActionIntent`, expected effect classes, `ExecutionManifest`, `ExecutionReceipt`, `ObservedEffect`, `EffectReconciliation`, evidence references, independent verification, acceptance, semantic commit and ordered journal entries.
- **Evidence:** `packages/effects/test/governed-execution.test.ts` already falsifies provider-success-as-truth and uncertain-external-effect acceptance.
- **Decision:** reuse and extend the existing governed execution spine. Add orchestration/durability around it; make only the minimum restoration seam needed for restart.
- **Rejected:** a provider-specific job model that bypasses `ActionIntent`/effects/reconciliation.
- **Reversibility:** high if orchestration is behind ports; low if a second truth model is introduced.

### Decision node B — how to handle GitHub writes that time out after the request may have reached GitHub?

- **Question:** retry the write or reconcile first?
- **Constitutional impact:** external effects are consequential and cannot be replayed merely because computation restarted.
- **Decision:** persist intent + idempotency claim before dispatch; after an ambiguous transport outcome, transition to `UNKNOWN/UNCERTAIN` and perform canonical reads only. Automatic write retry is forbidden until reconciliation proves the original write did not occur or a human/policy authorizes a compensating/new action.
- **Rejected:** generic worker retry semantics for ambiguous external mutations.

### Decision node C — where do credentials live?

- **Question:** pass GitHub tokens through execution payloads or journals?
- **Decision:** never serialize credential material into Work, manifests, journals, evidence, realtime events, logs, or sandbox state. Execution carries binding IDs and opaque credential-lease IDs. A credential broker materializes provider authentication only inside the provider adapter boundary.
- **Rejected:** tokens in environment-shaped execution records or `StateValue` payloads.

### Decision node D — host process or isolated sandbox?

- **Question:** can coding workloads execute directly in the Woyengi runtime process?
- **Decision:** no. Untrusted repository commands run only through a sandbox port with explicit image identity, filesystem policy, process/user isolation, network policy, resource budgets, output budgets and cancellation.
- **Rejected:** `child_process` on the platform host as the coding execution path.

### Decision node E — how do lanes #14 and #16 integrate?

- **Decision:** via interfaces owned by this lane, not shared implementation files. Lane #14 supplies durable principal/session and persistence adapters. Lane #16 consumes execution snapshots/events and sandbox session controls. Internal storage, GitHub, sandbox, and transport implementations remain private to their owning lane.

## 3. Reconstructed current implementation state

| Existing seam | Current behavior | Gap for P1 |
| --- | --- | --- |
| `packages/effects/src/index.ts` | `GovernedExecutionEngine` creates manifests, records one provider receipt, observes effects, reconciles, attaches evidence, records independent verification/compensation, decides acceptance, emits ordered in-memory journal entries. External effects require idempotency + reconciliation. | Aggregate is in-memory and has no public restore/rehydrate seam. No live dispatcher, cancellation, durable effect claim, or recovery coordinator. |
| `packages/effects/test/governed-execution.test.ts` | Proves missing observation/reconciliation/evidence/verification blocks acceptance; `UNCERTAIN` external effects require review; independent verification is required. | No restart/duplicate-dispatch/ambiguous-provider-write tests. |
| `packages/permissions/src/index.ts` | Capability engine is default-deny, workspace-scoped, supports `EXECUTE`, revocation, strict delegation narrowing and principal kinds including agents/services. | Live provider dispatch must re-check authority at consequential-effect time and bind a durable decision reference. |
| `packages/harness/src/index.ts` | `HarnessRequest` carries principal/workspace/work IDs, provider availability, bindings, budget, risk and authority/applicability gates. | Selection is not execution. Effective bindings need to become opaque execution binding references, not credentials. |
| `packages/compute/src/index.ts` | Workloads carry workspace/principal, capability requirements, budget, authority reference and idempotency key. Local provider is idempotent in memory and returns observation-only usage receipts. | Idempotency is not durable across restart; there is no sandbox process contract/cancellation/recovery. |
| `services/compute-node/index.ts` | Hosted envelope already includes execution correlation, principal, authority reference, budget, idempotency, expected-effect reference and reconciliation plan; provider result is explicitly observation-only/not accepted truth. | Needs a real sandbox-backed executor and restart-safe lease/execution semantics. |
| `services/runtime/src/index.ts` | Generic worker has durable local-file jobs, idempotent enqueue and retryable jobs. | Generic retries are unsafe for ambiguous external writes. External-effect jobs need reconcile-only recovery semantics instead of blind handler replay. |
| `services/platform-api/src/index.ts` | HTTP API authenticates and authorizes, requires idempotency keys for mutations, maps `control/execute` to `EXECUTE`, and carries trace IDs. | No typed execution create/read/cancel/recover routes; no stable execution event/query port. |
| `packages/connector-sdk/src/index.ts` | Pull-oriented connector definition/runner for ingestion with in-memory delivery dedupe. | Not an outbound consequential-effect connector; should not be stretched into a mutation protocol that hides governance. |
| GitHub implementation | No dedicated GitHub execution connector package found. | Need repo/issue/branch/commit/PR/test/build operations, credential binding and canonical reconciliation. |
| Sandbox implementation | No dedicated governed Docker/process sandbox package found. | Need lifecycle, isolation, budgets, cancellation, output/evidence integrity and recovery contract. |

## 4. Scope

### In scope

- a live governed execution coordinator over `packages/effects`;
- durable execution journal/checkpoint and external-effect idempotency claims through a persistence port;
- principal/session/authority checks at execution and consequential-effect boundaries;
- GitHub repository, issue, branch, commit, pull-request, test/check and build/workflow observation operations;
- explicitly authorized GitHub mutations required by the coding tracer bullet;
- GitHub canonical reread/reconciliation after every consequential mutation;
- opaque bindings and credential leases;
- Docker/process sandbox specification, lifecycle, limits, isolation and cancellation;
- compute-node/runtime integration;
- execution budgets, attempt limits, cancellation, restart and recovery;
- evidence integrity for command output, test results, patch/commit/PR identity and provider observations;
- provider-neutral execution read/event/session interfaces consumed by lane #16;
- coding-agent operational contract through tests, evidence, independent verification and PR.

### Non-goals

- replacing `OperationalSystemSpec`, `OutcomeContract`, `ActionIntent`, `EffectPlan`, `ExecutionManifest`, reconciliation, verification or semantic commits;
- treating a GitHub response, sandbox exit code, CI green check or model assertion as accepted truth by itself;
- storing secrets in Woyengi canonical state or evidence;
- building the durable Account/Workspace/Membership/Principal/session store owned by #14;
- implementing WebSocket/SSE transport, live shell UI, presence or multiplayer projection owned by #16;
- implementing a general Kubernetes/VM scheduler in this P1 tracer bullet;
- allowing arbitrary host mounts, host networking, privileged containers, Docker socket access or unrestricted host process execution;
- auto-replaying an external mutation after restart/timeout;
- implementation before P0 is explicitly accepted by the parent integration process.

## 5. Invariants and authority rules

1. **P0 gate:** every implementation ticket in this lane is blocked until P0 acceptance is recorded by the integration owner.
2. **Existing truth spine:** every consequential execution is represented by the existing governed effect model. A provider adapter cannot mint acceptance or a semantic commit.
3. **Authority before effect:** dispatch requires an allowed authority/policy/budget/risk manifest. Consequential external operations require authority to be checked again immediately before provider dispatch using the current principal/session state.
4. **Revocation wins:** a session/capability revoked after planning but before dispatch prevents the effect. Revocation after an ambiguous provider write does not erase the observation; recovery reconciles what happened and may require compensation.
5. **Workspace isolation:** execution IDs, bindings, credentials, sandbox leases, provider objects and idempotency claims are scoped by workspace. Cross-workspace lookup is fail-closed.
6. **Confidence is not authority:** model/harness confidence never grants GitHub or sandbox authority.
7. **Transport success is observation:** HTTP 2xx, Git CLI success, container exit 0 and GitHub Actions success are evidence inputs only.
8. **External idempotency is durable:** `(workspaceId, providerId, bindingId, idempotencyKey)` is durably claimed with an immutable request fingerprint before a provider mutation.
9. **Idempotency conflict fails closed:** the same key with a different fingerprint is rejected; it is never coerced into the prior operation.
10. **Ambiguous writes do not retry:** after an outcome that could have reached the provider, recovery performs reads/reconciliation only.
11. **Replay is observational:** replay/rehydration reconstructs state and may re-run deterministic verification; it does not reissue semantic or external effects.
12. **Cancellation is not rollback:** cancellation stops future dispatch/process work. Already-observed external effects remain and require reconciliation or compensation.
13. **Secrets are non-recordable:** credential material is never journaled, logged, emitted to realtime, attached as evidence or injected into an agent-visible sandbox unless the binding policy explicitly requires a scoped provider credential for a provider tool; the initial GitHub tracer bullet does not place GitHub credentials in the coding sandbox.
14. **Evidence is content-bound:** output/test/patch/provider evidence records carry a digest, byte count/content descriptor and execution correlation. A reference whose bytes no longer match its digest is invalid.
15. **Independent verification remains independent:** the GitHub provider adapter and sandbox executor cannot self-certify the final accepted outcome when the contract requires independent verification.

## 6. State and effect model

### 6.1 Coordinator run state

The execution coordinator maintains operational run state separate from canonical acceptance truth:

`PLANNED -> AUTHORIZED | BLOCKED -> DISPATCHING -> OBSERVED -> RECONCILING -> VERIFYING -> ACCEPTED | REJECTED`

Additional control states:

- `CANCEL_REQUESTED`: stop issuing new work and ask active runtime work to terminate;
- `CANCELLED`: no active runtime work remains; prior external effects are still reconciled;
- `RECOVERY_REQUIRED`: durable state proves work was in flight or ambiguous at restart and requires deterministic recovery;
- `FAILED`: a non-ambiguous terminal execution failure; this is not equivalent to an accepted/rejected operational outcome.

These statuses are orchestration projections. `AcceptanceOutcome` remains the authority-bearing final outcome record.

### 6.2 External-effect attempt state

For each `EXTERNAL` expected effect:

`UNCLAIMED -> CLAIMED -> DISPATCHING -> ACKNOWLEDGED | REJECTED | UNKNOWN -> RECONCILING -> CONFIRMED | DIVERGED | UNCERTAIN`

Rules:

- `CLAIMED` is durable before the provider call.
- `ACKNOWLEDGED` means the transport/provider returned an apparent success; it still requires canonical read/reconciliation.
- `UNKNOWN` means the call may have reached the provider. No mutation retry is permitted from this state.
- `DIVERGED` and `UNCERTAIN` block acceptance.
- compensation is a new governed action/effect, never a disposer of the original effect.

### 6.3 Runtime effects

Sandbox/container/process creation, subscriptions and transient streams are `RUNTIME` effects. They have explicit cleanup and may be recreated after restart only when recreation cannot imply replay of a semantic/external effect.

### 6.4 Semantic effects

Semantic changes remain proposed Woyengi state changes. This lane does not alter the verified semantic-commit contract. A successful coding run may propose state updates, but only the existing acceptance/verification path can commit them.

## 7. Provider-neutral ports

The names below are normative interface intent. Coding agents may refine field spelling only if behavior and ownership remain unchanged.

### 7.1 Persistence/auth ports expected from lane #14

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
  claimExternalEffect(input: {
    workspaceId: string;
    providerId: string;
    bindingId: string;
    idempotencyKey: string;
    fingerprint: string;
    manifestId: string;
    expectedEffectId: string;
    recordedAt: string;
  }): Promise<
    | { status: "CLAIMED"; claimId: string }
    | { status: "SAME_REQUEST"; claimId: string; state: ExternalEffectAttemptState }
    | { status: "CONFLICT"; claimId: string }
  >;
  listRecoveryCandidates(input: {
    workspaceId: string;
    limit: number;
    cursor?: string;
  }): Promise<{ items: readonly DurableExecutionState[]; nextCursor?: string }>;
}

export interface ExecutionPrincipalPort {
  resolveSession(input: { sessionId: string; workspaceId: string; at: string }): Promise<{
    principalId: string;
    active: boolean;
  }>;
  authorize(input: {
    workspaceId: string;
    principalId: string;
    operation: "EXECUTE";
    resourceId: string;
    purpose: string;
    at: string;
  }): Promise<{ allowed: boolean; decisionReference: string; rationale: string }>;
}
```

Required semantics:

- `createExecution`, `append`, and `claimExternalEffect` must be durable and atomic at their documented boundary.
- `append` is optimistic/CAS on journal sequence; stale writers fail rather than reorder events.
- #15 never reaches into #14 tables/files/classes directly.
- #14 may implement these ports over any approved durable adapter without importing GitHub/Docker semantics.

### 7.2 Credential/binding port owned by this lane's execution boundary

```ts
export interface CredentialLeasePort {
  lease(input: {
    workspaceId: string;
    principalId: string;
    bindingId: string;
    providerId: string;
    scopes: readonly string[];
    expiresBy: string;
  }): Promise<{ leaseId: string; providerId: string; expiresAt: string; scopes: readonly string[] }>;
  release(input: { leaseId: string }): Promise<void>;
}
```

Credential material is resolved only inside the provider transport adapter using the opaque `leaseId`; it is not part of the public execution object model.

### 7.3 External-effect driver contract

```ts
export interface ExternalEffectDriver<Request, CanonicalState> {
  readonly providerId: string;
  fingerprint(request: Request): string;
  dispatch(input: {
    request: Request;
    credentialLeaseId: string;
    correlation: ExecutionCorrelation;
  }): Promise<ExternalDispatchObservation>;
  reconcile(input: {
    request: Request;
    observation?: ExternalDispatchObservation;
    credentialLeaseId: string;
    correlation: ExecutionCorrelation;
  }): Promise<{
    status: "CONFIRMED" | "DIVERGED" | "UNCERTAIN";
    strategy: "CANONICAL_READ" | "IMMEDIATE_REREAD" | "EVENTUAL_OBSERVATION" | "WEBHOOK" | "HUMAN_CONFIRMATION";
    canonical?: CanonicalState;
    evidence: readonly ContentBoundEvidence[];
    reason: string;
  }>;
}
```

`dispatch()` is called at most once for a claimed external effect unless a later, separately governed action authorizes another write. `reconcile()` may be repeated safely because it is observational.

### 7.4 Ports exposed to lane #16

```ts
export interface ExecutionReadPort {
  getExecution(input: { workspaceId: string; executionId: string; principalId: string }): Promise<ExecutionProjection>;
  readJournal(input: {
    workspaceId: string;
    executionId: string;
    principalId: string;
    afterSequence?: number;
    limit: number;
  }): Promise<{ entries: readonly ExecutionProjectionEvent[]; nextSequence?: number }>;
}

export interface ExecutionEventSink {
  publish(event: {
    workspaceId: string;
    executionId: string;
    sequence: number;
    type: string;
    payload: unknown;
    recordedAt: string;
  }): Promise<void>;
}

export interface SandboxSessionControlPort {
  inspect(input: { workspaceId: string; sandboxId: string; principalId: string }): Promise<SandboxSessionProjection>;
  writeStdin(input: { workspaceId: string; sandboxId: string; processId: string; principalId: string; bytes: Uint8Array }): Promise<void>;
  resize?(input: { workspaceId: string; sandboxId: string; processId: string; principalId: string; columns: number; rows: number }): Promise<void>;
  cancel(input: { workspaceId: string; sandboxId: string; principalId: string; reason: string }): Promise<void>;
  readOutput(input: { workspaceId: string; sandboxId: string; principalId: string; afterSequence?: number; limit: number }): Promise<SandboxOutputPage>;
}
```

Lane #16 owns transport/UI semantics. It may publish/resume these projections, but it cannot mutate execution persistence or bypass authority through internal imports.

## 8. GitHub connector contract

### 8.1 Operation surface

The first implementation must cover the coding vertical with explicit operation names and typed inputs/outputs:

**Observational/read operations**

- `github.repo.get`
- `github.repo.snapshot` (metadata + immutable checkout/archive identity; not a host-side mutation)
- `github.issue.get`
- `github.issue.list`
- `github.branch.get`
- `github.commit.get`
- `github.pr.get`
- `github.pr.list`
- `github.test.get` / check-run observation
- `github.build.get` / workflow-run observation

**Consequential mutation operations**

- `github.issue.comment` and narrowly scoped issue update when required by the WorkEpisode;
- `github.branch.create-or-update` with expected old SHA/precondition;
- `github.commit.publish` from a content-bound tree/patch and expected branch head;
- `github.pr.create` / narrowly scoped PR update;
- workflow/test/build dispatch only when explicitly included in an authorized effect plan. Merely observing CI is read-only.

Repository deletion, destructive history rewrite, force-push, secret administration, organization administration and branch-protection changes are outside the P1 tracer bullet.

### 8.2 GitHub mutation identity and reconciliation

GitHub does not provide a universal server-side idempotency key for all relevant write APIs. Therefore Woyengi's durable idempotency claim is authoritative for dispatch control, and every mutation defines a canonical reread identity:

| Mutation | Durable fingerprint includes | Canonical reconciliation |
| --- | --- | --- |
| issue comment/update | repo, issue number, normalized body/state, effect marker | reread issue/comments and locate exact marker/content digest |
| branch create/update | repo, ref, expected old SHA, target SHA | reread ref; confirm exact SHA |
| commit publish | repo, parent SHA, tree/content digest, message digest | reread commit/ref; confirm immutable commit/tree identity |
| PR create/update | repo, head, base, title/body digest, effect marker | list/reread PR by head/base + marker; confirm fields and head SHA |
| workflow dispatch | repo, workflow, ref, input digest, effect marker when provider supports it | observe resulting run using provider correlation and immutable run identity; otherwise remain uncertain |

A Woyengi effect marker may be embedded only in provider fields where it is semantically harmless (for example an HTML comment in a PR body/comment). The marker contains an opaque effect ID, never secrets or private evidence.

### 8.3 Uncertain GitHub write algorithm

1. normalize request and compute stable fingerprint;
2. obtain current principal authority decision and credential lease;
3. durably claim the external effect;
4. if claim is `SAME_REQUEST` and already `CONFIRMED`, return the prior projection without dispatch;
5. if claim is `SAME_REQUEST` and state is `UNKNOWN/RECONCILING/UNCERTAIN`, perform canonical reread only;
6. if claim is `CONFLICT`, fail closed;
7. for a new claim, append `DISPATCHING` before network dispatch;
8. perform exactly one provider mutation call;
9. record provider/transport receipt and observed effect, including timeout/connection-loss as `UNKNOWN` when delivery cannot be disproved;
10. canonical reread and create `EffectReconciliation`;
11. only `CONFIRMED` may proceed toward outcome verification; `DIVERGED/UNCERTAIN` block acceptance and may require human review or a separately governed compensating action.

## 9. Sandbox contract and lifecycle

### 9.1 Sandbox specification

A sandbox request is immutable after creation and includes:

- `sandboxId`, workspace/principal/work/execution correlation;
- image by immutable digest, not mutable tag alone;
- non-root user identity;
- working-directory descriptor;
- read-only base filesystem where feasible;
- explicit writable ephemeral paths/volume IDs;
- explicit repository snapshot/working-copy input identity;
- CPU, memory, PID, wall-clock and output-byte budgets;
- command allow/deny policy only when the WorkEpisode requires it; otherwise process execution is still bounded by container isolation;
- environment variable **names** and opaque binding references, never serialized secret values;
- network policy: `NONE` by default; `ALLOWLIST` only when enforcement is available and explicitly authorized;
- no privileged mode, no Docker socket, no host PID/IPC namespace, no host network, no unapproved devices/capabilities;
- cancellation/termination grace period.

If the runtime cannot enforce a requested security constraint (for example hostname egress allowlisting), sandbox creation fails closed rather than silently broadening the policy.

### 9.2 Lifecycle

`CREATED -> STARTING -> RUNNING -> EXITED | TIMED_OUT | CANCELLED | FAILED -> DISPOSED`

After runtime restart an in-flight sandbox may also be projected as `LOST` until the sandbox adapter can inspect the provider. Recovery may reattach/inspect or terminate runtime state. It does not imply repeating GitHub effects.

### 9.3 Process/output evidence

Each stdout/stderr/test-artifact stream is sequenced. Evidence includes at minimum:

- execution/sandbox/process correlation;
- first/last output sequence;
- byte count;
- content digest;
- truncation flag;
- command descriptor digest;
- exit status/signal/time;
- test-report/artifact digest when present.

Truncation is visible and prevents a verifier from claiming complete-output evidence unless the verification contract permits partial evidence.

### 9.4 Required escape falsifiers

The implementation must prove failure for:

- path traversal/symlink escape outside writable workspace;
- host filesystem access outside approved mounts;
- Docker socket/device access;
- privileged/capability escalation;
- host PID/network namespace requests;
- unapproved network egress;
- process fork/PID exhaustion beyond budget;
- memory/CPU/wall-clock/output budget breach;
- secret reflection into logs/evidence;
- cancellation followed by silent process continuation.

## 10. Compute-node/runtime integration

The existing `HostedWorkloadEnvelope` is the preferred dispatch seam because it already carries correlation, principal, authority reference, budget, idempotency, expected-effect reference and reconciliation plan, and because `HostedComputeObservation` is explicitly observation-only.

Implementation rules:

- add a sandbox-backed `WorkloadExecutor`; do not teach `HostedComputeNodeRuntime` provider-specific GitHub semantics;
- consume compute leases once and persist execution identity before process start;
- compute/runtime may report usage and process observation, but cannot accept operational truth;
- cancellation propagates to the active sandbox/process and prevents new work from starting;
- runtime recovery distinguishes deterministic runtime work from ambiguous external effect state;
- the generic `PlatformWorker` retry loop must not blindly retry a handler whose last durable external-effect state is `DISPATCHING/UNKNOWN/UNCERTAIN`; such handlers transition to reconcile-only recovery.

## 11. Live execution API

The first API should be typed rather than hiding execution under arbitrary `StateValue` control payloads. Exact route spelling may follow current API conventions, but behavior is fixed:

- create/authorize execution from an existing WorkEpisode + operational/outcome contract reference;
- get execution projection;
- get paginated ordered journal projection;
- cancel execution;
- request recovery/reconciliation of a recoverable execution;
- never expose credential material;
- require `Idempotency-Key` on create/cancel/recovery mutations;
- authenticate and authorize every route using workspace-scoped resources;
- use stable trace/execution IDs in responses;
- return `409`-class conflict for idempotency fingerprint conflicts and stale state, not a silent replay;
- surface `UNCERTAIN_EXTERNAL_EFFECT` distinctly from ordinary provider failure.

This API becomes the public backend dependency for lane #16. Lane #16 may add realtime transport around the read/event ports without importing execution internals.

## 12. Coding-agent operational contract

The P1 coding tracer bullet is:

`GitHub issue -> WorkEpisode/contract -> harness selection -> governed execution -> repository snapshot -> isolated edit/test sandbox -> content-bound evidence -> authorized GitHub branch/commit/PR effects -> canonical reconciliation -> independent verification/review -> accepted outcome`

Required input references:

- workspace/principal/session;
- WorkInstance/WorkEpisode;
- source OperationalSystemSpec/OutcomeContract or their stable references once P0 integration lands;
- GitHub binding ID, repository locator and issue identity;
- base ref/SHA and permitted target branch namespace;
- execution budget/risk ceiling;
- required test/evidence/verification assertions.

Required outputs:

- execution manifest/journal projection;
- repository input snapshot identity;
- sandbox/process observations;
- patch/tree digest;
- tests run and content-bound results;
- GitHub branch/commit/PR canonical identities when authorized;
- effect reconciliation results;
- independent verification result;
- accepted/rejected outcome; and
- no semantic commit unless the existing acceptance contract permits it.

Policy gate: a failed required test or missing required evidence prevents subsequent GitHub publish effects. A PR that already exists because a later verifier rejects the result remains a real external effect; repair/close/amend is a new governed action.

## 13. Falsifier-first verification matrix

| Falsifier | Expected result | Verification seam |
| --- | --- | --- |
| same external idempotency key + same fingerprint submitted twice | provider mutation dispatched once; second call returns/reconciles prior effect | fake GitHub transport call count + durable claim after coordinator restart |
| same key + different fingerprint | fail closed before provider call | durable claim conflict test |
| GitHub returns 201 but canonical reread disagrees | `DIVERGED`; no acceptance | GitHub adapter test |
| GitHub request times out after server created PR | `UNKNOWN -> canonical reread -> CONFIRMED`; no second create call | adversarial fake transport |
| GitHub request times out and canonical state cannot establish result | `UNCERTAIN`, review required; no retry after restart | restart/recovery integration test |
| process exits 0 but required test artifact missing/digest invalid | verification/acceptance rejected | evidence verifier test |
| sandbox tries `/host`, Docker socket, privileged mode or host network | creation/execution denied | Docker/process sandbox integration tests |
| process exceeds time/memory/PID/output budget | terminated and usage/evidence records show exceeded budget | sandbox integration test |
| principal revoked between planning and GitHub write | provider mutation not called | authority boundary test |
| cancellation during sandbox edit | process terminated; no later GitHub publish effect | coordinator integration test |
| cancellation after ambiguous GitHub write | no repeat write; reconciliation still runs | recovery test |
| runtime restarts with `DISPATCHING` external effect | reconcile-only recovery | durable restart test |
| runtime restarts with deterministic sandbox command not yet started | may resume/recreate runtime work only if policy allows and no external effect is replayed | recovery test |
| cross-workspace execution/sandbox/binding lookup | default deny/not found; no metadata leakage | isolation test |
| credential token appears in log/evidence/error/event | test fails; redaction/non-recordability invariant violated | adversarial secret fixture |
| reordered/duplicate execution events | durable journal ordering remains canonical; projections dedupe by execution+sequence | read/event port test |
| provider self-verification only | rejected when independent verifier required | existing governed-effects acceptance seam |
| P0 outcome contract forbids GitHub effect class or budget exhausted | no dispatch | manifest/policy/budget test |

## 14. Migration, restart, replay and rollback

### Migration

- no P1 source migration begins before P0 acceptance;
- introduce ports first, then adapters;
- keep existing in-memory behavior usable in tests while adding durable adapters;
- do not migrate canonical truth into provider-specific GitHub records;
- any `GovernedExecutionEngine` restore seam must validate the snapshot/journal and reject corruption or non-contiguous ordering.

### Restart/recovery

Recovery is derived from durable state:

- runtime-only in-flight work: inspect/recreate/terminate according to sandbox/provider lease policy;
- acknowledged external write: canonical reread;
- `DISPATCHING/UNKNOWN`: canonical reread only;
- `UNCERTAIN`: repeated observation or human review, never blind mutation retry;
- confirmed external write with pending verification: resume evidence/verification;
- accepted/rejected: read-only unless a new governed action is created.

### Rollback

Software rollback may revert code/adapters. It does not erase external GitHub effects. A GitHub repair (close PR, reset branch where authorized, corrective comment, etc.) is a separately authorized compensating action with its own intent/effect/reconciliation trail.

## 15. Dependencies and lane contracts

### Hard blocker

- **P0 acceptance**. No implementation ticket may start before the P0 OperationalSystemSpec/WorldBundle alignment is accepted by the integration owner.

### Lane #14 — durable state/auth

#15 requires only the public behavior of `ExecutionDurabilityPort` and `ExecutionPrincipalPort`. It must not import #14's persistence classes/schema. The live vertical cannot be declared restart-safe until those ports have a durable adapter and revocation semantics.

### Lane #16 — realtime/shell

#16 consumes `ExecutionReadPort`, `ExecutionEventSink` integration and `SandboxSessionControlPort`. #15 does not implement WebSocket/SSE or shell UI. #16 must not mutate execution state except through #15's public commands.

### P0 contracts

The implementation must consume the accepted `OperationalSystemSpec`/`OutcomeContract` public contracts once their P0 integration is merged. If those contracts cannot express allowed/forbidden effect classes, budgets, attempts, termination or verification requirements needed by this spec, implementation stops and requests the minimum P0 interface addition rather than inventing a duplicate contract in this lane.

## 16. Acceptance criteria for this planning lane

Planning is complete when:

- exact existing seams and gaps are documented;
- execution, GitHub, sandbox, credential, durability, authority and realtime/shell boundaries are provider-neutral where required;
- external-effect idempotency and uncertain-write behavior are explicit;
- sandbox isolation and lifecycle are explicit;
- restart/cancellation/recovery semantics prohibit consequential replay;
- coding-agent execution is specified through tests/evidence/reconciliation/verification;
- falsifiers cover duplicate effects, uncertain GitHub writes, sandbox escape, restart, authority revocation, evidence integrity and workspace leakage;
- dependency-ordered tracer-bullet tickets name future exclusive file ownership and verification commands;
- a durable handoff records that no source code, shared ADR, `prd.json`, or `progress.txt` was modified.

## 17. Human gates and unresolved risks

### Human gates

- P0 acceptance before any implementation;
- review before enabling any GitHub operation broader than the enumerated tracer-bullet surface;
- review before enabling sandbox network access broader than fail-closed/explicit allowlist;
- review for `UNCERTAIN` external effects when canonical observation cannot settle the result;
- review before a compensating action that itself has destructive external consequences.

### Unresolved risks to carry into implementation

1. **GitHub mutation idempotency is not uniform.** Reconciliation markers/preconditions must be tested against the exact APIs selected; ambiguity must remain visible.
2. **Docker hostname egress allowlisting is not inherently strong.** The initial implementation should default to no network and fail closed unless an enforceable egress mechanism exists.
3. **Current `GovernedExecutionEngine` has one `ExecutionReceipt` per manifest.** A coding run can contain multiple external effects. The implementation must decide whether the receipt represents the execution provider while each external effect is represented through observations/reconciliation, or whether a minimal multi-dispatch receipt seam is required. Do not silently overload receipt identity.
4. **The current effects engine is in-memory.** A narrow, validated restore/replay seam is required for durability; do not bypass it by accepting unvalidated persisted snapshots as truth.
5. **Generic runtime retries conflict with uncertain external writes.** External-effect handlers need an explicit reconcile-only recovery mode.
6. **Credential broker implementation ownership may depend on #14's persistence/security choices.** Keep the port stable and credential material non-recordable.
7. **P0 `OutcomeContract` is broader than the current `VerificationContract`.** Implementation must map the accepted P0 contract into execution gates without collapsing outcome semantics into verification-only semantics.

## 18. Ticket order

Implementation tickets are defined under `docs/tickets/p1-execution-github-sandbox/` and must be executed in this dependency order:

1. `P1-EXE-001` — durable governed execution coordinator and recovery semantics;
2. `P1-EXE-002` — GitHub provider adapter, bindings and uncertain-write reconciliation;
3. `P1-EXE-003` — isolated Docker/process sandbox and evidence contract;
4. `P1-EXE-004` — compute-node/runtime integration, budgets, cancellation and recovery;
5. `P1-EXE-005` — live execution HTTP/read/event/session API seams;
6. `P1-EXE-006` — coding-agent issue-to-tests-to-verified-PR tracer bullet.

Tickets may be implemented sequentially or only parallelized where their declared future ownership does not overlap and their prerequisites are already merged.