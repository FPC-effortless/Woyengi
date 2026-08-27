# P0-003 WorldBundle Conformance handoff

## Work mode
Product engineering with a cross-repository RL/evaluation portability seam.

## Task
- Issue #9 — WorldBundle public/private partition and conformance
- Branch: `feat/p0-worldbundle-conformance`
- PR #20
- Current base: `main`
- Accepted P0 contract baseline: `f741067be35cbdbd57c2dc0fd08cf7e56d68be12`

## Outcome
`packages/world-bundle` materializes `WorldBundle v0.1` as deterministic portable JSON with separate complete and public-only artifacts, content-bound member/artifact identities, fail-closed partition validation, source `OperationalSystemSpec` provenance, compatibility checks, tamper detection, and adversarial public/private leakage rejection.

The integration review exposed three real cross-repo semantic gaps in the first pin. They are fixed in the current artifact:

1. evaluator invariants are structured with executable assertion + explicit severity + scope;
2. hidden effects carry executable transitions rather than descriptive prose;
3. required `evidence:approval-decision` is materialized in the public partition and therefore can become an agent-visible Veritas `OperationalRecord`.

A second review found that arbitrary member payloads plus key-name scanning were insufficient as the complete conformance boundary. The package now adds exact semantic schemas for the important pinned public semantic-task/evidence and private evaluator-oracle member kinds. Missing/unknown fields fail closed, while structural public/private separation remains the confidentiality root.

## Ownership
Only `packages/world-bundle/**` plus this uniquely named handoff are changed. `packages/operational-spec/**` is consumed only through its public index and was not modified.

## Final cross-repository pin
Pinned fixture:
`packages/world-bundle/fixtures/veritas-adapter-v0.1.json`

Complete artifact identity:
`world-bundle-artifact:sha256:62b94e85103ef8522ef9eb87f1a6825b2e98fca36fbd57b5aadce06e0f5ab719`

Exact fixture-byte SHA-256:
`3577aa29266dac59921c31e65d22ad657c4b7a9191011e9f5448aed32781e10b`

Sidecar:
`packages/world-bundle/fixtures/veritas-adapter-v0.1.sha256`

These exact bytes are the required Veritas #69 integration artifact. A byte or semantic change requires deliberate repinning in both repositories.

## Falsifiers
Package tests cover deterministic serialization/identity, public-only stripping, manifest mismatch, tamper detection, compatibility, source provenance, adversarial leakage, exact fixture pinning, and semantic-schema failures including missing invariant severity and missing executable hidden transition.

## Verification state
Earlier package-local mirror verification was green. P0-001 is now accepted/merged and PR #20 targets `main`. The current branch has been synchronized after repinning so GitHub Actions can validate the actual final integration shape.

Do not infer final GREEN until the new PR head completes the repository ladder: typecheck, boundaries, full tests, benchmark, architecture/security gates, and container smoke.

## Cross-repo acceptance
Veritas must consume these exact bytes, preserve public action system/parameter/cost semantics, materialize public evidence, keep complete artifact identity/private hashes evaluator-side, and map structured target/invariant/effect semantics losslessly. Any unsupported mapping must fail closed; Veritas must not invent semantic defaults.

## Authority / claim status
WorldBundle conformance is not scientific qualification, frontier qualification, production readiness, semantic-commit authority, or authority to issue external effects.

## Exact next action
Inspect final PR #20 CI. In parallel, run Veritas #69 against the exact pin above. If both sides are green and parity/leakage/replay falsifiers pass, perform final four-axis review, update PR evidence, and mark ready/merge only with explicit integrator/human acceptance.