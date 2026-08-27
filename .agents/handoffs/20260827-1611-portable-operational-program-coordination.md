# Portable Operational Program coordination handoff

## Work mode

Planning / coordination only. Primary Woyengi mode: RL environment construction/evaluation. No product code, package metadata, release state, `prd.json`, `progress.txt`, or shared ADR was changed.

## Task

Coordinate the cross-repository program:

`Woyengi WorldBundle -> Veritas OperationalEpisode -> PortableOperationalContract -> generic runtime + MCP compiler -> NeMo / OpenEnv / Harbor / Prime / HUD -> cross-runtime conformance -> canonical trajectories + offline reverification -> Observatory diagnostics`

Pinned planning baselines:

- Woyengi: `31bf9d0a5df72c147e1a07327526f8969e8cf224`
- Veritas: `98500d7e081e48f8e291be51ba360ff851aa88fe`

Planning branch: `plan/portable-operational-program-20260827` from the exact Woyengi baseline above.

## Authority and architectural decisions

1. Woyengi remains semantic authority for persistent operational meaning and WorldBundle production. Veritas remains authority for evaluator execution, private oracle projection, verification, trajectories, portability, qualification, and Observatory measurement.
2. Do not replace `OperationalEpisode`, `HiddenOracle`, `OperationalRuntime`, the seven-dimensional verifier, `RolloutTrace`, tracing/replay, Observatory provider/harness/runtime abstractions, the existing SRE HUD/Prime exporters, WorldBundle conformance, or the merged Woyengi adapter.
3. `PortableOperationalContract` is a projection of `OperationalEpisode` plus existing portability/release metadata, not a new canonical world model.
4. The frozen Woyengi `WorldActionDescriptor` v0.1 is not modified for A1. Typed action schemas are added as public WorldBundle `ACTION_SCHEMA` members using the existing arbitrary member payload seam. Proposed payload contract: `woyengi.world-bundle.action-schema.v0.1`, keyed by `actionRef`, with JSON Schema 2020-12 `inputSchema` and `outputSchema`. Schema members must contain shape only, never hidden result values/oracle truth.
5. Portable runtime execution delegates to existing `OperationalRuntime`; it must not reimplement transitions, budgets, or reward. The runtime protocol separately exposes universal record operations (`search`, `search_all`, `open_record`) and task actions.
6. MCP compilation is deterministic. Transport/server identity, MCP tool name, canonical operation ID, and canonical action reference are separate fields. A harness alias must never become canonical tool identity.
7. Trajectory v2 is additive and deterministic. It can ingest `RolloutTrace` after PR #36 reconciliation, but does not replace `RolloutTrace` or legacy `Trajectory`. Wall-clock metadata is excluded from canonical identity.
8. Offline reverification replays public operations against a fresh canonical runtime and reruns the existing verifier. Stored reward is evidence to compare, never truth. Missing private evaluator material yields INCONCLUSIVE/UNKNOWN, never PASS.
9. Cross-runtime conformance compares normalized semantics, not framework-specific envelopes.
10. Shared existing files are reserved to F1 only. If any implementation lane discovers that it needs a shared file, it stops and records an F1 requirement instead of editing across ownership boundaries.

## Active conflict gates

- Frontier Qualification PR #65 is reserved. Every Veritas ticket forbids:
  - `src/investigation_world/frontier/**`
  - `tools/frontier_*.py`
  - `tests/frontier/**`
  - `docs/frontier/**`
  - `.github/workflows/frontier-qualification.yml`
- Foundry/trajectory PR #36 must be reconciled before A3 or any shared Foundry integration. Feature tickets never own `src/investigation_world/foundry/**`; any eventual shared Foundry bridge is F1-only.
- Operational-world/OpenEnv PR #30 must be reconciled before C2. C2 never owns the PR #30 `src/investigation_world/integrations/openenv.py` implementation or its tests.

## Global forbidden paths

Every implementation ticket forbids, unless a file is explicitly listed in F1 positive ownership:

- `prd.json`
- `progress.txt`
- root/package metadata and lock files (`pyproject.toml`, package manifests, lock files)
- release/version/status artifacts (`release/**`, `BUILD_STATUS.md`, release identity files)
- shared ADRs
- all Frontier paths above
- every other ticket's positive-owned files

Woyengi implementation tickets additionally forbid `packages/operational-spec/**`.

## Dependency DAG

External gates: `R36 = reconcile PR #36`; `R30 = reconcile PR #30`.

```text
A1 Woyengi action schemas ---------------------> B1 Woyengi schema consumer ---\
                                                                                 \
A2 Portable Operational Contract ---> D3 sandbox contract                        +--> D1 conformance --> D2 CLI ---\
             |                    \                                                /                                  \
             |                     +--> B3 MCP compiler --> C1 NeMo -------------+                                    +--> F1
             |                                |           --> C3 Harbor ---------+                                    /
             |                                |           --> C4 Prime ----------+                                   /
             |                                |           --> C5 HUD ------------+                                  /
             |                                |           --> C2 OpenEnv --(R30)-+                                 /
             |                                |                                                                        /
R36 --> A3 Trajectory v2 --> B2 portable runtime protocol ------------------------+--> B4 offline reverification ----+
                                                                                   \                                /
                                                                                    +--> E1 Observatory diagnostics+
```

More precisely:

- A1: no POP dependency; branch from pinned Woyengi baseline.
- A2: no POP dependency; branch from pinned Veritas baseline.
- A3: depends R36 only.
- B1: depends A1 + A2.
- B2: depends A2 + A3.
- D3: depends A2.
- B3: depends A2 + B2.
- B4: depends A3 + B2.
- C1: depends B2 + B3 + D3.
- C2: depends R30 + B2 + B3.
- C3: depends B2 + B3 + D3.
- C4: depends B2 + B3.
- C5: depends B2 + B3 + D3.
- D1: depends B1 + B4 + C1 + C2 + C3 + C4 + C5.
- D2: depends D1 + B4.
- E1: depends D1 + B4.
- F1: depends all implementation tickets and rebases after any merged reserved/conflict PRs without touching their owned files.

## Implementation tickets

### A1 — Woyengi action schemas

- Repository/branch: Woyengi `feat/pop-a1-world-action-schemas`.
- Positive ownership only:
  - `packages/world-bundle/src/action-schema.ts`
  - `packages/world-bundle/test/action-schema.test.ts`
  - `packages/world-bundle/fixtures/veritas-action-schema-v0.1.json`
  - `packages/world-bundle/fixtures/veritas-action-schema-v0.1.sha256`
- Forbidden: global + all `packages/operational-spec/**` + `packages/world-bundle/src/index.ts` + existing pinned fixture/conformance tests.
- Consumes: `PortableWorldMemberInput`/WorldBundle member semantics and frozen `WorldActionDescriptor` action IDs/parameter names read-only.
- Produces: `WorldActionSchemaPayload`, schema member validator/factory, pinned full-artifact fixture containing public `ACTION_SCHEMA` members.
- Falsifiers: unknown actionRef; duplicate schema per action; parameter mismatch; non-object input root; invalid JSON Schema; hidden/private keys/refs; noncanonical bytes/hash; schema value leakage; old v0.1 fixture behavior changes.
- Verification: targeted package tests, package typecheck, deterministic fixture byte/hash check, existing WorldBundle conformance/public-leakage suite unchanged.
- Merge: wave 1, Woyengi first-class producer seam.

### A2 — Portable Operational Contract

- Repository/branch: Veritas `feat/pop-a2-portable-operational-contract`.
- Positive ownership only:
  - `src/investigation_world/portable_contract/__init__.py`
  - `src/investigation_world/portable_contract/models.py`
  - `src/investigation_world/portable_contract/projection.py`
  - `src/investigation_world/portable_contract/identity.py`
  - `tests/portable_contract/test_models.py`
  - `tests/portable_contract/test_projection.py`
