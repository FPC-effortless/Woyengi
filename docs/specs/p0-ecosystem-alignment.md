# P0 Ecosystem Alignment Specification

Status: Approved direction / implementation in progress
Date: 2026-08-27
Work mode: Product engineering, with an RL-environment boundary for Veritas portability

## Problem

Woyengi already contains a functional persistent-state kernel, Work semantics, governed execution, Composer, package lifecycle, compute, context/memory/harness, surfaces, and runtime certification. Veritas independently contains a deterministic operational-world runtime, private evaluator truth, scientific qualification, capability evaluation, and distribution/export machinery.

The two systems share the same high-level thesis but do not yet share a canonical operational specification. The current Composer treats `AppBlueprint` as the primary compiled object, while the intended architecture requires persistent operational meaning to exist independently of any one human-facing App projection. Veritas also maintains an evaluation-specific substrate that must remain standalone and deterministic, but should be able to consume operational worlds produced from Woyengi without becoming a second source of canonical operational semantics.

## Intended outcome

Establish one language-neutral operational contract layer that allows Woyengi to preserve operational meaning while deriving Apps, Work configuration, agent/tool surfaces, and Veritas worlds as projections or portable artifacts.

The canonical lifecycle becomes:

```text
Observe reality
-> persistent semantic + epistemic state
-> ComprehensionModel
-> OperationalSystemSpec
-> Operational IR
-> OutcomeContract(s)
-> capability/procedure/binding composition
-> projection composition
-> execution
-> journal / handoff / recovery
-> independent verification
-> accepted outcome
-> operational learning
-> updated state / authority / autonomy
-> recomposition
```

`AppBlueprint` is a projection of an `OperationalSystemSpec`; it is not the canonical operational object.

## Scope

P0 includes:

1. `OperationalSystemSpec v0.1`.
2. `ComprehensionModel v0.1`.
3. provider-neutral Operational IR.
4. generalized `OutcomeContract`.
5. `WorldBundle v0.1`.
6. Woyengi -> Veritas portable adapter boundary.
7. explicit public/private world partition.
8. semantic parity and conformance tests.
9. `AppBlueprint` redefined as an application projection of `OperationalSystemSpec`.
10. ownership boundary between Woyengi runtime/package certification and Veritas scientific/frontier evaluation.

This spec also fixes ordering for later phases: P1 durable Work vertical, P2 Operational World Compiler, P3 Registry, P4 business Collections, P5 industry Collections, P6 enterprise, and P7 optional Cloud.

## Non-goals

- Do not replace Woyengi's canonical ledger, bitemporal state model, provenance, evidence, authority, Work, or governed execution semantics.
- Do not make Veritas depend on a running Woyengi server.
- Do not put Veritas private oracle truth into ordinary Woyengi governing state.
- Do not build P1-P7 product breadth before the P0 contract and parity seams exist.
- Do not introduce model-provider, storage-provider, UI-framework, cloud-provider, or domain-specific types into the operational contract.
- Do not make `OperationalSystemSpec` a mutable current-state database. It is a versioned operational definition derived from and linked to persistent state/evidence.

## Reconstructed context and assumptions

- Woyengi's constitutional kernel already owns identity, bitemporal semantic history, provenance, evidence, authority, lifecycle, workspace isolation, canonical commits, execution journals, and verification-result meaning.
- `packages/composer` already compiles `AppIntent -> SoftwareRequirementGraph -> CompositionPlan -> AppBlueprint` and prefers do-nothing/reuse/configure/compose/adapt/extend before generation.
- `packages/effects` already provides the governed execution spine through observed effects, reconciliation, independent verification, accepted outcome, and verified semantic commit.
- `packages/evaluation` is runtime/package conformance and certification, not a substitute for Veritas scientific qualification.
- Veritas must preserve deterministic reset, sealed private evaluator truth, standalone execution, HUD/Prime portability, and benchmark secrecy.
- The public portable boundary must be usable without Woyengi-operated infrastructure.

## Governing invariants and authority constraints

1. State remains reconstructed from typed history; a comprehension/specification is never automatically authoritative because a model produced it.
2. Observation, claim, projected state, comprehension, operational specification, projection, and evaluator oracle are distinct representations.
3. Valid time remains distinct from transaction time wherever operational facts are represented.
4. Authority remains distinct from confidence.
5. Conflicts and unknowns remain inspectable rather than normalized away.
6. Generated/synthetic gap filling must retain provenance and assumption status.
7. Agent-produced specification changes are proposals until authorized and verified.
8. App projections may narrow or render operational meaning but may not silently redefine the source `OperationalSystemSpec`.
9. Veritas private oracle state is evaluator-owned and cannot flow into an agent-visible/public `WorldBundle` partition.
10. Replay/simulation of operational definitions or traces must not reissue semantic or external effects.

