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
Run/inspect final PR #19 CI on this head, then perform the four-axis code review against issue #11 and ADR 0008. Mark ready/merge only after automated gates are green and human/integrator acceptance is explicit.