- Forbidden: global + `src/investigation_world/operational/**` + existing `src/investigation_world/portability/**` files + existing Woyengi integration files.
- Consumes read-only: `OperationalEpisode`, `TaskContract`, `PublicActionSpec`, `OperationalRecord`, existing `PortableEnvironmentManifest`/reset/verifier/capability/release contracts.
- Produces: immutable/content-derived `PortableOperationalContract`, public operation/action schemas, record-operation contracts, source/release/reset/verifier references, public/private visibility boundary, projection from OperationalEpisode.
- Falsifiers: oracle/private metadata in public model; duplicate operation IDs; schema/action mismatch; non-deterministic ID; manifest/environment identity mismatch; projection changes canonical episode; output requires a framework-specific type.
- Verification: deterministic round-trip, public leakage scan, exact projection parity on native OperationalEpisode and Woyengi-adapted fixture, existing operational/runtime tests remain green.
- Merge: wave 1.

### A3 — Trajectory v2

- Repository/branch: Veritas `feat/pop-a3-trajectory-v2`.
- Start gate: PR #36 reconciled into main first.
- Positive ownership only:
  - `src/investigation_world/portable_trajectory_v2/__init__.py`
  - `src/investigation_world/portable_trajectory_v2/models.py`
  - `src/investigation_world/portable_trajectory_v2/canonical.py`
  - `src/investigation_world/portable_trajectory_v2/rollout_adapter.py`
  - `tests/portable_trajectory_v2/test_schema.py`
  - `tests/portable_trajectory_v2/test_rollout_adapter.py`
- Forbidden: global + all `src/investigation_world/foundry/**` + legacy `src/investigation_world/trajectories/**` + Observatory core.
- Consumes read-only: post-reconciliation `RolloutTrace`/TraceEvent.
- Produces: canonical trajectory envelope/events, deterministic trajectory ID/digest, explicit canonical operation/action identity plus transport server/tool identity and harness alias, verifier snapshot, state digests, redacted public projection, `from_rollout_trace()` adapter.
- Falsifiers: event reorder changes nothing; wall-clock changes identity; alias replaces canonical action identity; private state enters public projection; identical RolloutTrace normalizes differently; reward/state digest omitted.
- Verification: golden canonical JSON, hash determinism, RolloutTrace conversion parity, privacy tests.
- Merge: wave 1 after R36.

### B1 — Woyengi schema consumer

- Repository/branch: Veritas `feat/pop-b1-woyengi-schema-consumer`.
- Positive ownership only:
  - `src/investigation_world/woyengi_schema/__init__.py`
  - `src/investigation_world/woyengi_schema/models.py`
  - `src/investigation_world/woyengi_schema/consumer.py`
  - `tests/woyengi_schema/test_action_schema_consumer.py`
  - `tests/woyengi_schema/fixtures/veritas-action-schema-v0.1.json`
  - `tests/woyengi_schema/fixtures/veritas-action-schema-v0.1.sha256`
- Forbidden: global + existing `src/investigation_world/integrations/woyengi/**` + operational core + A2 files.
- Depends: A1 + A2.
- Consumes: exact pinned A1 fixture bytes/hash, existing Woyengi adapter public API, A2 PortableOperationalContract projection interfaces.
- Produces: validated `ActionSchemaCatalog` and Woyengi-to-portable-contract composition helper.
- Falsifiers: byte hash mismatch; schema references unknown/private action; duplicate schema; parameter-name parity failure; consumer invents defaults; private member accepted as public schema; live Woyengi/network dependency.
- Verification: exact fixture hash before decode, existing adapter parity suite, schema parity, no-network test, public leakage scan.
- Merge: wave 2.

### B2 — Portable runtime protocol

- Repository/branch: Veritas `feat/pop-b2-portable-runtime-protocol`.
- Positive ownership only:
  - `src/investigation_world/portable_runtime/__init__.py`
  - `src/investigation_world/portable_runtime/models.py`
  - `src/investigation_world/portable_runtime/protocol.py`
  - `src/investigation_world/portable_runtime/operational.py`
  - `tests/portable_runtime/test_protocol.py`
  - `tests/portable_runtime/test_operational_adapter.py`
