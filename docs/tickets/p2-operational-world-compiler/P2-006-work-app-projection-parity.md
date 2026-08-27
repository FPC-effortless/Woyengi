# P2-006 — OperationalSystemSpec/IR to Work + App projection parity tracer

Parent: #17
Spec: `docs/specs/p2-operational-world-compiler.md`
Depends on: P2-001..005, P0 #7/#8, P1 #14 public Work interface
Mode: product engineering

## Outcome / Outcome Contract

Take one validation-eligible candidate, deterministically assemble it through the accepted P0 `ComprehensionModel`/`OperationalSystemSpec`/Operational IR public seams, then produce both a neutral Work projection descriptor and an App projection while proving that goals, outcome contracts, invariants, capability/authority requirements and provenance are preserved.

The compiler must not instantiate durable Work or make AppBlueprint canonical.

## Global blockers

- P0 accepted, including #7 canonical contract and #8 App projection public seam.
- P1 #14/#15 public interfaces explicit; the Work adapter part additionally requires #14's durable Work instantiation port to be frozen.
- P2-001..005 landed.

## Future exclusive file ownership

Only:

- `packages/operational-world-compiler/src/projections/work-app.ts`
- `packages/operational-world-compiler/test/work-app-projection.test.ts`
- `packages/operational-world-compiler/test/fixtures/projections/work-app/**`

No Composer, Work, P0 contract, P1 persistence or other P2 file edits.

## Inputs

- validation-eligible compiler candidate;
- P0 public constructors/validators for comprehension/spec/IR;
- injected `AppProjectionPort` implemented against Composer public projection seam;
- P2 neutral `WorkProjectionPort`/descriptor adapter.

## Outputs

- P0-valid `ComprehensionModel`;
- P0-valid `OperationalSystemSpec`;
- deterministic Operational IR;
- `WorkProjectionDescriptor` containing source spec/version, workspace/objective, actor/activity/procedure/authority/outcome/evidence/provenance refs;
- AppBlueprint from the P0 Composer projection seam;
- semantic parity report for required fields.

## Required behavior

1. Final contract assembly is deterministic and uses only accepted P0 public constructors/validators.
2. Blocking P2 diagnostics prevent final projection.
3. Work descriptor has explicit source-spec provenance and does not contain storage/session implementation types.
4. App projection carries source-spec/IR provenance required by P0 #8.
5. Neither projection may add a new goal, weaken/drop an outcome assertion/invariant, or drop an authority requirement needed by its represented activities.
6. Projection-specific narrowing is allowed only where the source projection requirement authorizes it.
7. Existing Composer reuse/configure/compose/adapt/extend/generate preference remains owned by Composer; P2 does not recreate package selection logic.
8. Work projection is a descriptor until a separate authorized P1 adapter instantiates it.

## Required P1 adapter boundary

P2 defines/consumes a `WorkProjectionPort`; P1 may implement it against durable Work state. Required semantics are:

```text
input: workspace principal + WorkProjectionDescriptor + source spec/version
output: durable Work instance reference/version OR typed authorization/persistence failure
```

P2 must not import P1 storage repositories or session tables. If #14's interface cannot support this without shared implementation coupling, raise the minimum integration request to #14.

## Explicit non-goals

- No direct `WorkRegistry`/database mutation from compiler logic.
- No App package selection rewrite.
- No WorldBundle.
- No external procedure execution.
- No P0 schema change.

## RED / falsifiers

1. Work descriptor cannot be traced to source spec/version.
2. App projection drops a required outcome/invariant/authority requirement.
3. Projection adds a goal absent from the source spec.
4. P2 reimplements Composer's package preference/order and diverges from P0 #8.
5. Compiler directly instantiates Work as a side effect of projection.
6. P2 projection imports a P1 storage/session implementation file.
7. Equivalent normalized candidate produces different spec/IR/projection descriptors.

## Required parity fixture

One operational workflow with:

- at least two actor roles;
- one consequential procedure requiring authority;
- one outcome contract with evidence and invariant requirements;
- one external-system capability requirement;
- explicit WORK and APP projection requirements;
- one non-blocking assumption retained in provenance.

Assert source -> Work and source -> App semantic preservation field-by-field.

## Required verification

1. `node --test packages/operational-world-compiler/test/work-app-projection.test.ts`
2. relevant P0 Composer/operational-spec tests as exposed by repository test suite
3. P2-001..005 targeted tests
4. `pnpm typecheck`
5. `pnpm boundaries`
6. `pnpm test:all`

## Evidence to capture

- source spec/IR/projection IDs;
- field-level parity matrix;
- negative tests for dropped/added semantics;
- confirmation of no Work persistence side effect in compiler;
- commands/failures.

## Authority / external-effect constraints

Projection is computational. Durable Work instantiation, if tested through an adapter, must be an explicit separate authorized P1 operation and not occur merely because compilation returned `ready`. No external effects.

## Rollback / replay

Regenerate Work/App projections from source spec + projection/compiler versions. Never roll back by rewriting source operational history.

## Dependencies / unlocks

Depends on P2-001..005, P0 #7/#8 and explicit P1 #14 interface. Supplies two projections consumed by P2-008 full-path parity.