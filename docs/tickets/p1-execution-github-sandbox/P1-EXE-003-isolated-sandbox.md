# P1-EXE-003 — Isolated Docker/Process Sandbox + Evidence

Status: **BLOCKED ON P0 ACCEPTANCE AND P1-EXE-001**  
Issue lane: #15  
Depends on: P1-EXE-001 public execution correlation/budget contracts; accepted P0  
Unblocks: P1-EXE-004, P1-EXE-006

## Outcome contract

Provide a real, fail-closed sandbox abstraction for untrusted coding workloads. A workload can start a bounded process in an isolated Docker-backed environment, stream sequenced output, enforce resource/network/filesystem policy, cancel/terminate it, inspect/recover it after runtime restart, and emit content-bound evidence.

Success means adversarial workloads cannot obtain host/Docker privileges or escape allowed storage/network boundaries, and budget/cancellation violations produce explicit terminal observations rather than silent continuation.

## Future exclusive file ownership

The implementation agent owns **only**:

- `packages/sandbox/**` (new package directory).

Everything else is read-only. If compute-node/runtime changes are needed, leave them for P1-EXE-004. If execution-core contracts are insufficient, report the minimum interface change rather than editing P1-EXE-001 files.

## Preconditions / blockers

1. P0 accepted.
2. P1-EXE-001 public execution correlation/budget conventions available.
3. A supported Docker-compatible runtime is available for integration tests. Tests that require Docker must detect unavailable runtime and report `not run`/skip explicitly; they may not claim isolation passed without execution.

## Public interfaces

Expose a provider-neutral sandbox contract from `packages/sandbox/src/index.ts` similar to:

```ts
export interface SandboxSpec {
  readonly id: string;
  readonly correlation: ExecutionCorrelation;
  readonly principalId: string;
  readonly image: { readonly reference: string; readonly digest: string };
  readonly repositoryInput?: ContentBoundInput;
  readonly workingDirectory: string;
  readonly writablePaths: readonly string[];
  readonly environment: readonly SandboxEnvironmentBinding[];
  readonly network: SandboxNetworkPolicy;
  readonly budget: SandboxBudget;
  readonly terminationGraceMs: number;
}

export interface SandboxRuntimePort {
  create(spec: SandboxSpec): Promise<SandboxLease>;
  start(input: SandboxStartRequest): Promise<SandboxProcess>;
  inspect(input: SandboxInspectRequest): Promise<SandboxInspection>;
  writeStdin(input: SandboxStdinRequest): Promise<void>;
  readOutput(input: SandboxOutputRequest): Promise<SandboxOutputPage>;
  cancel(input: SandboxCancelRequest): Promise<SandboxInspection>;
  dispose(input: SandboxDisposeRequest): Promise<void>;
}
```

Required lifecycle:

`CREATED -> STARTING -> RUNNING -> EXITED | TIMED_OUT | CANCELLED | FAILED -> DISPOSED`

An in-flight sandbox that cannot be found after runtime restart is projected as `LOST` until recovery policy resolves it.

## Immutable sandbox policy

`SandboxSpec` is immutable after creation. It must capture at least:

- workspace/principal/work/execution correlation;
- image resolved to immutable digest;
- non-root execution user;
- read-only base/root filesystem where supported;
- explicit writable ephemeral workspace paths;
- no arbitrary host bind mount API in public request shape;
- repository input by content digest + resolved source revision;
- CPU quota/weight limit;
- memory limit;
- PID/process limit;
- wall-clock limit;
- maximum stdout/stderr/artifact bytes;
- environment variable **names** + opaque binding references, never serialized secret values;
- network mode `NONE` by default;
- `ALLOWLIST` only if the adapter can actually enforce the requested egress policy;
- no privileged container mode;
- drop unnecessary Linux capabilities, no unapproved devices;
- no Docker/container runtime socket;
- no host PID/IPC/network namespace;
- `no-new-privileges`/equivalent hardening where supported;
- termination grace + forced kill after grace.

If a requested isolation control cannot be enforced, creation fails. There is no permissive fallback.

## Repository/input handling

The initial coding tracer bullet must not expose GitHub credentials to the sandbox. Repository bytes/working-copy inputs are materialized by the orchestrator/GitHub provider from an immutable snapshot identity, then supplied as a content-bound sandbox input.

Writable edits occur in an ephemeral workspace. Result extraction returns content-bound patch/tree/artifact descriptors to the orchestrator. Publishing to GitHub occurs through P1-EXE-002, not by giving `git push` credentials to untrusted code.

## Network policy

Initial behavior:

- `NONE`: supported and default;
- `ALLOWLIST`: explicit domains/endpoints + ports + purpose; must fail closed if strong enforcement is unavailable;
- unrestricted host/network mode is not part of P1.