- Forbidden: global + `src/investigation_world/operational/**` + existing SRE portability runtime + A3 files.
- Depends: A2 + A3.
- Consumes: A2 contract, A3 event sink/envelope, existing `OperationalRuntime`, `EpisodeSubmission`, `VerificationBreakdown` read-only.
- Produces: `PortableRuntimeFactory`, `PortableRuntimeSession`, public start/reset/invoke/submit/state interfaces; universal record operations; evaluator-only state digest hook; canonical trajectory emission.
- Falsifiers: direct-runtime and portable-runtime outcome diverge; reset same identity differs; private `state_snapshot()` becomes agent-visible; budget differs; extra/missing action semantics; submit bypasses existing verifier; session can execute after close.
- Verification: differential sequence tests against OperationalRuntime, seven-dimension exact parity, deterministic reset, trajectory event order/digests, leakage tests.
- Merge: wave 2.

### B3 — MCP compiler

- Repository/branch: Veritas `feat/pop-b3-mcp-compiler`.
- Positive ownership only:
  - `src/investigation_world/mcp_compiler/__init__.py`
  - `src/investigation_world/mcp_compiler/models.py`
  - `src/investigation_world/mcp_compiler/compiler.py`
  - `src/investigation_world/mcp_compiler/gateway.py`
  - `tests/mcp_compiler/test_compiler.py`
  - `tests/mcp_compiler/test_gateway.py`
- Forbidden: global + B2 files + adapter directories + root CLI.
- Depends: A2 + B2.
- Consumes: A2 operation schemas; B2 runtime invoke interface.
- Produces: deterministic MCP 2026-07-28 tool catalog/dispatch map, canonical server/tool/operation/action provenance, execution gateway.
- Falsifiers: post-sanitization name collision; unstable tool order; invalid JSON Schema; input/output validation drift; alias accepted as canonical identity; hidden oracle included; unknown tool dispatches.
- Verification: JSON Schema validation, deterministic catalog golden, gateway differential tests, structured-output validation, canonical identity round-trip.
- Merge: wave 3.

### B4 — Offline reverification

- Repository/branch: Veritas `feat/pop-b4-offline-reverification`.
- Positive ownership only:
  - `src/investigation_world/offline_reverification/__init__.py`
  - `src/investigation_world/offline_reverification/models.py`
  - `src/investigation_world/offline_reverification/reverify.py`
  - `tests/offline_reverification/test_reverify.py`
- Forbidden: global + Foundry/tracing/replay files + operational core + A3/B2 files.
- Depends: A3 + B2.
- Consumes: Trajectory v2, B2 fresh runtime factory, existing canonical episode/evaluator material.
- Produces: `ReverificationReport` with PASS/FAIL/INCONCLUSIVE, divergence locations, recomputed state digests/seven-dimension verifier result/reward.
- Falsifiers: tampered stored reward passes; reordered/mutated action passes; changed initial state passes; missing private evaluator returns PASS; external/consequential effect replay is performed rather than refused/sandboxed.
- Verification: tamper matrix, exact canonical replay parity, missing-evaluator inconclusive behavior, no-network/no-external-effect test.
- Merge: wave 3.

### D3 — Sandbox provider contract

- Repository/branch: Veritas `feat/pop-d3-sandbox-provider-contract`.
- Positive ownership only:
  - `src/investigation_world/sandbox_contract/__init__.py`
  - `src/investigation_world/sandbox_contract/models.py`
  - `src/investigation_world/sandbox_contract/provider.py`
  - `tests/sandbox_contract/test_provider_contract.py`
