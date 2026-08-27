# P0 Woyengi -> Veritas Semantic Parity Matrix

Status: integration contract for P0-003/P0-004
Date: 2026-08-27
Woyengi issues: #9, #10
Veritas issue: FPC-effortless/veritas#67
Governing ADR: 0008

## Boundary

Woyengi exports a standalone, language-neutral `WorldBundle v0.1`. Veritas consumes that artifact without a running Woyengi service.

The adapter preserves meaning; it does not make Veritas a second canonical Woyengi substrate and does not import Veritas `HiddenOracle` into ordinary Woyengi state.

The P0-003 pinned WorldBundle fixture and its content hash are the final cross-language conformance artifact.

## Target Veritas structures

Current Veritas `main` exposes the relevant operational structures in `src/investigation_world/operational/models.py`:

- `TaskContract` — public objective, role, permitted systems, available actions, constraints and metadata;
- `PublicActionSpec` — public action name/kind/system/parameters/cost;
- `OperationalRecord` — public records/evidence with temporal/provenance metadata;
- `HiddenOracle` — private target state, invariants, required/forbidden actions, required evidence IDs, hidden action effects and budgets;
- `OperationalEpisode` — public task/records plus evaluator-private oracle;
- `OperationalEpisode.public_payload()` — deliberately excludes the oracle.

The adapter must use these semantics without changing their ownership.

## Required parity

| Woyengi meaning | WorldBundle location | Veritas target | Parity rule |
|---|---|---|---|
| World/bundle identity | bundle identity + source spec provenance | `OperationalEpisode.world_id` / task metadata | Preserve or deterministically derive an opaque stable identity. Do not substitute a private source identifier into public output. |
| Task identity | public member/task identity | `TaskContract.task_id`, `HiddenOracle.task_id` | Public and private sides must bind to the same task identity without leaking private labels. |
| Objective | `public.objective` | `TaskContract.objective` | Exact semantic preservation; no broadening, narrowing or model rewrite. |
| Actor/role | `public.actorRoles` | `TaskContract.role` and metadata if multiplicity must be preserved | A single Veritas role may be selected only by an explicit deterministic mapping. Additional roles must not be silently dropped; preserve them in adapter-owned metadata when Veritas has no first-class slot. |
| Action surface | `public.actionSurface[]` | `PublicActionSpec[]` | Preserve action identity/name and map action kind one-to-one: READ/WRITE/EXECUTE/COMMUNICATE/ESCALATE/SUBMIT -> lowercase Veritas enum. No hidden action may be added to the public tool surface. |
| Permitted systems | public descriptors/adapter mapping | `TaskContract.permitted_systems` | Derive only from public action/system descriptors. Never infer permission from evaluator-private effects. |
| Public observations/evidence | `public.observationRefs` and public asset descriptors/materialized public records | `OperationalRecord[]` | Preserve public identity/provenance. Private evaluator evidence locators must never become records or public metadata. |
| Artifact descriptors | `public.assetDescriptors[]` | record/artifact metadata consumed by Veritas native runtime | Preserve IDs, kinds, formats and hashes. Descriptor presence does not authorize fetching private bytes. |
| Public outcome requirements | `public.outcomeContractRefs` + portable public outcome material supplied by P0-003 artifact format | `TaskContract.success_description`, constraints/metadata | Public success semantics may be rendered but must not expose evaluator target answers. If a requirement cannot be represented losslessly in a first-class Veritas field, retain it in adapter-owned structured metadata and test round-trip parity. |
| Constraints | public outcome/contract constraints | `TaskContract.constraints` | Preserve every public constraint; no weakening or dropping. |
| Budget | portable outcome budget | `HiddenOracle.max_cost` / `max_tool_calls` when evaluator-enforced; public constraint/metadata when agent-visible | Enforcement placement must preserve visibility. A private evaluator budget must not become a new public hint; a public budget must remain public as well as enforced. Unit conversion must be explicit and lossless or fail closed. |
| Required evidence | public requirement plus private locator separation | `HiddenOracle.required_evidence_ids` and public task success/constraint metadata | The requirement may be public; the secret locator/answer must remain private. IDs used by the oracle must refer only to public records actually present to the episode. |
| Target assertions | `private-evaluator.targetAssertionRefs` plus private resolved material | `HiddenOracle.target_state` | Evaluator only. Must never appear in `public_payload()`, task metadata, records, action descriptions or identifiers that encode the answer. |
| Invariants | `private-evaluator.invariantRefs` plus private resolved material | `HiddenOracle.invariants` | Preserve comparison/severity/scope semantics exactly or reject unsupported input. Do not approximate. |
| Hidden action effects | `private-evaluator.hiddenEffectRefs` plus private resolved material | `HiddenOracle.action_effects` | Evaluator only; action names must correspond to declared public actions. Hidden effects do not widen the public action surface. |
| Private evidence locators | `private-evaluator.evidenceLocatorRefs` | adapter-private resolution only; ultimately oracle-required evidence bindings | Never serialize locator values into the public episode. Public artifacts must not enable private-byte retrieval. |
| Source provenance | `sourceSpecRef`, `sourceSpecVersion`, bundle provenance | adapter-owned episode metadata | Preserve provenance without exposing evaluator-private locators or Woyengi service dependencies. |
| Compatibility metadata | bundle compatibility | adapter validation before episode construction | Unsupported versions fail closed. Do not reinterpret unknown versions optimistically. |

