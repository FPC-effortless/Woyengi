# P0-002 App Projection handoff

## Work mode
Product engineering.

## Task
Issue #8 — Make `AppBlueprint` a projection of `OperationalSystemSpec`.

- Branch: `feat/p0-app-projection`
- PR #21
- Current base: `main`
- Accepted canonical P0 baseline: `f741067be35cbdbd57c2dc0fd08cf7e56d68be12`

## Outcome
Composer now implements the canonical path:

`ComprehensionModel -> OperationalSystemSpec -> Operational IR -> CompositionPlan -> AppBlueprint`

The legacy `IntentCompiler` remains available through a deterministic compatibility adapter. Composition preference ordering remains `do-nothing > reuse > configure > compose > adapt > extend > generate`.

`AppBlueprint` carries source-spec/version/IR provenance and full governed projection semantics. The integration review found one material defect in the earlier branch: canonical invariants were flattened to strings, dropping `severity`. That is fixed on the current branch by retaining complete `OperationalInvariantDefinition` values in `invariantDefinitions` while retaining the string list as compatibility presentation.

`validateAppBlueprintProjection` now verifies both the complete invariant definitions and the presentation projection. The regression falsifier mutates `CRITICAL` to `LOW` and requires fail-closed rejection, so governed invariant severity can no longer disappear or be widened silently.

## Ownership
Only:
- `packages/composer/**`
- this unique handoff

No `packages/operational-spec/**`, WorldBundle, evaluation, shared ADR/spec, `prd.json`, `progress.txt`, or Veritas file is modified by this lane.

## Verification history
Earlier focused evidence passed Composer behavior tests, strict source checking, and package-boundary checking. The exact root `pnpm` ladder could not be executed in the previous sandbox because the PR then targeted the integration branch rather than `main`.

P0-001 is now accepted on `main`; this branch was reconstructed on that accepted baseline and includes the invariant-severity repair plus its falsifier. PR #21 now targets `main`. This handoff refresh intentionally produces a new synchronize event so repository CI runs against the final integration shape.

Do not infer final GREEN until the new head has completed:
1. targeted Composer tests;
2. `pnpm typecheck`;
3. `pnpm boundaries`;
4. `pnpm test:all`;
5. normal repository benchmark/architecture/security/container gates invoked by CI.

## Review state
The implementation preserves legacy package-facing compatibility while canonical projections remain richer. No semantic/external effects execute during compilation; comprehension remains non-authoritative; authority is explicit; IR and projection are deterministic/rebuildable.

## Authority/effect status
No semantic commit, external operational effect, release, or merge is authorized by compilation success. Human/integrator acceptance remains separate from automated GREEN.

## Exact next action
Inspect final PR #21 CI on this head. If Composer causes a failure, modify only `packages/composer/**` and rerun from the failing rung. When green, perform final four-axis code review and mark ready/merge only with explicit human/integrator acceptance.