- Forbidden: global + Observatory provider abstractions + adapter directories + infrastructure/package files.
- Depends: A2.
- Consumes: A2 runtime/resource/compatibility metadata only.
- Produces: vendor-neutral `SandboxSpec`, `SandboxHandle`, `SandboxCapabilities`, `SandboxProvider` Protocol, deterministic in-memory fake for tests.
- Falsifiers: secret values serialized; network wider than spec; mutable sandbox identity; reset cannot reproduce declared clean state; unsupported capability silently accepted; provider owns model inference semantics.
- Verification: protocol conformance fake, lifecycle/reset tests, redaction tests, capability negotiation failures.
- Merge: wave 2 before sandbox-using adapters.

### C1 — NeMo Gym adapter

- Repository/branch: Veritas `feat/pop-c1-nemo`.
- Positive ownership only:
  - `src/investigation_world/portable_nemo/__init__.py`
  - `src/investigation_world/portable_nemo/models.py`
  - `src/investigation_world/portable_nemo/compiler.py`
  - `src/investigation_world/portable_nemo/resources_server.py`
  - `src/investigation_world/portable_nemo/trajectory_adapter.py`
  - `tests/portable_nemo/test_compiler.py`
  - `tests/portable_nemo/test_resources_server.py`
  - `tests/portable_nemo/test_trajectory_identity.py`
- Forbidden: global + root/package config + B2/B3/D3 files.
- Depends: B2 + B3 + D3.
- Consumes: portable contract, runtime session, MCP catalog, sandbox contract.
- Produces: NeMo JSONL task compiler, Resources Server bridge for state/tools/verification, trajectory normalization preserving canonical tool provenance.
- Falsifiers: task row leaks evaluator truth; session reset differs; `/verify` reward differs from canonical verifier; MCP/harness alias collapses canonical `(server, tool/action)` identity; task tool schema differs from B3; state shared across tasks.
- Verification: generated JSONL schema/golden, Resources Server unit smoke, deterministic multi-session test, reward parity, canonical identity test, optional clean external NeMo smoke during implementation without changing repo package metadata.
- Merge: wave 4.

### C2 — OpenEnv adapter

- Repository/branch: Veritas `feat/pop-c2-openenv`.
- Start gate: PR #30 reconciled into main first.
- Positive ownership only:
  - `src/investigation_world/portable_openenv/__init__.py`
  - `src/investigation_world/portable_openenv/models.py`
  - `src/investigation_world/portable_openenv/environment.py`
  - `src/investigation_world/portable_openenv/server.py`
  - `tests/portable_openenv/test_environment.py`
  - `tests/portable_openenv/test_parity.py`
- Forbidden: global + `src/investigation_world/integrations/openenv.py` + `tests/unit/test_openenv_integration.py` + `src/investigation_world/operational_world/**` + PR #30-owned files.
- Depends: R30 + B2 + B3.
- Consumes: B2 runtime protocol and B3 operation schemas.
- Produces: typed OpenEnv Action/Observation/public State, Environment reset/step/state adapter, server factory.
- Falsifiers: OpenEnv state exposes hidden state; same action sequence differs from B2; reset seed drift; reward/done emitted before canonical submit semantics; unknown action accepted; generic adapter imports CompanyWorld compiler.
- Verification: direct differential parity against B2, typed serialization, reset/state isolation, OpenEnv server smoke where dependency is available.
- Merge: wave 4 after R30.

### C3 — Harbor adapter

- Repository/branch: Veritas `feat/pop-c3-harbor`.
- Positive ownership only:
  - `src/investigation_world/portable_harbor/__init__.py`
  - `src/investigation_world/portable_harbor/models.py`
  - `src/investigation_world/portable_harbor/compiler.py`
  - `src/investigation_world/portable_harbor/verifier_bridge.py`
  - `tests/portable_harbor/test_compiler.py`
  - `tests/portable_harbor/test_private_verifier_boundary.py`
