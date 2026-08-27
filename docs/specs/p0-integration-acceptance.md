# P0 Parallel Integration and Acceptance Protocol

Status: active integration protocol
Date: 2026-08-27
Parent: #6
Integrator branch: `feat/p0-operational-alignment`

## Goal

Complete P0 quickly with parallel agents without allowing parallel implementation to create parallel semantics.

The integration lane owns the canonical contract seam and final P0 reconciliation. Satellite lanes own disjoint implementations behind that seam.

## Lanes

| Lane | Issue | Branch | Exclusive implementation ownership |
|---|---:|---|---|
| P0 integration/contracts | #7 | `feat/p0-operational-alignment` | `packages/operational-spec/**`, shared P0 integration docs/ADRs, final reconciliation |
| App projection | #8 | `feat/p0-app-projection` | `packages/composer/**` |
| WorldBundle conformance | #9 | `feat/p0-worldbundle-conformance` | `packages/world-bundle/**` and its fixtures |
| Certification boundary | #11 | `feat/p0-certification-boundary` | `packages/evaluation/**` and dedicated ownership doc |
| Veritas adapter | Veritas #67 | `feat/woyengi-worldbundle-adapter` | Veritas `integrations/woyengi/**`, matching tests/docs only |

Planning-only P1/P2 lanes do not participate in the P0 code merge graph.

## Contract ownership

`docs/specs/p0-contract-freeze.md` is the governing freeze policy.

Satellite lanes must never edit or redefine the canonical P0 contract. Interface requests go to the integrator with a falsifier. The integrator decides whether the request is clarification, adapter concern, a compatible P0 patch, or a post-v0.1 extension.

A schema patch after the freeze candidate requires:

1. a failing regression/falsifier in `packages/operational-spec/test/**`;
2. the minimum contract change;
3. deterministic normalization/identity review;
4. full P0 integration CI;
5. explicit notice to every affected lane;
6. coordinated rebase only after the integrator publishes the new verified contract head.

## Merge topology

Before P0-001 is accepted, Woyengi satellite PRs target `feat/p0-operational-alignment`.

After P0-001 is human-accepted and merged to `main`:

1. rebase/retarget each satellite branch onto the accepted `main`;
2. rerun its own complete verification ladder;
3. merge file-disjoint Woyengi lanes independently if green;
4. do not require #8, #9 and #11 to be merged in a specific order unless an explicit dependency is discovered;
5. #9 must publish the final pinned WorldBundle fixture/hash before Veritas #67 can claim final parity;
6. Veritas #67 remains a separate repository PR and never becomes a Woyengi runtime dependency.

## Lane acceptance gates

### #7 — canonical contracts

Required:
- public falsifier-first contract tests;
- deterministic normalization and immutable values;
- fail-closed provider-neutral declarations;
- content-bound Operational IR identity;
- full Woyengi CI/gates;
- independent code review;
- human acceptance separate from automated green.

### #8 — AppBlueprint projection

Required:
- source `OperationalSystemSpec` and IR provenance survives projection;
- reuse/configure/compose/adapt/extend/generate ordering is unchanged;
- App projection cannot add/drop/widen goals, authority, outcome or verification semantics;
- compatibility path for existing intent/App consumers;
- targeted Composer tests and full required repo gates.

### #9 — WorldBundle conformance

Required:
- language-neutral normalized artifact;
- deterministic serialization/content identity;
- exhaustive fail-closed public/private partition validation;
- adversarial leakage fixtures;
- no public path to private evaluator bytes;
- source OperationalSystemSpec provenance and compatibility metadata;
- one pinned fixture + content hash for cross-repo parity.

### #11 — certification boundary

Required:
- Woyengi evaluated-scope certification cannot claim scientific/frontier qualification or production readiness;
- evaluation success alone cannot authorize semantic commit;
- distinct artifact/claim identity from Veritas qualification;
- falsifier tests and ownership documentation.

### Woyengi #10 / Veritas #67 — cross-repo parity

Governing mapping: `docs/specs/p0-woyengi-veritas-parity.md`.

Required:
- Veritas consumes the exact #9 pinned fixture/hash;
- no Woyengi service dependency;
- deterministic adaptation and replay;
- semantic parity for identity/objective/role/actions/constraints/budgets/evidence/artifacts/targets/invariants;
- evaluator-private information absent from `OperationalEpisode.public_payload()`;
- Veritas relevant tests/gates pass;
- Woyengi conformance evidence for the same fixture passes.

## Integration falsifiers

P0 cannot be accepted if any of the following is true:

1. more than one lane defines the same canonical contract;
2. a satellite PR requires an unreviewed deep import into another lane;
3. AppBlueprint remains the canonical operational object instead of a projection;
4. a public WorldBundle can reveal or resolve evaluator-private material;
5. the Veritas adapter silently drops or widens a Woyengi semantic requirement;
6. Woyengi certification is represented as scientific/frontier qualification;
7. Veritas qualification is allowed to authorize Woyengi semantic state/effects;
8. a cross-repo parity claim is made against different fixture bytes/hashes;
9. required repo gates are skipped because another lane passed them;
10. `prd.json`/`progress.txt` are concurrently edited by satellite lanes.

## Final P0 reconciliation

Only the integration lane performs final shared project-control reconciliation.

After all P0 lanes are accepted:

1. verify `main` includes the accepted versions of #7/#8/#9/#11;
2. verify Veritas adapter parity against #9 fixture/hash;
3. rerun Woyengi full required gates from the integrated main-equivalent head;
4. inspect diffs for ownership violations/deep imports;
5. run final four-axis review: repository standards, spec/tickets, constitutional invariants, executable evidence;
6. update shared project-control/history files only if repository policy and human acceptance permit it;
7. close #10/#6 only when cross-repo parity evidence is complete;
8. unlock P1 implementation only after P0 acceptance rather than merely after code merge.

## Failure handling

A failing lane does not block unrelated lanes unless it changes the shared contract or a declared interface.

If a failure is outside the lane's ownership (for example an unrelated flaky UI test), the lane records the exact evidence and reruns/raises a separate blocker rather than opportunistically editing another owner's code.
