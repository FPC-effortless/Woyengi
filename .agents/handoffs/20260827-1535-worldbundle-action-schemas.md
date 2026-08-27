# WorldBundle Action Schemas handoff

Date: 2026-08-27
Branch: `feat/worldbundle-action-schemas`
Baseline: `31bf9d0a5df72c147e1a07327526f8969e8cf224`
Draft PR: #24

## Result

Implemented the remaining language-neutral action-schema gap as an additive public WorldBundle member. The frozen `WorldActionDescriptor` and all of `packages/operational-spec/**` remain unchanged.

Schema member kind: `ACTION_SCHEMA`

Schema payload contract: `woyengi.world-bundle.action-schema.v0.1`

Required payload fields:

- `contract`
- `actionRef`
- `inputSchema`
- `outputSchema`

No separate error/result discriminator was required for the pinned fixture. `outputSchema` is sufficient to describe its agent-observable result shape without importing hidden transition semantics.

## Schema profile

The member carries language-neutral JSON Schema draft 2020-12 data. v0.1 deliberately supports a fail-closed structural subset:

- scalar `type`: `null`, `boolean`, `number`, `integer`, `string`;
- object `type` with `properties`, explicit `required`, and `additionalProperties: false`;
- array `type` with `items`;
- root `$schema` fixed to `https://json-schema.org/draft/2020-12/schema`.

Unknown schema keywords and unknown action-schema contract versions are rejected.

Every public action must have exactly one public `ACTION_SCHEMA` member. `actionRef` must resolve to `bundle.public.actionSurface`. Input `properties` must exactly equal the action's normalized `parameterNames`. Required names must be unique and lexicographically sorted; optional inputs are exactly the declared properties absent from `required`.

Output schemas carry structural result shape only. The schema profile rejects evaluator/private/oracle/hidden-transition/target-assertion/private-locator field names and private reference values. The existing WorldBundle public leakage scanner remains an independent defense-in-depth layer.

Action-schema payloads are ordinary public WorldBundle members, so canonical schema bytes participate in each member SHA-256 and in complete/public artifact identity. `toPublicWorldBundleArtifact` preserves all public action schemas unchanged.

## Pinned fixture

Fixture: `packages/world-bundle/fixtures/veritas-adapter-v0.1.json`

Exact artifact identity:

`world-bundle-artifact:sha256:41e6c9b1b583112161d244de00d470a6fa5155f709c74782eb9117a060981462`

Exact serialized fixture-byte SHA-256:

`62172d94b6e5d34774714b3c3da7c3fc61d71c61d7798f71d5a94a8243177a86`

The fixture now binds exactly one schema to each of:

- `world-action:activate-supplier`
- `world-action:inspect-supplier`
- `world-action:request-approval`

## Changed files

- `packages/world-bundle/src/action-schema.ts`
- `packages/world-bundle/src/semantic-conformance.ts`
- `packages/world-bundle/test/action-schema.test.ts`
- `packages/world-bundle/test/world-bundle.test.ts`
- `packages/world-bundle/fixtures/veritas-adapter-v0.1.json`
- `packages/world-bundle/fixtures/veritas-adapter-v0.1.sha256`
- `packages/world-bundle/README.md`
- `.agents/handoffs/20260827-1535-worldbundle-action-schemas.md`

No files outside the allowed ownership set were edited.

## Falsifiers added

Tests reject:

- schema bound to an unknown public action;
- duplicate schema binding for one action;
- input property / `parameterNames` mismatch;
- non-canonical required ordering;
- unsupported/malformed JSON Schema type;
- unknown JSON Schema keyword;
- evaluator-private field smuggled into public output schema;
- unknown action-schema contract version or payload field;
- silently missing schema binding.

Tests also prove semantically equivalent object-key order normalizes to the same member/artifact identity, a schema-shape change changes both member and artifact identity, and public-only derivation preserves all public schemas.

## Verification actually run

Local preflight:

- TypeScript strict compile of the new action-schema and semantic-conformance modules against compatible interface stubs: PASS.
- Compiled runtime execution of `assertWorldActionSchemaConformance` and `assertWorldBundleSemanticConformance` against the repinned fixture: PASS; 3 `ACTION_SCHEMA` members accepted.

GitHub Actions CI run #52 (`33088407418`) on implementation head `7063609a9e521410ddefe517b20b955e38e21d62`: PASS.

That run actually executed and passed:

- `pnpm typecheck`;
- `pnpm boundaries`;
- `pnpm test:all` (Node and Python tests);
- `pnpm benchmark` adversarial benchmark;
- `pnpm prod:check:fast --gate architecture --run-id ci-architecture`;
- `pnpm prod:check:fast --gate security --run-id ci-security`;
- Docker image build plus API readiness smoke test.

## Compatibility / follow-up risks

1. **Cross-repo fixture repin required.** Veritas consumers pinned to the previous fixture bytes/artifact identity must deliberately repin to the exact values above; this branch cannot edit Veritas.
2. **Strict schema subset is intentional.** v0.1 does not represent enums, const/default values, unions/combinators, annotations, formats, or richer error-channel schemas. A producer requiring those semantics must fail closed and introduce an explicitly reviewed additive/versioned contract rather than silently lowering them.
3. **Observability is a public-contract assertion.** The validator can structurally prevent known evaluator/private semantics and value-bearing schema leakage, but it cannot independently prove that an arbitrary business-domain field name is genuinely agent-observable. Producers must derive `outputSchema` only from the public action/result interface, never from private evaluator transitions.
4. **Semantic validation remains layered.** Generic WorldBundle artifact parsing/conformance stays generic by design. Exact `ACTION_SCHEMA` contract/coverage validation is enforced by `assertWorldActionSchemaConformance` and the cross-language `assertWorldBundleSemanticConformance` profile, matching the package's existing treatment of high-value semantic member contracts.
5. **No operational-spec interface change is required.** If future compilation requires schema metadata to become canonical operational semantics rather than a portable projection member, that would require a separately owned operational-spec change; this implementation does not make that change.