- Forbidden: global + B2/B3/D3 files + generated task output committed as operator-private data.
- Depends: B2 + B3 + D3.
- Consumes: portable contract, MCP catalog, sandbox/network spec, verifier bridge.
- Produces: deterministic Harbor task-directory generator (`task.toml`, instruction, environment/MCP config, verifier package) with separate verifier environment when private oracle is required.
- Falsifiers: hidden truth in agent environment; private grading uses shared verifier environment; network policy widens; reward file differs from seven-dimensional verifier; generated operator-private task committed to public fixture; nondeterministic package hash.
- Verification: generated-tree golden/hash, Harbor schema validation, private-boundary scan, reward parity, optional Harbor task smoke in temp output.
- Merge: wave 4.

### C4 — Prime Verifiers v1 adapter

- Repository/branch: Veritas `feat/pop-c4-prime`.
- Positive ownership only:
  - `src/investigation_world/portable_prime/__init__.py`
  - `src/investigation_world/portable_prime/compiler.py`
  - `src/investigation_world/portable_prime/taskset_bridge.py`
  - `tests/portable_prime/test_compiler.py`
  - `tests/portable_prime/test_v1_taskset_parity.py`
- Forbidden: global + existing `src/investigation_world/portability/prime.py` + SRE package tests/files + B2/B3 files.
- Depends: B2 + B3.
- Consumes: portable contract/runtime, MCP tool catalog, current `verifiers.v1` Taskset/TaskData/Task/Trace/Toolset abstraction.
- Produces: generic operational Taskset generator/bridge, MCP Toolset binding, `@vf.reward` scorer delegating to canonical submit/verifier semantics.
- Falsifiers: v0 becomes primary path; TaskData exposes hidden oracle to harness/model; harness/runtime hard-coded inside Taskset; score drift; tool identity/schema drift; mutable task data.
- Verification: v1 taskset load, toolset discovery, canonical reward parity, deterministic package generation; existing SRE Prime exporter tests remain unchanged.
- Merge: wave 4.

### C5 — HUD adapter

- Repository/branch: Veritas `feat/pop-c5-hud`.
- Positive ownership only:
  - `src/investigation_world/portable_hud/__init__.py`
  - `src/investigation_world/portable_hud/compiler.py`
  - `src/investigation_world/portable_hud/environment_bridge.py`
  - `tests/portable_hud/test_compiler.py`
  - `tests/portable_hud/test_protocol_parity.py`
- Forbidden: global + existing `src/investigation_world/portability/hud.py` + SRE HUD tests/files + B2/B3/D3 files.
- Depends: B2 + B3 + D3.
- Consumes: portable contract/runtime, MCP capability, sandbox contract, HUD protocol-first manifest/start/grade semantics.
- Produces: generic HUD environment/package generator, MCP capability binding, task start/grade bridge.
- Falsifiers: manifest/task-start leaks oracle; grade bypasses canonical verifier; MCP schema drift; environment becomes harness-specific; package nondeterminism; SRE exporter changed.
- Verification: manifest/generator golden, start/grade canonical reward parity, private-boundary scan, optional live HUD protocol smoke in generated temp package.
- Merge: wave 4.

### D1 — Cross-runtime conformance

- Repository/branch: Veritas `feat/pop-d1-cross-runtime-conformance`.
- Positive ownership only:
  - `src/investigation_world/portable_conformance/__init__.py`
  - `src/investigation_world/portable_conformance/models.py`
  - `src/investigation_world/portable_conformance/normalization.py`
  - `src/investigation_world/portable_conformance/runner.py`
  - `tests/portable_conformance/fixtures/conformance-vector-v1.json`
  - `tests/portable_conformance/test_matrix.py`
  - `tests/portable_conformance/test_leakage.py`
- Forbidden: global + every adapter implementation + existing portability validation/workflow files.
- Depends: B1 + B4 + C1-C5.
- Consumes: common portable contract, all five adapter outputs, Trajectory v2, offline reverification.
- Produces: `RuntimeConformanceReport`, per-runtime result vector, normalized semantic trace comparison, cross-runtime matrix.
- Required gates: contract/identity parity; action/tool schema parity; deterministic reset; observation/result parity; terminal evaluator-state digest parity; exact seven-dimension/reward parity; canonical tool identity preservation; no private leakage; canonical trajectory equivalence after framework-noise normalization; offline reverification PASS.
- Falsifiers: any single adapter mismatch can still report PASS; INCONCLUSIVE treated as PASS; framework alias changes semantic identity; private field survives normalization; reward-only equality masks dimension/state mismatch.
- Verification: deterministic five-runtime matrix with mocked/in-process framework surfaces, tamper/leakage negatives, optional external SDK smoke results recorded separately from semantic PASS.
- Merge: wave 5.