## Canonical model

### ComprehensionModel

A structured interpretation of intent and relevant reconstructed state. It contains at minimum:

- identity/reference and workspace scope;
- intent/objective;
- actors and relevant subjects;
- relevant-state references;
- history references;
- requirements and constraints;
- invariants;
- rationale;
- assumptions;
- unknowns;
- conflicts;
- evidence/provenance references;
- confidence annotations that do not imply authority.

A `ComprehensionModel` is evidence-bearing intermediate state, not a governing operational specification by itself.

### OutcomeContract

A provider-neutral success contract usable by Work, Apps, agents, procedures, package certification, and world compilation. It contains:

- objective;
- success assertions;
- invariants/constraints;
- required evidence;
- verification requirements;
- allowed/forbidden effect classes or effect constraints;
- budget/attempt/termination constraints where applicable;
- acceptance authority requirements.

The generalized contract must not assume that every outcome is a benchmark reward or a UI result.

### OperationalSystemSpec

The canonical persistent operational definition. It contains references/definitions for:

- goals;
- requirements;
- invariants;
- actors/roles;
- capabilities;
- authority requirements;
- procedures;
- outcome contracts;
- epistemic/unknown/conflict state;
- external-system bindings;
- resources;
- attention/trigger rules;
- lifecycle rules;
- projection requirements;
- provenance and source comprehension references.

The spec is versioned, immutable as a public value, provider-neutral, and workspace-scoped when installed/instantiated.

### Operational IR

A normalized, execution/composition-oriented representation compiled from an `OperationalSystemSpec`. It must preserve references back to the source spec and distinguish at least:

- entities/resources;
- activities/operations;
- dependencies;
- capabilities/providers required;
- procedures;
- authority/policy gates;
- outcome contracts;
- verification gates;
- external bindings;
- projection requirements.

The IR is disposable/rebuildable from its source spec plus versioned compiler semantics; it is not a second canonical truth store.

### WorldBundle

A language-neutral portable artifact for executing or evaluating a bounded operational world. `WorldBundle v0.1` contains:

- contract/version identity;
- source `OperationalSystemSpec` identity/version;
- public operational definition and observations needed by the consumer;
- deterministic asset/artifact descriptors;
- action/tool surface;
- transition/runtime descriptors where portable;
- verifier/public success-contract descriptors;
- provenance and compatibility metadata;
- explicit partition manifest.

The bundle has separate partitions:

- **public**: safe for the policy/agent/runtime consumer;
- **private-evaluator**: optional evaluator-only material used by Veritas or another authorized evaluator.

No public artifact may reference private bytes by an accessible locator or expose private target/oracle content.

## State and effect model

The operational contract layer defines meaning and requirements; it does not perform consequential effects.

```text
Persistent state
  -> comprehension proposal
  -> authorized/verified operational spec
  -> rebuildable IR
  -> projection/world compilation
  -> governed execution
  -> observed effects/reconciliation
  -> evidence/verification
  -> accepted semantic commit
```

Changing a spec is a semantic proposal/change. Executing a procedure can produce runtime, semantic, and external effects through the existing governed execution spine. Compiling an IR, App projection, or WorldBundle is computational and must not implicitly execute external effects.

## Key implementation decisions

### Decision 1: new contract package, not core pollution

Create a dependency-light package for operational contracts rather than adding product/domain concepts to `packages/core`.

### Decision 2: AppBlueprint becomes a projection

The Composer will eventually compile:

```text
ComprehensionModel
-> OperationalSystemSpec
-> Operational IR
-> CompositionPlan
-> AppBlueprint projection
```

Existing composition preference ordering remains unchanged.

### Decision 3: portable artifact boundary to Veritas

Veritas consumes `WorldBundle`/portable schemas or an adapter representation. Veritas does not share Woyengi's live database and Woyengi does not import Veritas's hidden oracle as governing state.

### Decision 4: evaluation ownership remains separate

Woyengi owns runtime/package conformance, effect correctness, replay safety, compatibility, and evaluated-scope certification. Veritas owns scientific benchmark qualification, frontier qualification, capability measurement, longitudinal observation, model/intervention comparison, training-value evidence, and benchmark secrecy.

## Rejected alternatives

