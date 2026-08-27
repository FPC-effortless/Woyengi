# ADR 0008: Woyengi/Veritas operational-world and evaluation boundary

Status: Accepted for implementation
Date: 2026-08-27

## Context

Woyengi and Veritas both manipulate persistent operational structures, but they have different truth and deployment requirements. Woyengi owns durable operational meaning for real human/agent work. Veritas owns deterministic evaluation/training worlds, private evaluator truth, scientific benchmark qualification, capability measurement, and standalone distribution.

Sharing a live database/runtime would couple benchmark execution to Woyengi services and risk private-oracle leakage. Keeping entirely independent schemas would create semantic drift and duplicate operational meaning.

## Decision

The systems share a **portable contract/artifact boundary**, not a live state store.

Woyengi owns:

- canonical persistent state semantics;
- `ComprehensionModel`, `OperationalSystemSpec`, Operational IR, and generalized `OutcomeContract` definitions;
- projection/world compilation from authorized operational specifications;
- runtime/package conformance and certification;
- effect classification, reconciliation, replay safety, compatibility, and accepted operational outcomes.

Veritas owns:

- deterministic evaluation runtime and reset semantics;
- public task/public observation surfaces for evaluated policies;
- private evaluator oracle/hidden target state;
- benchmark qualification and frontier qualification;
- model/harness/intervention comparisons;
- longitudinal capability observatory;
- training-value experiments and verified trajectory/curriculum products;
- evaluator secrecy, contamination/leakage controls, and marketplace portability.

The integration path is:

```text
Woyengi persistent state / evidence
-> OperationalSystemSpec
-> WorldBundle public partition
   + optional evaluator-private source material under explicit authority
-> Veritas adapter
-> OperationalEpisode / native artifact runtime
-> Veritas-private HiddenOracle extension
-> scientific/frontier qualification and capability evaluation
```

Veritas must remain runnable without a Woyengi server. The adapter may be implemented in Veritas, but it consumes a versioned language-neutral Woyengi contract and must prove semantic parity.

## Public/private rule

A WorldBundle partition manifest must identify every member as `public` or `private-evaluator`. Public artifacts cannot contain target answers, hidden action effects, private assertion values, private evidence locators, or a retrievable locator that exposes private bytes. Private evaluator material is never treated as ordinary agent-visible Woyengi state.

## Evaluation terminology

- **Woyengi certification/conformance** answers whether a package/runtime behavior satisfies Woyengi contracts for the evaluated scope.
- **Veritas scientific qualification** answers whether an evaluation environment supports scientifically credible measurement under its qualification protocol.
- **Veritas frontier qualification** answers whether an environment is useful for differentiating/improving current strong/frontier agents.

Passing one category never implies passing another.

## Consequences

- Woyengi's `packages/evaluation` remains runtime/package evaluation and should avoid claims that imply scientific benchmark qualification.
- Veritas does not replace Woyengi's bitemporal/evidence/authority substrate with its evaluator dictionary state.
- Cross-repo parity tests must cover objective, action/tool surface, constraints, evidence requirements, identifiers, target assertions/invariants, and partition secrecy.
- Private-oracle construction remains evaluator-specific even when the public operational world originated in Woyengi.
