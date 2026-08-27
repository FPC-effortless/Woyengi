# P0 integration freeze handoff

Date: 2026-08-27
Role: P0 ecosystem integration agent
Parent: #6
Integrator branch: `feat/p0-operational-alignment`
Integrator PR: #12

## Outcome

The P0 integration lane has moved from initial contract construction into parallel interface control.

The canonical P0-001 code seam is verified and frozen for satellite consumption. Parallel Woyengi lanes and the Veritas adapter have explicit, file-disjoint ownership and an integration protocol that prevents satellite agents from independently redefining canonical semantics.

## Canonical contract state

The P0-001 public implementation remains `packages/operational-spec/src/index.ts` and includes:

- `ComprehensionModel v0.1`;
- generalized `OutcomeContract v0.1`;
- `OperationalSystemSpec v0.1`;
- deterministic content-bound Operational IR;
- `WorldBundle v0.1` contract with public/private-evaluator partition metadata.

Verified code head: `8c4b8dcba124aeb8dfa68515fb3d76f5f875c584`.

GitHub Actions run `33068180184` passed the complete required repository CI path at that head.

## Durable integration documents added

- `docs/specs/p0-contract-freeze.md`
  - freezes contract IDs, enum sets and semantic rules;
  - defines compatibility expectations;
  - makes `packages/operational-spec/**` integrator-owned;
  - defines the minimum-interface-request process for satellite agents.

- `docs/specs/p0-woyengi-veritas-parity.md`
  - maps Woyengi world semantics onto current Veritas `TaskContract`, `PublicActionSpec`, `OperationalRecord`, `HiddenOracle`, and `OperationalEpisode` semantics;
  - defines exact public/private visibility and fail-closed mapping rules;
  - requires #9 and Veritas #67 to use the same pinned language-neutral fixture/hash.

- `docs/specs/p0-integration-acceptance.md`
  - records lane ownership, merge topology, per-lane gates, integration falsifiers and final reconciliation order.

## Parallel lanes

Woyengi:

- #8 / `feat/p0-app-projection` — owns only `packages/composer/**` plus unique handoff.
- #9 / `feat/p0-worldbundle-conformance` — owns only `packages/world-bundle/**`, its fixtures and unique handoff.
- #11 / `feat/p0-certification-boundary` — owns only `packages/evaluation/**`, optional dedicated ownership doc and unique handoff.

Veritas:

- #67 / `feat/woyengi-worldbundle-adapter` — owns only `src/investigation_world/integrations/woyengi/**`, matching tests/docs, optional unique handoff.
- It must not touch active Frontier PR #65, foundry, CompanyWorld, ProjectWorld, portability, qualification, Observatory, training-value, shared workflows or release files.

Planning-only lanes #14–#17 may prepare P1/P2 specs/tickets/handoffs but may not modify production source before P0 acceptance.

## Integration authority

Only the P0 integrator may edit `packages/operational-spec/**` or shared P0 contract semantics.

Satellite interface requests must include the minimum missing capability and a falsifier. The integrator classifies them as clarification, adapter concern, compatible P0 patch or post-v0.1 extension.

Any post-freeze contract patch requires its own regression test, minimum change, full CI, notice to affected lanes and coordinated rebase.

## Veritas parity evidence reviewed

Current Veritas `src/investigation_world/operational/models.py` confirms:

- `TaskContract` is public objective/role/action/constraint state;
- `PublicActionSpec` has the same six action-kind concepts needed by Woyengi;
- `OperationalRecord` is agent-visible evidence/record state;
- `HiddenOracle` owns target state, invariants, required evidence, hidden effects and budgets;
- `OperationalEpisode.public_payload()` omits the oracle.

The parity matrix therefore treats Veritas's existing public/private model as the adaptation target rather than inventing a new evaluator substrate.

## CI state and unrelated flake

After the repository became public, hosted runners execute normally.

A repeated unrelated CI flake exists in `apps/woyengi/test/visual-qa.mjs`: Chrome occasionally fails to expose its debug `/json/version` endpoint before the fixed timeout. This occurred on first attempts of runs `33071348559` and `33071548170`; the former passed all gates on rerun, and the latter rerun progressed through Node/Python tests, adversarial benchmark and architecture gate successfully at the time of this handoff.

Tracked separately as #18. Do not broaden P0 feature lanes to edit the UI test merely to hide a false red.

## Human acceptance boundary

PR #12 remains draft. Automated green is not human acceptance, release readiness or authority to alter user operational state. Existing WYG-025/026 `passes:false` flags remain untouched.

## Next integration actions

1. Confirm latest PR #12 rerun completes all quality/security gates after the integration-doc commits.
2. Update PR #12 verification text so it reflects actual green evidence rather than the earlier runner/typecheck blockers.
3. Monitor #8/#9/#11/#67 for minimum interface requests; accept no direct contract edits from satellite lanes.
4. Review each satellite PR for file-ownership violations before semantic review.
5. Once #9 is green, record its exact pinned fixture path/hash and require Veritas #67 to bind to that exact artifact.
6. Perform final cross-repo parity review only after both sides are green on the same fixture bytes.
7. Keep final `prd.json`/`progress.txt` reconciliation integrator-owned and defer it until human acceptance permits it.
