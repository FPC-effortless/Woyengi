# P0-005 Certification Boundary handoff

## Work mode
Product engineering.

## Task
- Issue #11 — P0-005 certification boundary
- Branch: `feat/p0-certification-boundary`
- PR #19
- Current base: `main`
- Accepted canonical P0 baseline: `f741067be35cbdbd57c2dc0fd08cf7e56d68be12`

## Outcome
The evaluation lane defines the explicit machine-readable boundary between Woyengi runtime/package certification and Veritas scientific/frontier qualification.

Woyengi may claim only evaluated-scope conformance, compatibility, replay/effect correctness, tested failure behavior, and package/runtime certification. Scientific qualification, frontier qualification, production readiness, semantic-commit authority, semantic effects, and external effects are fail-closed false. Veritas qualification artifacts are not accepted as Woyengi certification artifacts.

Owned implementation:
- `packages/evaluation/src/certification-boundary.ts`
- `packages/evaluation/test/certification-boundary.test.ts`
- `docs/evaluation-ownership.md`
- this handoff

No operational-spec, Composer, WorldBundle, Veritas, shared ADR, `prd.json`, or `progress.txt` file is changed by this lane.

## Governing decisions
ADR 0008 and the P0 integration specification keep Woyengi certification and Veritas scientific/frontier qualification independent. Evaluation success never grants semantic-commit authority or production readiness.

## Falsifiers
The targeted suite contains four falsifiers covering:
1. only the five evaluated-scope Woyengi claims are emitted;
2. scientific/frontier/production/semantic-authority claim smuggling is rejected;
3. a Veritas qualification artifact is rejected as Woyengi certification;
4. provenance or prior semantic-commit references cannot become authority/effects.

Earlier implementation verification was green on GitHub Actions run `33071772286`, including typecheck, boundaries, full tests, benchmark, architecture, security, and container smoke. A later integration run exposed then-unresolved operational-spec RED falsifiers outside this lane; those upstream contract blockers were subsequently resolved and P0-001 was accepted/merged to `main` at `f741067b...`.

## Current integration state
The P0-005 bytes have been reconstructed directly on the accepted P0 baseline and PR #19 now targets `main`. This handoff refresh is an intentional branch synchronization event so the repository's `pull_request -> main` CI executes against the final integration shape.

Do not infer GREEN until the new final-head workflow completes. If it passes, the lane is ready for independent review/human acceptance. If it fails, classify failures by ownership and change only lane-owned files for P0-005 defects.

## Authority/effect status
No semantic commit, scientific/frontier claim, production-readiness claim, semantic effect, external effect, release, or merge is authorized merely by this implementation or its tests.

## Exact next action
Run/inspect final PR CI on this head, then perform the four-axis code review against issue #11 and ADR 0008. Mark ready/merge only after automated gates are green and human/integrator acceptance is explicit.

## 2026-09-26 rebase verification (Termux control plane)

Branch `p0-005-certification-boundary` was created fresh off current `main` (`0392909`) and the four
lane-owned files were carried forward byte-identical from `feat/p0-certification-boundary` (`5c44b1a`),
with one review fix noted below. The stale 12-commit-behind base and the divergent
`feat/p0-operational-alignment` base of draft PR #19 are no longer in play.

Gates executed locally on this device (Node 26.3.1, no dependency installation):

| Gate | Command | Result |
| --- | --- | --- |
| Package boundaries | `node scripts/package-boundaries.mjs` | PASS (41 packages, acyclic) |
| Deep module | `node production/scripts/deep_module_enforce.js` | PASS |
| Node tests | `node --test` | 117 pass, 1 fail |
| Python tests | `node scripts/run-python-tests.mjs` | 1 pass, OK |

The single Node failure is `apps/woyengi/test/visual-qa.mjs`, which aborts with
`No Chromium-family browser was found`. It is environmental — no Chromium exists on this Termux
device — and is not a P0-005 defect; the same test passes in CI (see the `main` run, 114/114 green).
Baseline without this lane's test file is 114; with it the suite is 118 total and the 4 P0-005
falsifiers are included and green.

Test-file review fix: the smuggled-claim falsifier tuple literal is now annotated
`as const satisfies readonly [string, unknown][]` so `value` is not narrowed to the literal `true`,
which would otherwise fail `tsc` under `strict`.

Not executed locally, deliberately: `pnpm typecheck` (`tsc --noEmit`) and `pnpm benchmark`.
`typescript@5.9.3` is a devDependency and there is no `node_modules`; installing is not permitted
on this device. Static review covered the strict-tsconfig risks (`exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `rewriteRelativeImportExtensions`, `erasableSyntaxOnly`);
both files use `import type`, `.ts` relative imports, and no optional-property or unsafe-index patterns.
`tsc` must be confirmed by PR CI before merge.
