# P2-009 — Structural world diversity fingerprints and OOD claim boundary

Issue: #17  
Status: planning-only amendment  
Depends on: P2-003 inference, P2-004 constrained synthesis, P2-005 consistency/realism validation; informs P2-008 E2E acceptance.

## Problem

ProjectWorld review exposed a benchmark/realism failure mode that also applies to a general Operational World Compiler:

```text
same operational graph
+ different scalar parameters
!= structurally different world
```

Changing cost, duration, counts, seeds, labels, or disruption magnitudes does not by itself create a new operational topology or structural OOD case.

P2 must therefore distinguish structural variation from parameter variation during generation, validation, provenance, and downstream reporting.

## Required compiler outputs

For every compiled candidate world/spec, validation must derive two independent deterministic fingerprints from normalized compiler outputs:

```ts
export interface WorldDiversityFingerprint {
  readonly structuralFingerprint: string;
  readonly parameterFingerprint: string;
  readonly structuralDimensions: readonly string[];
  readonly parameterDimensions: readonly string[];
}
```

The exact representation may change, but the semantic split is mandatory.

### Structural fingerprint

Bind only to operational topology/grammar, including where applicable:

- entity and relationship type topology;
- actor/role/stakeholder topology;
- authority/delegation/approval graph;
- procedure/workflow graph and branch structure;
- capability/tool/system topology;
- requirement/invariant/outcome-contract dependency graph;
- resource dependency/network shape;
- causal dependency graph;
- lifecycle/state-machine topology;
- external-system binding classes;
- evidence-flow topology;
- disturbance/recovery action topology.

IDs that are mere instance labels must be normalized away when they do not change structure.

### Parameter fingerprint

Bind to values within an already selected topology, including:

- quantities/counts that do not alter graph structure;
- prices/costs/budgets;
- durations/deadlines;
- capacities;
- numeric thresholds;
- sampled probabilities;
- seed-derived scalar values;
- instance labels/identities that do not change semantics.

If a count change creates/removes nodes/edges or alters topology, that contribution belongs in the structural fingerprint as well.

## Claim rule

A compiler, fixture generator, Collection, WorldBundle producer, or downstream benchmark must not label two candidates as **structural OOD**, **new world grammar**, or equivalent merely because `parameterFingerprint` differs.

Minimum classification:

```text
same structuralFingerprint + different parameterFingerprint
    = parametric variant

different structuralFingerprint
    = structural variant candidate
```

Whether a structural variant is scientifically useful OOD remains a Veritas qualification question, not a Woyengi compiler claim.

## Grammar-level generation requirement

Constrained synthesis and domain compilers must be capable of changing topology when evidence/domain grammar requires it. For example, future construction compilation should allow hospital/data-center/laboratory worlds to compile different stakeholder, approval, resource, systems, commissioning, and dependency structures rather than the same 12-package graph with multipliers.

This is not a requirement to hard-code construction concepts into the P2 kernel. Domain grammar extensions remain provider/domain packages feeding domain-neutral compiler ports.

## Provenance

Both fingerprints must be content-derived from normalized stage outputs and recorded with the validation report. The report must identify which normalized dimensions contributed to each fingerprint so an implementation can explain why two worlds are structurally equal/different without exposing evaluator-private truth.

## Falsifiers

1. Same graph with only cost/duration/seed changes yields different `structuralFingerprint` → FAIL.
2. Added approval gate/dependency/system/role changes topology but structural fingerprint stays identical → FAIL.
3. Generator labels a scalar-only holdout `structural OOD` → FAIL.
4. Instance IDs renamed with topology unchanged alter structural fingerprint → FAIL.
5. Validation collapses both fingerprints into one generic hash so structural/parameter cause cannot be distinguished → FAIL.
6. Woyengi claims agent-discrimination/frontier usefulness solely from structural difference → FAIL; that belongs to Veritas.

## Future ownership

Implementation should live in P2 compiler/validation-owned files assigned by P2-005/P2-008 or a dedicated future validation module; it must not modify `packages/operational-spec/**` to encode benchmark-specific diversity semantics.

## Verification

P2 E2E acceptance must include at least:
- two parameter variants with identical structural fingerprint;
- two genuine topology variants with different structural fingerprints;
- deterministic fingerprints under replay/reordered equivalent input;
- explicit validation/report classification for each pair.