- **Make AppBlueprint canonical**: rejected because operational meaning would remain coupled to one human-facing software projection.
- **Move Veritas onto Woyengi's live runtime/database**: rejected because it damages standalone distribution, deterministic reset, private oracle isolation, and marketplace portability.
- **Promote Veritas's dictionary substrate to Woyengi canonical state**: rejected because it loses Woyengi's richer bitemporal/evidence/authority/conflict semantics.
- **Duplicate the operational compiler in both repositories**: rejected; Woyengi owns the canonical portable contract/compiler, Veritas owns the adapter and evaluator-specific extension.
- **Put the operational contracts into `packages/core`**: rejected because the kernel must remain minimal and domain-neutral; operational composition is a higher-level constitutional layer.

## Migration / replay / rollback implications

- Existing `AppIntent`, `SoftwareRequirementGraph`, and `AppBlueprint` contracts require a compatibility migration rather than deletion.
- `AppBlueprint v1` can gain a required or transitional source-spec reference before a future version removes legacy direct-intent assumptions.
- Existing Apps remain installable during the migration; the compiler can synthesize a minimal operational spec around legacy inputs until explicit migration completes.
- Operational IR and projections must be reproducible from the same source spec/compiler version.
- WorldBundle generation must be deterministic for equivalent normalized inputs.
- No replay path may reissue external effects.

## Test / falsification seams

P0 must include tests that falsify the following:

1. a spec with duplicate or dangling references is accepted;
2. a spec embeds provider-specific implementation names in provider-neutral requirement fields;
3. authority/confidence or evidence/provenance are conflated;
4. `AppBlueprint` cannot be traced to a source `OperationalSystemSpec`;
5. a public WorldBundle leaks private evaluator content or locators;
6. equivalent normalized inputs produce non-deterministic spec/IR/bundle identities;
7. Veritas adapter changes public task semantics or loses target/invariant parity;
8. Woyengi runtime certification is presented as scientific/frontier qualification, or vice versa.

## Acceptance criteria

P0 is complete when:

- versioned `ComprehensionModel`, `OutcomeContract`, `OperationalSystemSpec`, Operational IR, and WorldBundle contracts exist behind public package seams;
- constructors/validators enforce immutability, stable IDs, reference integrity, and provider-neutrality where specified;
- Composer emits an `OperationalSystemSpec` and `AppBlueprint` explicitly references it as its source projection;
- a WorldBundle can be deterministically partitioned into public and evaluator-private forms without leakage;
- Veritas can load the portable bundle through an adapter and semantic parity tests cover objectives, actions, constraints, target assertions/invariants, evidence requirements, and identifiers without requiring a Woyengi server;
- ownership/evaluation boundaries are documented and reflected in package naming/docs;
- targeted tests, typecheck, boundaries, full test suite, and relevant benchmark/conformance gates pass;
- human acceptance is still required before any `passes` flag or production-ready claim is changed.

## Human QA / authority gates

Human acceptance must confirm:

- `OperationalSystemSpec` is the canonical persistent operational definition above App projections;
- the Woyengi/Veritas boundary preserves Veritas independence and private evaluator secrecy;
- no existing product data or authority is silently migrated;
- no release-readiness claim is made as part of P0.

## Unresolved risks

- Exact schema serialization format (JSON Schema files versus generated TypeScript/Python schema packages) should remain implementation-reversible in the first slice.
- `OutcomeContract` overlaps the current execution `VerificationContract`; the first implementation must keep outcome semantics broader and avoid creating two names for the same execution-only concept.
- A future compiler may require versioned synthesis policies so generated assumptions remain replayable/auditable.
- Cross-language semantic parity can drift if TypeScript is treated as the schema source without an explicit portable schema contract.

## Ordered delivery

### P0

1. P0-001 canonical operational contracts.
2. P0-002 App projection migration.
3. P0-003 WorldBundle partition and conformance.
4. P0-004 Woyengi -> Veritas adapter and semantic parity.
5. P0-005 evaluation ownership/certification boundary hardening.

### P1

Durable workspace/work/app persistence -> principal sessions -> live execution API -> GitHub connector -> real sandbox -> realtime transport -> live shell -> coding-first E2E.

### P2

Evidence -> normalize -> entity resolution -> state reconstruction -> procedure inference -> authority inference -> constraint/invariant extraction -> causal modeling -> unknown/conflict identification -> constrained synthesis -> consistency validation -> `OperationalSystemSpec`, then compile to Work and Veritas.

### P3

Technical Registry: publish, discover, resolve versions/dependencies, verify signatures/certification, distribute packages and world-capability artifacts.

### P4

Business Collections: Customers, Operations, Finance, People, Compliance.

### P5

Industry Collections: Construction first, then hospitality/manufacturing, with Veritas/ProjectWorld evaluation where applicable.

### P6

Enterprise: SSO, SCIM, advanced ABAC, residency, retention, BYOC/deployment policy.

### P7

Optional Woyengi Cloud only after the self-hosted path is production-credible.
