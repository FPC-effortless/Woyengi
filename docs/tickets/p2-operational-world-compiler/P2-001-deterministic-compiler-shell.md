# P2-001 — Deterministic compiler shell and typed trace/result contract

Parent: #17
Spec: `docs/specs/p2-operational-world-compiler.md`
Mode: product engineering

## Outcome / Outcome Contract

Create the smallest executable `operational-world-compiler` shell that can run an injected sequence of typed stages over a deterministic fixture and return an immutable `OperationalWorldCompilation` with stable run identity, stage reports, provenance manifest and fail-closed status.

The shell must prove that provider proposal payloads are data inputs to deterministic downstream compilation, not hidden side effects or canonical state writes.

## Global blockers

- P0 operational contracts accepted/merged (#7 and program acceptance).
- P1 public interfaces from #14/#15 are explicit enough that P2 can depend on ports rather than implementation files, even though this ticket uses deterministic fakes only.
- No implementation before those conditions are met.

## Future exclusive file ownership

The implementation agent for this ticket owns **only**:

- `packages/operational-world-compiler/src/contracts.ts`
- `packages/operational-world-compiler/src/compiler.ts`
- `packages/operational-world-compiler/test/compiler-shell.test.ts`
- `packages/operational-world-compiler/test/fixtures/shell/**`

Do not edit `packages/operational-spec/**`, Composer, Work, reconstruction, shared ADR/spec files, root project-control files, or files assigned to P2-002..008.

## Inputs

A typed compile request containing:

- run/compiler version;
- workspace/principal;
- objective and source refs;
- valid/transaction time;
- requested projections;
- synthesis policy ID.

Injected stage functions return immutable stage reports and typed outputs/proposals. The fixture stages are deterministic fakes.

## Outputs

- `OperationalWorldCompilation` with `ready | needs-review | blocked`;
- ordered `StageReport[]` with mode `deterministic | model-proposal | gate`;
- normalized `CompilerDiagnostic[]`;
- provenance manifest;
- optional comprehension/spec/IR/projection slots without implementing their domain stages yet.

## Public seam being established

Planning-level contracts from the P2 spec:

- `OperationalWorldCompileRequest`
- `OperationalWorldCompilation`
- `Proposal<T>`
- `CompilerDiagnostic`
- `StageReport`
- `CompilerStage`
- stage function/port protocol consumed by the orchestrator.

Later tickets must plug into this seam without modifying `compiler.ts`.

## Required behavior

1. Stage order is explicit and stable.
2. A blocking diagnostic forces final status `blocked`.
3. Non-blocking review diagnostics can produce `needs-review` but never `ready` if a blocker exists.
4. Equivalent normalized requests and identical captured stage payloads produce identical deterministic result identity/order.
5. The orchestrator never calls persistence, semantic-commit or external-effect APIs.
6. Provider/verifier exceptions are converted to a typed blocking diagnostic unless they are contract/programmer errors explicitly documented as throws.
7. Returned values are immutable or treated as immutable by construction.
8. Replaying a captured proposal payload with provider stages disabled can drive downstream deterministic stages.

## Interfaces / dependency rule

`compiler.ts` must depend only on P2 contracts and injected stage functions/ports. It must not import provider SDKs or P1/P0 implementation internals.

P0 types may be imported from their public package index after acceptance, but the shell must not instantiate a spec in this ticket.

## Explicit non-goals

- No evidence loading/decomposition.
- No entity resolution/reconstruction.
- No inference or synthesis.
- No P0 contract assembly.
- No Work/App/World projection.
- No persistence or external execution.

## RED / falsifiers

1. Same semantic request with reordered source refs produces a different normalized run result.
2. A blocking stage diagnostic is followed by `ready`.
3. A failed provider stage silently disappears from trace/provenance.
4. Replaying captured stage output requires calling the provider again.
5. A stage can mutate a previous stage report/result and change the final trace after return.
6. Compiler code imports a concrete model/provider/database/Veritas runtime.

## Required verification

Run in order:

1. `node --test packages/operational-world-compiler/test/compiler-shell.test.ts`
2. `pnpm typecheck`
3. `pnpm boundaries`
4. `pnpm test:all`

Do not run or alter external benchmarks merely to obtain green status.

## Evidence to capture

In the implementation handoff/PR:

- RED-capable determinism/blocking/replay tests;
- exact public type signatures;
- provider-free replay fixture hash;
- commands run and failures;
- confirmation that no semantic/external effect API is reachable from the shell.

## Authority / external-effect constraints

The shell is computational only. A `ready` result is a compiler-consistent candidate, not accepted governing state. No identity merge, authority grant, semantic commit, Work instantiation, connector call or external effect is permitted.

## Rollback / replay

All shell outputs are rebuildable. Rollback selects a prior compiler version and replays captured normalized request + stage payloads. Never roll back by rewriting canonical evidence/history.

## Dependencies / unlocks

Blocked globally by P0 acceptance + explicit P1 ports.

After completion, unlocks P2-002, P2-003 and P2-004 to implement stage modules against a stable injected-stage seam.