### D2 — Portable CLI

- Repository/branch: Veritas `feat/pop-d2-portable-cli`.
- Positive ownership only:
  - `src/investigation_world/portable_cli/__init__.py`
  - `src/investigation_world/portable_cli/app.py`
  - `tests/portable_cli/test_app.py`
- Forbidden: global + root `src/investigation_world/cli.py` + `pyproject.toml` + adapter implementations.
- Depends: D1 + B4.
- Consumes: contract/MCP/export/conformance/reverification public APIs.
- Produces: standalone Typer app with `compile-contract`, `compile-mcp`, `export --target`, `conformance`, and `reverify` commands. Root CLI registration is F1-only.
- Falsifiers: CLI writes private material to buyer-safe output; unknown target falls back silently; conformance returns zero on FAIL; reverify without evaluator returns PASS; CLI needs root package metadata change to run in tests.
- Verification: Typer CliRunner tests, exit-code matrix, deterministic output hashes, private-output path safeguards.
- Merge: wave 6.

### E1 — Observatory diagnostics

- Repository/branch: Veritas `feat/pop-e1-observatory-diagnostics`.
- Positive ownership only:
  - `src/investigation_world/portable_observatory/__init__.py`
  - `src/investigation_world/portable_observatory/models.py`
  - `src/investigation_world/portable_observatory/diagnostics.py`
  - `tests/portable_observatory/test_diagnostics.py`
- Forbidden: global + existing `src/investigation_world/observatory/**` + provider/harness/runtime registries + Frontier paths.
- Depends: D1 + B4.
- Consumes read-only: existing Observatory `CapabilityRun`/cell/provenance concepts plus conformance/reverification reports and Trajectory v2.
- Produces: portable runtime diagnostic records and attribution reducers for contract/schema, reset, tool identity, runtime transition, verifier/reward, sandbox, serialization, and harness/adapter divergence.
- Falsifiers: adapter drift mislabeled as model capability drift; non-comparable runtime versions merged; missing conformance evidence treated as capability regression; private trajectory material persisted into buyer-safe diagnostics.
- Verification: attribution unit matrix, same-model/different-adapter controls, privacy tests, deterministic diagnostic identity.
- Merge: wave 6, parallel with D2.

### F1 — Final convergence

This is the only ticket allowed to modify existing shared integration/export files. It is one convergence gate executed on paired branches:

- Woyengi: `feat/pop-f1-final-convergence`
- Veritas: `feat/pop-f1-final-convergence`

Woyengi positive ownership only:

- `packages/world-bundle/src/index.ts`
- `packages/world-bundle/test/world-bundle.test.ts`

Veritas positive ownership only:

- `src/investigation_world/portability/__init__.py`
- `src/investigation_world/integrations/__init__.py`
- `src/investigation_world/cli.py`
- `tests/portable_program/test_final_convergence.py`
- `docs/portable-operational-program.md`

Forbidden even in F1:

- `prd.json`, `progress.txt`, shared ADRs, package metadata/locks, release/version/status files
- all Frontier paths/workflow
- `src/investigation_world/operational/**`
- existing `src/investigation_world/portability/hud.py`, `prime.py`, `runtime.py` except imports/exports through the explicitly owned `portability/__init__.py`
- `src/investigation_world/foundry/**`
- PR #30 OpenEnv implementation unless a separately approved reconciliation requires a bridge; no overwrite
- any ticket-owned implementation file except through its public interface

