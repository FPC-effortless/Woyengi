# P2-005 — Consistency/realism validation and adversarial compiler benchmark

Parent: #17
Spec: `docs/specs/p2-operational-world-compiler.md`
Depends on: P2-001..004
Mode: product engineering + RL-style falsification

## Outcome / Outcome Contract

Create a fail-closed validation stage and package-local adversarial benchmark that distinguishes structurally valid/realistic operational candidates from candidates with dangling references, authority gaps, unsupported causality, contradictory procedure semantics, provider leakage, false synthesis completeness or public/private leakage risk.

A clean pinned fixture must pass; every intentionally corrupted fixture must fail for the expected reason. The benchmark reports dimensions/diagnostics rather than an opaque universal realism score.

## Global blockers

- P0 accepted.
- P1 #14/#15 public interfaces explicit.
- P2-001..004 landed.

## Future exclusive file ownership

Only:

- `packages/operational-world-compiler/src/stages/validation.ts`
- `packages/operational-world-compiler/src/benchmark.ts`
- `packages/operational-world-compiler/test/validation-benchmark.test.ts`
- `packages/operational-world-compiler/test/fixtures/adversarial/**`

Do not edit P0/P1 packages, Veritas, root benchmark code, other P2 stage/projection files, `prd.json` or `progress.txt`.

## Inputs

- reconstructed evidence payload;
- inference proposals;
- synthesis assumptions/unknowns/conflicts;
- candidate comprehension/operational structures;
- injected `VerificationPort` for applicable Woyengi schema/source/temporal/authority/consistency/domain checks;
- optional WorldBundle candidate metadata only when supplied by later integration tests.

## Outputs

- deterministic `CompilerVerificationResult`;
- normalized blocking/non-blocking diagnostics;
- per-dimension benchmark report;
- fixture-level expected/actual failure codes;
- `ready-eligible | needs-review | blocked` gate outcome consumed by final assembly.

## Required validation rules

At minimum:

1. schema/reference integrity;
2. provider-neutral requirement/capability/binding fields;
3. provenance/evidence coverage for model/synthesis proposals;
4. valid/transaction-time reference consistency;
5. unresolved identity/authority blockers;
6. procedure capability/action coverage;
7. outcome/invariant/verification coverage;
8. contradictory required/forbidden operation detection;
9. unsupported causal relation and causal-cycle detection;
10. generated assumption cannot masquerade as verified state;
11. external binding/resource requirements cannot be presented as available without evidence;
12. source outcome/authority semantics may not be weakened by a projection candidate;
13. when world metadata is present, public/private partition violations block.

## Realism/adversarial dimensions

Local fixture dimensions, conceptually informed by Veritas Foundry but with no Veritas import:

- entity count;
- action/tool count;
- procedure step count;
- distractor count;
- missing-evidence rate;
- conflict rate;
- dependency depth;
- budget pressure;
- declared failure/stochastic pressure;
- adversarial source pressure.

Keep hidden fixture truth outside compiler-visible input.

## Required benchmark metrics

- required semantic-field recall;
- unsupported assertion rate;
- provenance/evidence coverage;
- conflict-retention recall;
- authority-confidence conflation count (gate = 0);
- deterministic replay mismatches (gate = 0);
- private leakage count when exercised (gate = 0);
- expected blocker-code accuracy;
- later projection parity violations (gate = 0 once projection tickets land).

Do not label this benchmark scientific/frontier qualification.

## Public seam changed

Implements the P2 validation stage protocol and exports package-local benchmark runner functions. No shared/root benchmark registration is required in this ticket.

## Required behavior

1. Missing verifier for a required strategy fails/inconclusive according to existing verification semantics; it never silently passes.
2. Validation preserves diagnostic subject/evidence refs.
3. Equivalent normalized candidate order yields identical diagnostics/report ordering.
4. One blocking rule is sufficient to block readiness.
5. Adversarial fixtures are pinned and deterministic.
6. Hidden fixture truth is only used by test assertions, never passed into compilation/provider inputs.
7. Realism failures report the violated property and evidence, not a scalar-only score.

## RED / falsifiers

Required corrupted fixtures:

- dangling procedure/capability/outcome ref;
- high-confidence source attempting to override authority;
- required and forbidden same consequential action;
- unsupported/cyclic causality;
- provider/model/database name inserted into provider-neutral requirement;
- synthesized assumption marked verified;
- missing evidence treated as complete;
- malicious source text attempting policy bypass;
- public-world candidate containing private target/evidence locator;
- equivalent-order fixture producing different deterministic diagnostics.

Each fixture must assert its expected diagnostic code.

## Explicit non-goals

- No Veritas qualification or Veritas imports.
- No external-world execution to establish realism unless a future governed validation port is explicitly supplied.
- No mutation/fixing of invalid candidates in the validator.
- No final projections.

## Required verification

1. `node --test packages/operational-world-compiler/test/validation-benchmark.test.ts`
2. run package-local benchmark entrypoint directly with Node and assert exit/nonzero policy for failing corruption set as designed;
3. P2-001..004 targeted tests;
4. `pnpm typecheck`;
5. `pnpm boundaries`;
6. `pnpm test:all`.

If a future repository benchmark hook is desired, create a separate integration request; do not edit root benchmark files from this ticket without ownership.

## Evidence to capture

- fixture manifest and hidden/visible partition description;
- expected diagnostic code per adversarial fixture;
- benchmark metric output;
- zero authority-conflation/replay/private-leak counts;
- exact commands/failures.

## Authority / external-effect constraints

Validation can reject/inconclusive/allow readiness eligibility only. It does not authorize a semantic commit or an external action. Any future executable probe must go through #15's governed execution port and remain a separate explicit effect.

## Rollback / replay

Pinned fixtures and captured provider proposals must reproduce benchmark results. Validator changes are versioned with compiler semantics; rollback means replay under the previous compiler version.

## Dependencies / unlocks

Depends on P2-001..004. A passing validation seam unlocks deterministic P0 assembly/projection tickets P2-006 and P2-007.