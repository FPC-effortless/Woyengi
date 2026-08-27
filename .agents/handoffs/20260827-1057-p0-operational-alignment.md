# P0 operational alignment handoff

Date: 2026-08-27
Work mode: Product engineering, with an RL-environment portability boundary for Veritas
Program: Woyengi #6
Active ticket: Woyengi #7 (P0-001)
Branch: `feat/p0-operational-alignment`
Draft PR: Woyengi #12
Cross-repo integration ticket: Veritas #67

## Outcome and current state

The ecosystem-alignment lifecycle has started under the repository operating contract. P0 is specified and dependency-ticketed. The first tracer bullet implements dependency-light operational contracts outside `packages/core`:

- `ComprehensionModel v0.1`;
- generalized `OutcomeContract v0.1`;
- `OperationalSystemSpec v0.1`;
- deterministic Operational IR compilation;
- `WorldBundle v0.1` with explicit `public` / `private-evaluator` partition metadata.

P0-001 is **implementation-present but verification-blocked**. It must not be called GREEN or complete yet.

## Decisions already made

See durable sources rather than reconstructing policy from chat:

- `docs/specs/p0-ecosystem-alignment.md` — complete P0–P7 program specification and acceptance model.
- `docs/adr/0007-operational-system-spec-and-projections.md` — `OperationalSystemSpec` is canonical above App/Work/Agent/API/World projections; `AppBlueprint` becomes a projection.
- `docs/adr/0008-woyengi-veritas-evaluation-boundary.md` — Woyengi/Veritas share a portable contract/artifact boundary, not a live database/runtime; Woyengi certification and Veritas scientific/frontier qualification remain distinct.
- `CONTEXT.md` — stable new vocabulary.

Existing WYG-025/026 `passes:false` flags remain untouched. Their implementation was previously integrated, but repository policy still requires human acceptance before those flags change.

## Branch / commits / PR

Initial P0 commits on `feat/p0-operational-alignment` include:

- `3396765add14a0bde512878825aabf34586725bb` — P0 ecosystem alignment specification.
- `668eb51dd8000f64cf3d54fcb631bcc3f1d81d12` — ADR 0007.
- `bfe05b9c0c388c1ac767195dbca7693bb50f5c44` — ADR 0008.
- `119b09d5a7e8a0780e49bb9c6a4ae6c01feb073d` — glossary update.
- `bb4a6fe5bfd0c729406686b6bcb85992de7db97b` — public-behavior test added before implementation.
- `e29c8fe3173782e728b17107e2552774262394f2` — initial operational-contract implementation.
- `d5e0e0047c7b6c143c1b430f9890e13787eed2c6` — strict literal-discriminant test correction.
- `00ed2494852827bce8c9db44c1db6fb097dc6919` — `noUncheckedIndexedAccess` test correction.

Draft PR: #12 `P0-001: canonical operational contracts v0.1`.

## Tests / falsifier / commands actually run

RED seam was established by committing `packages/operational-spec/test/contracts.test.ts` before `packages/operational-spec/src/index.ts` existed. The tests cover deterministic normalization, immutability, confidence validation, dangling capability references, duplicate IDs, temporal validation, IR traceability, and WorldBundle partition structure.

No repository command can truthfully be recorded as passing in this session. Three PR-triggered GitHub Actions runs were created, but GitHub failed both jobs before assigning a runner or instantiating any steps. The latest run for head `00ed2494852827bce8c9db44c1db6fb097dc6919` is `33064967439`; both `Quality and conformance` and `Container smoke test` report `steps: []` and `runner_id: 0`.

Therefore the following have **not executed** on the P0 branch and must not be reported as passed:

- checkout/toolchain setup;
- `pnpm typecheck`;
- `pnpm boundaries`;
- `pnpm test:all`;
- `pnpm benchmark`;
- architecture/security production gates;
- Docker smoke.

CI infrastructure blocker: Woyengi #13.

## Evidence and failures

Evidence:

- PR #12 contains the spec, ADRs, glossary, tests, and new package.
- Woyengi #7–#11 encode dependency-aware P0 tracer bullets.
- Veritas #67 records the adapter counterpart without prematurely modifying Veritas.
- CI run metadata proves the current verification failure is pre-runner/pre-step rather than a command-level TypeScript/test failure.

Failures / corrections:

- Static review caught widened test discriminants for `OperationalResource.kind` and `OperationalProjectionRequirement.projectionKind`; corrected with literal assertions.
- Static review caught `noUncheckedIndexedAccess` on `base.capabilities[0]`; corrected with explicit non-null assertions in the test fixture.
- GitHub Actions currently provides no executable command evidence.

## Authority / external-effect status

This work defines contracts and repository artifacts only. It does not alter user operational state, authorize an accepted Woyengi SemanticCommit, run provider actions, or issue external operational effects. GitHub repository writes are the requested development effects and are represented by the branch/PR/issues above.

## Unresolved risks

1. CI runner/job instantiation must be repaired or an equivalent executable clean-checkout verification surface must be used before P0-001 is called GREEN.
2. `Operational IR` currently derives a deterministic ID from source spec ID/version and compiler version rather than the full normalized source content. Same-ID/same-version conflicting content is expected to be prevented at a higher version/registry boundary, but this should be independently reviewed before cross-language portability hardens.
3. P0-001 WorldBundle leakage checks are intentionally structural/minimal; exhaustive private-byte/locator leakage belongs to P0-003 (#9).
4. Provider-neutrality is represented structurally (`providerNeutral: true` and provider-free contract fields); semantic detection of provider-specific text is not a reliable contract-layer policy and is not currently implemented.
5. Portable JSON Schema / cross-language source-of-truth format remains deliberately reversible until P0-003/P0-004 establish the cross-repo fixture seam.

## Exact recommended next action

1. Use `diagnosing-bugs` on Woyengi #13 until a CI run reaches real workflow steps.
2. Run the verification ladder for #7: targeted contract tests -> `pnpm typecheck` -> `pnpm boundaries` -> `pnpm test:all`; add benchmark only if review determines state/reconstruction semantics are affected.
3. Use `code-review` across standards, #7/spec, constitutional invariants, and executable evidence.
4. Keep PR #12 draft until those checks exist. Do not merge or close #7 merely from static inspection.
5. Once #7 is verified and human acceptance is explicit, proceed to #8 (AppBlueprint projection migration), then #9, #10/Veritas #67, and #11.