Depends: all A/B/C/D/E tickets complete, R30/R36 resolved, current main rebased. If PR #65 has merged, rebase and prove its owned paths are untouched.

F1 work:

1. Woyengi exports A1 action-schema API from the existing WorldBundle public index and runs full WorldBundle regression/conformance tests. No old fixture repin unless semantics actually changed (the design intends backward compatibility, so the old pinned fixture should remain byte-identical).
2. Veritas exposes new public portability APIs, registers the standalone portable CLI under the existing root CLI, and creates any necessary integration namespace export after reconciling PR #30.
3. Run one end-to-end pinned path: Woyengi schema fixture -> existing Woyengi adapter -> PortableOperationalContract -> portable runtime/MCP -> all five adapters -> conformance -> canonical Trajectory v2 -> offline reverification -> portable Observatory diagnostics.
4. Assert the original SRE HUD/Prime exporters remain behaviorally unchanged.
5. Do not claim scientific qualification, Frontier qualification, commercial readiness, or release readiness from conformance alone.

Falsifiers: any public/private leak; any adapter reward/dimension/state mismatch; old Woyengi v0.1 fixture byte changes unexpectedly; SRE HUD/Prime regression; root CLI registration changes existing commands; Frontier diff appears; PR30/PR36 semantics overwritten; same Woyengi fixture fails offline reverification.

Verification: Woyengi targeted + full package checks; Veritas targeted POP suite followed by repository Python tests and applicable existing portability/operational smoke gates; exact git diff ownership audit; cross-repo fixture SHA pin; no release workflow or metadata changes.

Merge order inside F1: Woyengi convergence first -> record exact Woyengi commit/fixture hash -> Veritas convergence consumes that immutable seam -> Veritas final tests. Merge/release authority remains separate.

## Integration order / safe parallelism

1. Reconcile PR #36 and PR #30 independently. Keep PR #65 reserved.
2. Parallel wave 1: A1 (Woyengi), A2 (Veritas); A3 starts immediately after R36.
3. Parallel wave 2 after dependencies: B1, B2, D3.
4. Parallel wave 3: B3 and B4.
5. Parallel wave 4: C1, C2, C3, C4, C5; C2 waits for R30, each adapter remains in its own sibling namespace.
6. Wave 5: D1.
7. Parallel wave 6: D2 and E1.
8. Wave 7: paired F1 convergence, Woyengi then Veritas.

Agents must branch from `main` containing their declared upstream dependencies, never by stacking one feature branch directly on another. Before implementation each agent records the exact branch-point SHA and performs a path-overlap check against open PRs.

## Evidence reviewed

Woyengi: `AGENTS.md`, `agent.md`, `CONSTITUTION.md`, `docs/architecture.md`, ADR 0007, ADR 0008, P0 ecosystem alignment, P0 contract freeze, P0 Woyengi-Veritas parity, WorldBundle README and implementation, handoff/mode instructions.

Veritas: `AGENTS.md`, universal/Veritas overlays, `BUILD_STATUS.md`, unified operational worlds, portability docs/models/runtime, operational models/runtime, Foundry RolloutTrace/tracing/replay, legacy trajectory schema, Observatory execution/providers/docs, existing Woyengi adapter, SRE HUD/Prime exporters, and active PRs #30/#36/#65.

Current external contract checks: MCP 2026-07-28, NeMo Gym Resources Server/dataset architecture, OpenEnv reset/step/state typed environment, Harbor task/verifier/MCP schema, Prime Verifiers v1 Taskset/Task/Harness/Runtime separation and MCP Toolsets, HUD protocol-first manifest/start/grade + MCP capability model.

## Authority / external effects

No product implementation, PR merge, release, deployment, external task execution, benchmark decryption, or evaluator data mutation was performed. Only this planning branch and this single handoff file were created.

## Exact recommended next action

Resolve/reconcile Veritas PR #36 and PR #30 first. Then launch A1 and A2 in parallel from the stated baselines, with A3 launched from post-#36 main. Do not launch downstream agents until their declared interface-producing dependencies have merged and been pinned.