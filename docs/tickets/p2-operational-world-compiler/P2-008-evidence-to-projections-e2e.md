# P2-008 — Full evidence-to-Work/App/World golden path and replay gate

Parent: #17
Spec: `docs/specs/p2-operational-world-compiler.md`
Depends on: P2-001..007, accepted P0, explicit P1 #14/#15 ports
Mode: product engineering + integration verification

## Outcome / Outcome Contract

Wire the completed P2 package behind one public index and prove one coding/business-neutral golden path from authorized evidence through normalization, identity/reconstruction, operational inference, constrained synthesis, validation, `OperationalSystemSpec`/IR and Work/App/World projections.

The E2E must also prove deterministic provider replay, conflict/unknown preservation, authority-confidence separation and cross-projection semantic parity without issuing semantic/external effects.

## Global blockers

- P0 program acceptance, including #7/#8/#9 public seams.
- P1 #14/#15 public interfaces explicitly frozen and adapter-compatible.
- P2-001..007 complete.

## Future exclusive file ownership

Only:

- `packages/operational-world-compiler/src/index.ts`
- `packages/operational-world-compiler/test/e2e.test.ts`
- `packages/operational-world-compiler/test/fixtures/golden/**`

The agent may import all P2 stage/projection modules but may not edit them. If integration reveals an upstream defect, report it to the owning P2 ticket/agent rather than broadening ownership.

## Inputs

Pinned golden evidence corpus containing:

- multiple source artifacts with provenance;
- aliases plus one safely resolvable identity;
- one non-blocking ambiguity/unknown;
- one explicit consequential procedure;
- one authority requirement with evidence;
- constraints/invariant/outcome evidence;
- a defensible non-consequential synthesis gap;
- APP, WORK and WORLD projection requirements.

Two execution modes:

1. deterministic fake/captured provider proposal mode;
2. replay mode with provider ports disabled and captured proposal payloads supplied.

## Outputs

One public P2 package seam exporting the compiler/contracts and intended stage/projection adapters, plus E2E assertions for:

- `ComprehensionModel`;
- `OperationalSystemSpec`;
- Operational IR;
- Work projection descriptor;
- App projection;
- WorldBundle;
- complete stage/provenance/diagnostic trace;
- parity and deterministic replay report.

## Public seam

`packages/operational-world-compiler/src/index.ts` is the only package-level public export surface introduced here. Export only stable P2 contracts/compiler/stage adapter entrypoints needed by consumers. Do not deep-export provider implementation details.

## Required E2E behavior

1. Golden visible evidence compiles to `ready` or intentionally `needs-review` only if the fixture's non-blocking assumption policy says so; no blocker is hidden.
2. Every model-originated candidate can be traced to captured proposal provenance and evidence/basis refs.
3. The non-blocking ambiguity remains inspectable in comprehension/trace.
4. Authority requirement comes from evidence/policy semantics, never provider confidence.
5. Accepted synthesis appears as a `ComprehensionAssumption`, not verified state.
6. P0 constructors accept the assembled comprehension/spec/IR.
7. Work/App/World outputs preserve all source semantics relevant to each projection; no projection adds goals or drops required outcome/invariant/authority semantics.
8. WorldBundle passes P0 conformance and public/private leakage checks.
9. Replaying captured proposal payloads with provider ports disabled yields identical deterministic downstream IDs/normalized outputs.
10. Reordering semantically equivalent visible evidence does not change deterministic outputs.
11. Running the E2E compiler performs no canonical semantic commit, Work instantiation by default, procedure execution, connector write or external effect.
12. Any optional P1 Work adapter integration is a separate explicit call after compilation and is not required to prove compiler readiness.

## Required failure companion

Run the same path with one fixture corruption (authority requirement removed or contradictory consequential action inserted) and assert:

- final status becomes `blocked`;
- expected diagnostic is retained;
- no projections are emitted as ready artifacts;
- no effect/commit path runs.

## Explicit non-goals

- No fixing stage code from this ticket.
- No Veritas runtime/qualification invocation.
- No production UI/realtime shell integration.
- No hosted provider requirement for tests.
- No release-readiness or scientific/frontier qualification claim.

## RED / falsifiers

1. Provider-disabled replay attempts a model call.
2. Replay changes spec/projection deterministic identities.
3. Work/App/World disagree on required objective/outcome/invariant/authority semantics.
4. A retained conflict/unknown vanishes from trace/comprehension.
5. A provider confidence field becomes governing authority.
6. A blocked run still returns ready projections.
7. Compilation writes canonical semantic state or triggers an external effect.
8. Public package index exposes concrete provider/Veritas implementation types.

## Verification matrix

Run in order:

1. `node --test packages/operational-world-compiler/test/e2e.test.ts`
2. all `packages/operational-world-compiler/test/*.test.ts`
3. package-local P2 benchmark runner from P2-005
4. relevant P0 operational-spec/Composer/WorldBundle conformance tests through repository test suite
5. `pnpm typecheck`
6. `pnpm boundaries`
7. `pnpm test:all`

If P1 provides an adapter conformance test command, run it only after the core provider-free E2E is green and record it separately.

## Acceptance evidence

Implementation handoff must include:

- golden fixture manifest and captured proposal payload IDs/digests;
- stage-by-stage input/output/provenance summary;
- source spec/IR/Work/App/World IDs;
- cross-projection semantic parity matrix;
- provider-disabled replay equality proof;
- corrupted-fixture blocker proof;
- authority-confidence conflation count = 0;
- deterministic replay mismatches = 0;
- public/private leakage count = 0;
- commands actually run and failures.

## Authority / external-effect constraints

This ticket proves compilation and projection only. Compiler success does not authorize persistence/acceptance. Human/authorized semantic acceptance remains a separate governing operation. External execution remains #15/governed-execution territory.

## Rollback / replay

The entire golden run is replayable from immutable visible fixture inputs plus captured provider proposals and version identifiers. Rollback selects prior compiler/projection versions and regenerates outputs; no canonical evidence/history rewrite.

## Completion / next action

After this ticket is green, perform human architecture/authority review before calling P2 implemented. Veritas may then consume resulting canonical WorldBundles through its standalone adapter; product verticals may consume Work/App projections through their public ports.