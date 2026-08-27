# P0 Operational Contract Freeze

Status: verified freeze candidate; awaiting human acceptance
Date: 2026-08-27
Normative branch: `feat/p0-operational-alignment`
Verified head: `8c4b8dcba124aeb8dfa68515fb3d76f5f875c584`
Program: #6
Contract ticket: #7

## Purpose

P0 satellite agents need one stable contract owner. This document freezes the public P0-001 seam for parallel implementation while preserving one integration authority for schema changes.

The normative implementation is `packages/operational-spec/src/index.ts`. Satellite lanes consume that public index read-only. They must not copy, fork, or redefine these semantics in their own packages.

## Frozen contracts

The following contract identities are the P0 v0.1 public seam:

- `woyengi.comprehension-model.v0.1`
- `woyengi.outcome-contract.v0.1`
- `woyengi.operational-system-spec.v0.1`
- `woyengi.operational-ir.v0.1`
- `woyengi.world-bundle.v0.1`

`WorldBundle.version` is exactly `0.1.0` in the P0 seam.

## Frozen semantic rules

1. IDs are namespace-qualified and validated fail-closed.
2. Semantic versions use `major.minor.patch`.
3. Equivalent unordered input collections normalize deterministically.
4. Procedure step order remains meaningful and is not sorted away.
5. Contract outputs are recursively immutable.
6. `providerNeutral` declarations must be literally `true` at runtime; false/missing decoded declarations are not silently upgraded.
7. Operational IR identity is content-bound to the normalized source `OperationalSystemSpec` and compiler version, not merely nominal source ID/version.
8. `ComprehensionModel` preserves assumptions, unknowns, conflicts, evidence and provenance as distinct structures.
9. `OperationalSystemSpec` is a versioned operational definition, not mutable current state and not an authority grant.
10. `OutcomeContract` does not itself authorize execution or semantic commit.
11. Woyengi `public` and `private-evaluator` world partitions are semantically distinct. Public material must never provide a path for resolving evaluator-private bytes.
12. Veritas evaluator truth is not ordinary Woyengi governing state.

## Frozen enum sets

### Operational requirement kinds

`STATE`, `ACTIVITY`, `AUTHORITY`, `CAPABILITY`, `INTEGRATION`, `COLLABORATION`, `RUNTIME`, `VERIFICATION`, `CONSTRAINT`.

### Outcome effect classes

`RUNTIME`, `SEMANTIC`, `EXTERNAL`.

### Outcome effect policies

`ALLOW`, `FORBID`, `REQUIRE_RECONCILIATION`.

### Projection kinds

`APP`, `WORK`, `AGENT`, `API`, `WORLD`.

### World action kinds

`READ`, `WRITE`, `EXECUTE`, `COMMUNICATE`, `ESCALATE`, `SUBMIT`.

### World partitions

`public`, `private-evaluator`.

## Parallel-agent change protocol

Only the P0 integration lane may edit `packages/operational-spec/**` or change the frozen contract shape.

If a satellite lane discovers a missing field or semantic ambiguity:

1. stop before editing the contract;
2. file/comment the exact minimum interface request on its issue and #7;
3. include the failing use case/falsifier;
4. state whether the request is required for correctness or only convenience;
5. continue work that does not depend on that change.

The integrator classifies the request as:

- **clarification** — no schema change;
- **adapter concern** — solve outside the canonical contract;
- **compatible P0 patch** — integrator changes the contract, adds falsifier/regression coverage, reruns full P0 gates, then coordinates branch rebases;
- **post-v0.1 extension** — defer rather than destabilize P0.

No satellite lane may introduce a second `OperationalSystemSpec`, `OutcomeContract`, `OperationalIR`, or `WorldBundle` definition.

## Compatibility policy during P0

Until P0 acceptance, even additive optional fields are integration-controlled because they can affect cross-language normalization and content identity.

After P0 v0.1 acceptance:

- removals, renames, changed meanings, changed requiredness, or changed enum values require a contract-version change;
- additive fields require explicit default/normalization semantics and cross-language fixture coverage;
- a compatible runtime may reject a bundle it cannot safely interpret; it must not silently widen semantics;
- content-derived identifiers must be reproducible from the language-neutral normalized representation selected by P0-003.

## Verification evidence

At verified head `8c4b8dcba124aeb8dfa68515fb3d76f5f875c584`, GitHub Actions run `33068180184` passed:

- TypeScript typecheck;
- package/deep-module boundaries;
- Node and Python tests;
- adversarial benchmark;
- architecture gate;
- security gate;
- container build;
- API readiness smoke.

This automated GREEN status does not constitute human acceptance, release readiness, or authority to modify user operational state.
