# P2-007 — OperationalSystemSpec/IR to portable WorldBundle projection tracer

Parent: #17
Spec: `docs/specs/p2-operational-world-compiler.md`
Depends on: P2-001..005, P0 #7/#9
Mode: product engineering + portability/conformance

## Outcome / Outcome Contract

Project one validation-eligible `OperationalSystemSpec`/IR into a deterministic P0-conformant `WorldBundle` without importing Veritas. Preserve objective/roles, actions/capabilities, constraints/budgets, evidence/outcome requirements, identifiers/artifacts and source provenance while failing closed on any public/private evaluator leakage.

Produce one package-local language-neutral golden fixture for P2 E2E tests; Veritas remains a downstream consumer through its separate adapter.

## Global blockers

- P0 accepted, especially #7 and #9 deterministic WorldBundle builder/conformance seam.
- P1 #14/#15 public interfaces explicit as required by #17.
- P2-001..005 landed.

## Future exclusive file ownership

Only:

- `packages/operational-world-compiler/src/projections/world.ts`
- `packages/operational-world-compiler/test/world-projection.test.ts`
- `packages/operational-world-compiler/test/fixtures/projections/world/**`

Do not edit `packages/world-bundle/**`, root `fixtures/world-bundle/**`, Veritas, P0 operational-spec, or other P2 files.

## Inputs

- P0-valid source spec and Operational IR;
- compiler provenance/validation report;
- injected `WorldBundleProjectionPort` implemented against P0 #9 public API;
- explicitly authorized private-evaluator source refs only when requested and permitted.

## Outputs

- deterministic `WorldBundle v0.1`;
- source spec/version/compiler provenance;
- conformance result;
- public/private partition parity/leakage report;
- package-local pinned serialized fixture + digest used only by P2 tests.

## Required semantic mapping

At minimum preserve when represented by source spec:

- objective/goals;
- actor roles;
- action/tool/capability surface;
- constraints and budgets exposed by outcome contracts;
- evidence/verification requirements;
- target assertion/invariant references in the authorized evaluator-private partition only where P0 permits;
- artifact/resource descriptors and identifiers;
- source spec/provenance/compatibility metadata.

The public artifact cannot contain or resolve target answers, hidden action effects, private assertion values, private evidence locators or retrievable private bytes.

## Required behavior

1. World projection consumes P0 public contracts only.
2. Equivalent normalized spec/IR produces equivalent WorldBundle serialization/identity under #9 semantics.
3. Public/private membership is explicit and complete.
4. Any proposed private member in public payload emits `PRIVATE_PARTITION_LEAK` and no ready world projection.
5. Private-evaluator input is opt-in and authority-gated; absence of private material still permits a public-only bundle when semantically valid.
6. World action surface cannot widen capabilities beyond source spec.
7. World projection cannot weaken outcome/invariant/authority constraints merely to make an executable task.
8. No Veritas runtime/type/import is required to create or validate the artifact.

## Consumer boundary

Veritas #67 is the downstream standalone adapter. P2 may use its required parity dimensions as test assertions, but must not depend on its files/classes. `WorldBundle` is the only cross-repo operational-world artifact boundary.

## Explicit non-goals

- No `OperationalEpisode`/`HiddenOracle` construction.
- No Veritas scientific/frontier qualification.
- No HUD/Prime packaging.
- No private oracle synthesis.
- No P0 WorldBundle schema/conformance edits.

## RED / falsifiers

1. Public bundle contains target answer or hidden effect.
2. Public locator can retrieve private evaluator bytes.
3. World action surface includes capability absent from source spec.
4. Required invariant/authority constraint disappears in projection.
5. Equivalent input serializes differently.
6. Missing/duplicate partition member passes.
7. World projection imports Veritas.
8. Compiler generates private evaluator truth solely because the public world would otherwise be incomplete.

## Required fixture cases

- public-only world;
- authorized public + private-evaluator world;
- hidden target leak attempt;
- private locator leak attempt;
- capability widening attempt;
- missing partition manifest member;
- equivalent-order deterministic pair.

## Required verification

1. `node --test packages/operational-world-compiler/test/world-projection.test.ts`
2. P0 #9 targeted conformance tests through normal repository test invocation
3. P2-001..005 targeted tests
4. `pnpm typecheck`
5. `pnpm boundaries`
6. `pnpm test:all`

Do not run Veritas tests from this coding ticket; cross-repo parity belongs to the Veritas adapter lane/integration verification.

## Evidence to capture

- pinned P2 fixture digest;
- source-spec -> bundle semantic parity matrix;
- negative leakage fixtures and exact diagnostic codes;
- zero private leakage count;
- deterministic serialization assertion;
- commands/failures.

## Authority / external-effect constraints

World compilation is an artifact/projection computation. Private-evaluator material requires explicit authorized input. No actions in the world are executed; no semantic/external effect is issued.

## Rollback / replay

Regenerate WorldBundle from source spec/IR and the versioned projection/conformance semantics. Never rewrite source evidence or evaluator-private truth during rollback.

## Dependencies / unlocks

Depends on P2-001..005 and P0 #7/#9. Supplies WORLD projection and fixture to P2-008; downstream Veritas adapter consumes canonical P0/P2-produced WorldBundle independently.