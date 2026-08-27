# P0 integration freeze handoff

Date: 2026-08-27
Role: P0 ecosystem integration agent
Parent: #6
Integrator branch: `feat/p0-operational-alignment`
Integrator PR: #12

## Outcome

The P0 integration lane has moved from initial contract construction into parallel interface control.

The canonical P0-001 seam is verified and frozen for satellite consumption. Parallel Woyengi lanes and the Veritas adapter have explicit, file-disjoint ownership and an integration protocol that prevents satellite agents from independently redefining canonical semantics.

A final cross-repo review found one material action-surface gap after the initial freeze candidate: Woyengi actions carried only ID/name/kind while Veritas public actions also require a logical system and declared parameter surface. The integrator repaired that seam through falsifier-first TDD rather than allowing downstream adapters to invent defaults.

## Canonical contract state

The P0-001 public implementation is `packages/operational-spec/src/index.ts` and includes:

- `ComprehensionModel v0.1`;
- generalized `OutcomeContract v0.1`;
- `OperationalSystemSpec v0.1`;
- deterministic content-bound Operational IR;
- `WorldBundle v0.1` contract with public/private-evaluator partition metadata;
- portable public actions with required logical `systemRef`, explicit normalized `parameterNames`, optional normalized public cost, and unique public action names.

Current verified code head: `3688cd735a9d6c83027adc294de685c070b9906e`.

GitHub Actions run `33072398937` passed the complete required repository CI path at that head.

## Latest TDD repair

Cross-repo seam falsifier:
- `311e3e2c47c92b23cd4a8a011faabddb08fb2364` — asserts WorldBundle preserves logical system, parameters and public cost and rejects duplicate public action names.

Implementation:
- `5cd3636edcee7724e9891d475ca13d33d1294c04` — adds `WorldActionCost`, required `systemRef`, required `parameterNames`, cost normalization and duplicate-name rejection.

Fixture/type alignment:
- `3688cd735a9d6c83027adc294de685c070b9906e` — updates the existing WorldBundle contract fixture to the stricter portable action seam.

Full CI for that code head passed typecheck, boundaries, Node/Python tests, adversarial benchmark, architecture/security gates, container build and API readiness.

## Durable integration documents

- `docs/specs/p0-contract-freeze.md`
  - freezes contract IDs, enum sets and semantic rules;
  - records the verified action semantics;
  - defines compatibility expectations;
  - makes `packages/operational-spec/**` integrator-owned;
  - defines the minimum-interface-request process for satellite agents.

- `docs/specs/p0-woyengi-veritas-parity.md`
  - maps Woyengi world semantics onto current Veritas `TaskContract`, `PublicActionSpec`, `OperationalRecord`, `HiddenOracle`, and `OperationalEpisode` semantics;
  - explicitly maps `systemRef`/`parameterNames` and treats cost conversion as fail-closed unless lossless;
  - defines exact public/private visibility rules;
  - requires #9 and Veritas #67 to use the same pinned language-neutral fixture/hash.

- `docs/specs/p0-integration-acceptance.md`
  - records lane ownership, merge topology, per-lane gates, integration falsifiers and final reconciliation order.

## Parallel lanes

Woyengi:

- #8 / `feat/p0-app-projection` — owns only `packages/composer/**` plus unique handoff.
- #9 / `feat/p0-worldbundle-conformance` — owns only `packages/world-bundle/**`, its fixtures and unique handoff. This lane must consume the updated action seam.
- #11 / `feat/p0-certification-boundary` — owns only `packages/evaluation/**`, optional dedicated ownership doc and unique handoff.

Veritas:

- #67 / `feat/woyengi-worldbundle-adapter` — owns only `src/investigation_world/integrations/woyengi/**`, matching tests/docs, optional unique handoff.
- It must not touch active Frontier PR #65, foundry, CompanyWorld, ProjectWorld, portability, qualification, Observatory, training-value, shared workflows or release files.
- It must map public action system/parameters directly and must not infer them from evaluator-private state.

Planning-only lanes #14–#17 may prepare P1/P2 specs/tickets/handoffs but may not modify production source before P0 acceptance.

## Integration authority

Only the P0 integrator may edit `packages/operational-spec/**` or shared P0 contract semantics.

Satellite interface requests must include the minimum missing capability and a falsifier. The integrator classifies them as clarification, adapter concern, compatible P0 patch or post-v0.1 extension.

Any post-freeze contract patch requires its own regression test, minimum change, full CI, notice to affected lanes and coordinated rebase.

## Veritas parity evidence reviewed

Current Veritas `src/investigation_world/operational/models.py` confirms:

- `TaskContract` is public objective/role/action/constraint state;
- `PublicActionSpec` requires public action name/kind/system/parameter names and integer cost;
- `OperationalRecord` is agent-visible evidence/record state;
- `HiddenOracle` owns target state, invariants, required evidence, hidden effects and budgets;
- `OperationalEpisode.public_payload()` omits the oracle.

The parity matrix therefore treats Veritas's existing public/private model as the adaptation target rather than inventing a new evaluator substrate. Woyengi monetary action cost and Veritas integer action cost are not assumed equivalent; unsupported mappings must fail closed or remain structured adapter metadata.

## CI state and unrelated flake

After the repository became public, hosted runners execute normally.

An unrelated intermittent flake exists in `apps/woyengi/test/visual-qa.mjs`: Chrome occasionally fails to expose its debug `/json/version` endpoint before the fixed timeout. Tracked as #18. Reruns have demonstrated the P0 branch itself can pass the complete suite; the verified action-parity code head passed without this flake in run `33072398937`.

Do not broaden P0 feature lanes to edit the UI test merely to hide a false red.

## Human acceptance boundary

PR #12 remains draft. Automated green is not human acceptance, release readiness or authority to alter user operational state. Existing WYG-025/026 `passes:false` flags remain untouched.

## Next integration actions

1. Keep the updated contract seam stable unless a satellite presents a correctness falsifier.
2. Review #8/#9/#11/#67 for file-ownership violations before semantic review.
3. Once #9 is green, record its exact pinned fixture path/hash and require Veritas #67 to bind to that exact artifact.
4. Perform final cross-repo parity review only after both sides are green on the same fixture bytes.
5. Keep final `prd.json`/`progress.txt` reconciliation integrator-owned and defer it until human acceptance permits it.