## Visibility invariants

1. `OperationalEpisode.public_payload()` must contain no `HiddenOracle` material.
2. Public IDs must not be reversible encodings of private target answers, scenario labels, seeds, evidence locators or canonical private IDs.
3. Private target state, invariants, hidden effects and private evidence locators remain unavailable to the acting policy.
4. Public action descriptions/parameters may not be enriched from hidden effect knowledge.
5. Public records may carry evidence content needed to solve the task, but evaluator-private labels/locators remain absent.
6. A WorldBundle with no private-evaluator partition may create a public episode only if the requested Veritas use does not require hidden evaluator truth; the adapter must not synthesize oracle truth from guesses.

## Determinism and replay

For the same normalized pinned WorldBundle fixture and adapter version:

- imported public task semantics are deterministic;
- public record/artifact identities are deterministic;
- evaluator oracle semantics are deterministic;
- reset/replay produces the same initial episode semantics;
- adaptation does not contact Woyengi or any network service;
- unsupported or ambiguous mappings fail closed rather than producing a lossy episode.

Veritas may still use its own deterministic runtime representation after adaptation. The equality requirement is semantic parity, not shared in-memory types or a shared database.

## Mandatory falsifiers

P0-004 cannot pass if any of the following is possible:

1. changing only a private target assertion changes a public task/objective/action description;
2. a target assertion/invariant/private evidence locator appears anywhere in `public_payload()`;
3. a Woyengi public constraint disappears after adaptation;
4. an unsupported Woyengi action kind is silently coerced;
5. equivalent normalized fixtures adapt differently;
6. two distinct identity-bearing bundles collapse to one episode identity without an explicit content-bound rule;
7. a public artifact can resolve evaluator-private bytes;
8. the adapter requires a live Woyengi server;
9. a private-only budget becomes a public hint;
10. an agent-visible public budget is enforced privately but omitted from the public task;
11. a required evidence reference points to a record the agent cannot observe;
12. Veritas scientific/frontier qualification is inferred merely because a Woyengi bundle conforms.

## Cross-repo acceptance evidence

Final P0 parity requires all of:

1. P0-003 publishes one pinned language-neutral WorldBundle fixture and content hash;
2. Woyengi conformance verifier accepts it and rejects adversarial leakage variants;
3. Veritas adapter consumes the exact pinned fixture/hash;
4. Veritas deterministic/parity/replay tests pass;
5. Veritas public-payload leakage tests pass;
6. both repos' required relevant gates pass;
7. review confirms the certification/qualification ownership boundary from ADR 0008 remains intact.

No single repository may declare cross-product parity complete without evidence from the other side.
