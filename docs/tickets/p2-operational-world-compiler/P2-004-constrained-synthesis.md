# P2-004 — Constrained synthesis and fail-closed assumption policy

Parent: #17
Spec: `docs/specs/p2-operational-world-compiler.md`
Depends on: P2-001, P2-002, P2-003
Mode: product engineering with adversarial policy tests

## Outcome / Outcome Contract

Implement a versioned synthesis gate that can propose narrowly bounded structural gap-fill only when the proposal has a defensible evidence basis, and that converts every accepted generated proposal into explicit assumption/provenance state. Missing evidence or forbidden semantic categories must remain unknown/blocking rather than being invented for completeness.

## Global blockers

- P0 accepted.
- P1 #14/#15 public interfaces explicit.
- P2-001..003 landed.

## Future exclusive file ownership

Only:

- `packages/operational-world-compiler/src/stages/synthesis.ts`
- `packages/operational-world-compiler/test/synthesis.test.ts`
- `packages/operational-world-compiler/test/fixtures/synthesis/**`

No P0 contract edits, provider SDKs, authority/identity writes, or changes to other P2 files.

## Inputs

- explicit gap/unknown list from prior stages;
- reconstructed evidence/provenance refs;
- accepted constraints/invariants/authority requirements;
- versioned `synthesisPolicyId`;
- injected `SynthesisPort` proposal payload.

## Outputs

- accepted provisional synthesis proposals with evidence/provenance;
- `ComprehensionAssumption`-compatible records for accepted proposals;
- retained unknowns for unsupported gaps;
- `SYNTHESIS_FORBIDDEN` / `SYNTHESIS_UNSUPPORTED` diagnostics;
- policy/proposal trace suitable for deterministic replay.

## Required synthesis policy

Permitted categories are narrow, non-authoritative structural proposals such as labels, non-consequential organization, or strongly evidence-implied ordering/dependency candidates.

Forbidden categories include:

- authority or permission grants;
- principal membership or identity merge/split;
- credentials/secrets;
- external binding/tool availability claimed as fact;
- legal/regulatory/compliance truth without authoritative evidence;
- fabricated evidence or verification outcomes;
- private evaluator targets, hidden effects or private evidence locators;
- irreversible/destructive action requirements introduced only to close a workflow gap;
- lifecycle/verification promotion based on model confidence.

Every accepted proposal must have a non-empty defensible evidence/basis link and compiler/provider provenance. Otherwise it remains an unknown.

## Public seam changed

Implements the P2-001 stage protocol and `SynthesisPort`; maps accepted generated assumptions into the existing P0 comprehension assumption shape without changing P0.

## Required behavior

1. Policy evaluation occurs deterministically before accepting provider output.
2. Provider confidence is recorded but never changes authority/lifecycle.
3. An accepted synthesis proposal is represented as an assumption, not an observed/verified fact.
4. Missing evidence fails closed.
5. Blocking unknowns remain blocking when synthesis is refused.
6. Equivalent captured proposals and policy version replay identically.
7. The policy ID/version is visible in provenance/trace.
8. Prompt-injected requests to relax policy cannot change deterministic forbidden categories.

## Explicit non-goals

- No broad autonomous world generation.
- No evidence invention.
- No authority/identity mutation.
- No final validation/spec assembly.
- No projection or execution.

## RED / falsifiers

1. No-evidence gap is filled merely because a provider returns a plausible answer.
2. Provider proposes `grant admin` and the proposal reaches the candidate operational model.
3. Synthesized external credential/binding availability becomes a fact.
4. Generated content is marked verified/authoritative because confidence is high.
5. Hidden evaluator target/effect can be synthesized from a public-world gap.
6. Prompt injection embedded in evidence changes the forbidden-category policy.
7. Replaying the same captured proposal under the same policy produces different acceptance/diagnostics.

## Required fixture cases

- permitted neutral label;
- evidence-implied non-consequential ordering;
- unsupported missing step;
- authority grant attempt;
- credential/binding fabrication attempt;
- legal/compliance fabrication attempt;
- private oracle fabrication attempt;
- destructive action gap-fill attempt;
- source prompt injection attempting policy override.

## Required verification

1. `node --test packages/operational-world-compiler/test/synthesis.test.ts`
2. P2-001..003 targeted tests
3. `pnpm typecheck`
4. `pnpm boundaries`
5. `pnpm test:all`

## Evidence to capture

- accepted assumption with evidence/provenance example;
- unsupported-gap retained-unknown example;
- all forbidden-category RED tests;
- replay determinism assertion;
- commands/failures.

## Authority / external-effect constraints

Synthesis is proposal-only. It cannot grant authority, merge identities, commit semantic state, instantiate Work, execute procedures or issue external effects.

## Rollback / replay

Synthesis decisions are reproducible from the gap input, captured proposal payload and policy version. Rollback means replaying with a prior policy/compiler version; never delete or rewrite source evidence.

## Dependencies / unlocks

Depends on P2-001..003. P2-005 consumes accepted assumptions, retained unknowns and synthesis diagnostics.