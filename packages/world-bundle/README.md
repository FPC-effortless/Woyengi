# WorldBundle portable artifact v0.1

`packages/world-bundle` materializes the logical `WorldBundle v0.1` contract from `packages/operational-spec/src/index.ts` as deterministic, language-neutral JSON. It does not execute a world, issue effects, scientifically qualify a benchmark, or require a running Woyengi service.

## Artifact forms

- `woyengi.world-bundle-artifact.v0.1` — complete portable artifact with explicit `public` and optional `private-evaluator` members.
- `woyengi.world-bundle-public-artifact.v0.1` — derived public-only artifact. Private metadata, members, hashes, and the complete-artifact identity are absent.

Every materialized member is canonical JSON-compatible data with a SHA-256 content hash. Complete and public artifacts receive separate content-bound SHA-256 identities.

## Determinism and conformance

Creation normalizes identifiers/payloads, sorts members deterministically, content-hashes members, verifies exact manifest coverage, enforces source `OperationalSystemSpec` provenance, and computes the artifact identity over canonical JSON.

Conformance fails closed for duplicate/missing/undeclared members, partition mismatches, tampering, incompatible runtime versions, missing source provenance, and public/private leakage.

Important member kinds additionally use exact semantic schemas rather than arbitrary JSON conventions. The package validates the pinned public semantic task/evidence, public action-schema bindings, and private evaluator-oracle structures so executable target assertions, invariant assertion/severity/scope, hidden transitions, evidence materialization, action systems/parameters/costs, budgets, provenance, and typed action interfaces cannot be silently dropped or replaced with prose.

The primary confidentiality guarantee remains structural: `toPublicWorldBundleArtifact` reconstructs a new artifact from public material only. Leakage scanners are defense in depth, not the secrecy root.

## Action schema member contract

Executable public actions use an additive public member rather than widening the frozen `WorldActionDescriptor` contract:

```text
member.kind = ACTION_SCHEMA
member.partition = public
payload.contract = woyengi.world-bundle.action-schema.v0.1
payload.actionRef = world-action:...
payload.inputSchema = language-neutral JSON Schema data
payload.outputSchema = language-neutral JSON Schema data
```

The v0.1 schema profile uses JSON Schema draft 2020-12 structural data with a deliberately fail-closed subset: scalar types, objects, arrays, `properties`, explicit sorted `required`, `items`, and `additionalProperties: false` for objects. Unknown keywords or contract versions are rejected rather than reinterpreted.

Every public action in the semantic profile must have exactly one `ACTION_SCHEMA` binding. `inputSchema.properties` must exactly match the action's normalized `parameterNames`; the explicit `required` subset determines required versus optional inputs deterministically. Output schemas describe only agent-observable result shape. Evaluator-private, oracle, hidden-transition, target-assertion, private-locator, and unsafe schema fields or values are rejected.

Because action schemas are ordinary public WorldBundle members, their canonical payload bytes participate in the member content hash and complete/public artifact identities. Public-only derivation preserves them unchanged.

## Cross-repository Veritas pin

Pinned fixture:

`fixtures/veritas-adapter-v0.1.json`

Complete artifact identity:

`world-bundle-artifact:sha256:41e6c9b1b583112161d244de00d470a6fa5155f709c74782eb9117a060981462`

Exact serialized fixture-byte SHA-256:

`62172d94b6e5d34774714b3c3da7c3fc61d71c61d7798f71d5a94a8243177a86`

The sidecar `fixtures/veritas-adapter-v0.1.sha256` pins the same exact bytes.

The public partition contains objective, actors/roles, actions with logical systems/parameters/public costs, exactly one typed action-schema binding per action, constraints, budgets, evidence requirements, a materialized public approval-evidence record, success assertions, artifact descriptors, and source-spec provenance.

The private evaluator partition contains structured target assertions, executable invariants with severity/scope, executable hidden action transitions, and private evidence locators. These are evaluator-side only and must never enter the public artifact or agent payload.

The fixture is standalone canonical UTF-8 JSON and requires no running Woyengi service. Any byte-level or semantic change requires intentional repinning on both Woyengi and Veritas.