Dependency installation requiring network is a separate authorized runtime capability. The first coding tracer may use prebuilt images/caches or an enforceable allowlist. Do not weaken isolation merely to make package installation convenient.

## Output and evidence contract

Every process emits monotonic output chunks:

```ts
export interface SandboxOutputChunk {
  readonly sandboxId: string;
  readonly processId: string;
  readonly sequence: number;
  readonly stream: "stdout" | "stderr";
  readonly bytes: Uint8Array;
  readonly recordedAt: string;
}
```

Content-bound evidence generated from output/artifacts includes:

- execution/sandbox/process IDs;
- command descriptor digest;
- input revision/digest;
- first/last sequence included;
- byte count;
- SHA-256 or repository-approved cryptographic digest;
- truncation flag;
- exit code/signal/status;
- started/finished timestamps;
- test artifact/report digest when applicable.

A truncated stream is explicitly incomplete and cannot satisfy a full-output evidence requirement.

## Cancellation semantics

- cancellation is idempotent;
- it prevents new child process starts in the lease;
- active process receives graceful termination then forced kill after `terminationGraceMs`;
- terminal inspection must prove the process/container is no longer running or return an explicit `CANCELLATION_UNCERTAIN/LOST`-class observation;
- cancellation does not delete evidence or imply rollback of GitHub effects;
- `dispose()` is runtime cleanup only.

## Restart/recovery semantics

Given durable sandbox/process identifiers, a new adapter instance must be able to:

- inspect a still-running sandbox and reattach to observable state when supported;
- determine already-exited status without rerunning command;
- mark unlocatable prior sandbox `LOST` rather than silently recreate the process;
- terminate an orphaned running sandbox if recovery policy requests cancellation;
- never infer that an external GitHub write should be repeated.

## Non-goals

- Kubernetes or multi-cloud scheduling;
- shell/realtime transport owned by #16;
- GitHub mutation;
- host-process execution as fallback for untrusted coding tasks;
- unrestricted network;
- privileged containers;
- exposing raw secret values to agent code;
- accepting process exit 0 as independent verification.

## Falsifiers / tests first

Create failing unit/integration tests for:

1. mutable image tag without resolved digest -> reject;
2. root/privileged/host PID/host network/Docker socket request -> reject;
3. arbitrary host mount/path outside approved input/workspace -> reject;
4. path traversal and symlink attempt escaping writable workspace -> cannot read/write host sentinel;
5. unapproved network egress under `NONE` -> connection denied;
6. `ALLOWLIST` requested but enforcement unavailable -> sandbox creation fails closed;
7. PID/fork bomb exceeds PID budget -> process/container terminated without host exhaustion;
8. memory limit breach -> bounded termination + explicit budget result;
9. wall-clock timeout -> terminal `TIMED_OUT` + process absent afterward;
10. output flood exceeds output budget -> bounded/truncated output + explicit evidence truncation;
11. cancellation -> no process remains after grace/kill path;
12. repeated cancellation -> idempotent terminal state;
13. runtime adapter restart after process exit -> inspect previous exit, never rerun command;
14. runtime adapter restart while process remains -> inspect/reattach or explicit lost state, never duplicate process;
15. repository input digest mismatch -> refuse start;
16. extracted patch/artifact bytes changed after digest -> evidence validation fails;
17. credential-shaped fixture injected into provider-side adapter metadata -> never serialized into sandbox projection/log/evidence unless explicitly designated as agent-visible input; GitHub token path remains absent.

## Evidence required from implementation

- exact Docker/runtime version used;
- sandbox configuration/inspection proof for non-root, capabilities, mounts, namespaces, network and limits;
- host sentinel escape-test results;
- resource-limit/cancellation results;
- content-digest verification for output and patch artifacts;
- explicit record of Docker-required tests not run when runtime unavailable.

## Verification ladder

1. `node --test packages/sandbox/test/*.test.ts`
2. run the package's Docker-backed integration tests explicitly
3. `pnpm typecheck`
4. `pnpm boundaries`
5. `pnpm test:all`
6. `pnpm benchmark` for sandbox escape/budget adversarial fixtures if registered there
7. `pnpm prod:check` once the real runtime adapter is production-wired

## Authority / effects

Sandbox creation/process execution is a governed `RUNTIME` effect. It requires an authorized execution manifest and budget. Runtime cleanup may use disposer semantics. Any provider/network call from inside the sandbox that would create an external consequence is prohibited unless separately modeled and authorized; the initial GitHub path publishes only through the governed GitHub adapter outside the sandbox.

## Rollback

Disposing the sandbox is safe runtime cleanup. Rolling back code does not alter already-published GitHub state. Persistent evidence descriptors remain part of the execution journal through their durability adapter.