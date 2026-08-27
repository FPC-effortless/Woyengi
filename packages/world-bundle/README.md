# WorldBundle portable artifact v0.1

`packages/world-bundle` materializes the logical `WorldBundle v0.1` contract from `packages/operational-spec/src/index.ts` as deterministic, language-neutral JSON. It does not execute a world, issue effects, scientifically qualify a benchmark, or require a running Woyengi service.

## Artifact forms

- `woyengi.world-bundle-artifact.v0.1` — complete portable artifact with explicit `public` and optional `private-evaluator` members.
- `woyengi.world-bundle-public-artifact.v0.1` — derived public-only artifact. Private metadata, members, hashes, and the complete-artifact identity are absent.

Every materialized member is canonical JSON-compatible data with a SHA-256 content hash. Complete and public artifacts receive separate content-bound SHA-256 identities.

## Determinism and conformance

Creation normalizes identifiers/payloads, sorts members deterministically, content-hashes members, verifies exact manifest coverage, enforces source `OperationalSystemSpec` provenance, and computes the artifact identity over canonical JSON.

Conformance fails closed for duplicate/missing/undeclared members, partition mismatches, tampering, incompatible runtime versions, missing source provenance, and public/private leakage.

Important member kinds additionally use exact semantic schemas rather than arbitrary JSON conventions. The package validates the pinned public semantic task/evidence and private evaluator-oracle structures so executable target assertions, invariant assertion/severity/scope, hidden transitions, evidence materialization, action systems/parameters/costs, budgets, and provenance cannot be silently dropped or replaced with prose.

The primary confidentiality guarantee remains structural: `toPublicWorldBundleArtifact` reconstructs a new artifact from public material only. Leakage scanners are defense in depth, not the secrecy root.

## Cross-repository Veritas pin

Pinned fixture:

`fixtures/veritas-adapter-v0.1.json`

Complete artifact identity:

`world-bundle-artifact:sha256:62b94e85103ef8522ef9eb87f1a6825b2e98fca36fbd57b5aadce06e0f5ab719`

Exact serialized fixture-byte SHA-256:

`3577aa29266dac59921c31e65d22ad657c4b7a9191011e9f5448aed32781e10b`

The sidecar `fixtures/veritas-adapter-v0.1.sha256` pins the same exact bytes.

The public partition contains objective, actors/roles, actions with logical systems/parameters/public costs, constraints, budgets, evidence requirements, a materialized public approval-evidence record, success assertions, artifact descriptors, and source-spec provenance.

The private evaluator partition contains structured target assertions, executable invariants with severity/scope, executable hidden action transitions, and private evidence locators. These are evaluator-side only and must never enter the public artifact or agent payload.

The fixture is standalone canonical UTF-8 JSON and requires no running Woyengi service. Any byte-level or semantic change requires intentional repinning on both Woyengi and Veritas.