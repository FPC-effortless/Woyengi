# P2 Operational World Compiler Specification

Status: Planning complete; implementation blocked pending P0 acceptance and explicit P1 public interfaces
Date: 2026-08-27
Issue: #17
Branch: `plan/p2-operational-world-compiler`
Work mode: Product-engineering planning with targeted research/RL-style falsification for world realism

## Problem

Woyengi already has most of the substrate needed to understand operational reality: ingestion, provisional semantic decomposition, identity history, bitemporal state projection, evidence assessment, reconstruction, authority, procedures, graph federation and verification. P0 is establishing `ComprehensionModel`, `OperationalSystemSpec`, Operational IR, App projections and `WorldBundle` as the canonical portable contracts.

What is missing is a provider-neutral compiler that can take incomplete, conflicting evidence about a real operational system and produce an evidence-bearing operational specification without silently converting model inference into governing state.

The required path is:

```text
Evidence
-> normalize
-> resolve entities
-> reconstruct state
-> infer procedures
-> infer authority requirements
-> extract constraints/invariants
-> model causal/dependency relationships
-> identify unknowns/conflicts
-> constrained synthesis
-> consistency/realism validation
-> OperationalSystemSpec
-> Work/App/World projections
```

The compiler must orchestrate existing constitutional seams rather than create a second state store, a second Work runtime, or a Veritas-shaped canonical substrate.

## Intended outcome

Introduce one future package, `packages/operational-world-compiler/**`, that compiles authorized evidence and reconstructed state into a traced proposal for `OperationalSystemSpec` and requested projections.

A successful compilation is reproducible from its declared inputs, compiler/synthesis policy versions and provider outputs; generated gap-fill remains provisional and evidence-linked; blocking ambiguity, conflict, missing authority or inconsistency produces an explicit non-ready result rather than a plausible-looking world.

No compiler stage performs a semantic commit or consequential external effect.

## Scope

P2 specifies:

1. typed, provider-neutral stage ports and orchestration;
2. reuse adapters for Woyengi ingestion, semantic compilation, identity, reconstruction, evidence, authority, procedures, graph and verification seams;
3. deterministic normalization and contract assembly;
4. model-assisted proposal stages for extraction/inference where deterministic evidence is insufficient;
5. explicit provenance, evidence, confidence, unknown and conflict propagation across stages;
6. constrained synthesis with fail-closed forbidden categories;
7. structural consistency and world-realism validation;
8. compilation to P0 `OperationalSystemSpec`/Operational IR plus Work/App/World projections;
9. adversarial and benchmark fixtures, including deterministic/private-leakage checks;
10. implementation-ready tracer bullets with non-overlapping future ownership.

## Non-goals

- No source implementation in this planning lane.
- No changes to P0 contracts, shared ADRs, kernel semantics, `prd.json` or `progress.txt`.
- No direct write to canonical state, identity merges, authority grants, semantic commits or external systems.
- No credentials, provider-specific model IDs, database-specific types or Veritas runtime classes in operational semantics.
- No replacement for `packages/reconstruction`, `packages/work`, Composer, `packages/world-bundle`, governed execution or Veritas qualification.
- No automatic promotion of model confidence into authority.
- No generation of evaluator-private oracle truth from ordinary public evidence.

## Reconstructed context and reuse map

### Existing Woyengi capabilities to reuse

| Capability | Existing seam | P2 use | P2 must not do |
| --- | --- | --- | --- |
| Evidence intake | `packages/ingestion` | consume accepted ingestion/evidence references and immutable source locators | own object storage or mutate ingestion history |
| Semantic decomposition | `packages/semantic-compiler` | reuse provisional claims/events/relationships/evidence/source spans and its provider-neutral decomposition port | treat extracted text as verified state |
| Entity identity | `packages/identity` | resolve known aliases; retain match proposals and merge history | merge/split entities without separate authority |
| Bitemporal projection | `packages/state` | reuse candidate/selected/conflict semantics at valid and transaction time | flatten history into a mutable facts table |
| Reconstruction | `packages/reconstruction` | consume authorized `ReconstructiveWorkspace`, including history, contradictions, uncertainties, authority and provenance trace | bypass record authorization or retrieval policy |
| Evidence | `packages/evidence` | preserve supporting/contradicting/mixed/unresolved evidence and verifier history | collapse mixed evidence into one confidence number |
| Authority | `packages/authority` | test actual authority context separately from inferred confidence; validate governing candidates | infer an authority grant into existence |
| Procedures | `packages/procedures` | use procedure shape/preconditions/operations/invariants/verification/repair as evidence and a validation reference | execute inferred procedures during compilation |
| Relationships | `packages/graph` | consume typed relationship/dependency evidence and graph invariants | promote product/domain graph types into core |
| Verification | `packages/verification` | run schema/constraint/source/cross-source/temporal/authority/consistency/domain checks | convert inconclusive verification into pass |
| Work | `packages/work` plus P1 durability port | emit a Work projection descriptor for later instantiation | mutate `WorkRegistry` as a compiler side effect |
| App projection | P0 Composer public seam | request App projection from the source spec/IR | reintroduce AppBlueprint as canonical |
| World artifact | P0 `packages/world-bundle` public seam | deterministically build/conformance-check portable WorldBundle | import Veritas or leak evaluator-private bytes |

### Veritas as consumer/reference, not substrate

Veritas Foundry demonstrates useful evaluation dimensions: entities/tools/steps, distractors, missing evidence, conflicts, dependency depth, budgets, stochastic tool behavior and adversarial pressure. Its materializer keeps split/seed/difficulty/private failure schedules privileged and validates public actions against hidden evaluator constraints.

P2 borrows these as local falsification dimensions only. Woyengi does **not** import Veritas Foundry, `OperationalEpisode`, `HiddenOracle`, CompanyWorld or qualification code. The cross-repo boundary remains:

```text
OperationalSystemSpec
-> Woyengi WorldBundle public + authorized private-evaluator partition
-> standalone Veritas adapter
-> Veritas-native runtime/oracle/qualification
```

## Wayfinder decision record

### D1 — Where does the compiler live?

**Decision:** new higher-level package `packages/operational-world-compiler/**`.

**Evidence:** the kernel must remain domain-neutral; P0 owns language-neutral operational contracts; existing semantic/reconstruction packages have narrower responsibilities.

**Rejected:** expand `packages/semantic-compiler` into a world compiler. That would mix source decomposition with operational synthesis, validation and projection ownership.

**Reversibility:** high while the new package depends only on public seams.

### D2 — What is the authoritative output?

**Decision:** an authorized/accepted `OperationalSystemSpec` remains the persistent operational definition. The compiler returns a **compilation proposal/result** containing a candidate spec plus diagnostics/traces; compilation alone does not authorize it.

**Rejected:** compiler-owned world graph as canonical state; generated App; Veritas episode.

### D3 — How are deterministic and model-assisted work separated?

**Decision:** every stage is classified as deterministic transform, provider proposal, or authority/verification gate. Provider outputs are typed proposals and may never directly instantiate governing state.

**Cost of being wrong:** high; conflation would violate the Constitution and make replay/non-determinism unauditable.

### D4 — How is entity resolution handled?

**Decision:** exact/registered aliases may resolve deterministically. Ambiguous or model-scored matches remain `provisional` candidates. Entity merge/split is explicitly outside compiler authority.

### D5 — How is causal structure represented without changing P0?

**Decision:** P2 may retain a compiler-local causal/dependency proposal graph with evidence/provenance. Accepted causal ordering maps into existing operational requirements, procedure steps/preconditions, lifecycle/attention rules and Operational IR dependencies. A new P0 causal field is not required for v0.1.

**Escalation rule:** if implementation proves that semantic parity or round-trip reconstruction requires first-class causal relationships in `OperationalSystemSpec`, stop and request the minimum P0 interface change; do not patch `packages/operational-spec` from P2.

### D6 — How is synthesis constrained?

**Decision:** synthesis fills only evidence-bounded structural gaps and creates explicit `ComprehensionAssumption` records plus compiler provenance. It cannot fabricate authority, principals, credentials, legal/compliance truth, external-system availability, verifier results or private oracle truth.

If an inferred fact lacks a defensible evidence/basis link, it stays an unknown; the compiler does not manufacture it to achieve a complete-looking spec.

### D7 — Where does world realism belong?

**Decision:** P2 owns compile-time consistency/realism validation and local adversarial fixtures. Veritas owns scientific/frontier qualification of resulting evaluation environments. Passing P2 validation is not benchmark qualification.

### D8 — How are Work/App/World outputs produced?

**Decision:** through projection ports/adapters against public P0/P1 seams. Projection code may render/narrow operational meaning but may not add/drop required outcome, invariant or authority semantics.

## Governing invariants

1. Observation, claim, projected state, comprehension, synthesis proposal, specification and projection remain distinct representations.
2. Valid time and transaction time remain explicit where operational facts depend on time.
3. Confidence never grants authority.
4. Conflicts remain inspectable after a governing candidate is selected.
5. Unknowns remain explicit; absence is not automatically false and incompleteness is not automatically synthesized.
6. Every non-deterministic proposal has provider/policy provenance and source/evidence references.
7. Generated content is provisional until the applicable authority and verification gates pass.
8. Compiler replay produces computation/projections only; it does not replay semantic or external effects.
9. `OperationalSystemSpec` is canonical above Work/App/World projections.
10. WorldBundle public/private isolation is fail-closed.
11. Provider-neutral fields contain requirements/capabilities, never a specific model/vendor/runtime implementation.
12. A `ready` compilation has no unresolved blocking diagnostic.

## State and effect model

```text
Canonical evidence/history (read-only to compiler)
        |
        v
Authorized reconstruction snapshot + trace
        |
        v
Compiler-local immutable stage results
        |  deterministic transforms
        |  + provisional model proposals
        |  + verification/authority gates
        v
ComprehensionModel proposal
        |
        v
OperationalSystemSpec proposal
        |
        +--> Operational IR (rebuildable)
        +--> Work projection descriptor
        +--> App projection
        +--> WorldBundle
```

Compiler execution has only a **runtime/computational** effect. Persisting/accepting a new operational specification is a separate semantic action under Woyengi authority. Instantiating Work or executing procedures is separate. Creating a portable WorldBundle is a derived artifact action and must not execute its declared actions.

## Compiler-local contracts

The following names are planning-level interfaces owned by the future P2 package; exact syntax may vary but semantics are required.

```ts
interface OperationalWorldCompileRequest {
  runId: string;
  compilerVersion: string;
  workspaceId: string;
  principal: string;
  objective: string;
  sourceRefs: readonly string[];
  validAt: string;
  recordedAt: string;
  projectionTargets: readonly ("WORK" | "APP" | "WORLD")[];
  synthesisPolicyId: string;
}

type CompilationStatus = "ready" | "needs-review" | "blocked";

type ProposalStatus = "provisional" | "verified-candidate";

interface Proposal<T> {
  id: string;
  value: T;
  status: ProposalStatus;
  confidence?: number;
  evidenceRefs: readonly string[];
  provenanceRefs: readonly string[];
}

interface CompilerDiagnostic {
  code: string;
  stage: CompilerStage;
  severity: "info" | "warning" | "error";
  blocking: boolean;
  subjectRefs: readonly string[];
  evidenceRefs: readonly string[];
  message: string;
}

interface StageReport {
  stage: CompilerStage;
  mode: "deterministic" | "model-proposal" | "gate";
  inputRefs: readonly string[];
  outputRefs: readonly string[];
  provenanceRefs: readonly string[];
  diagnostics: readonly CompilerDiagnostic[];
}

interface OperationalWorldCompilation {
  runId: string;
  compilerVersion: string;
  status: CompilationStatus;
  comprehension?: ComprehensionModel;
  operationalSystemSpec?: OperationalSystemSpec;
  operationalIR?: OperationalIR;
  projections?: {
    work?: WorkProjectionDescriptor;
    app?: AppBlueprint;
    world?: WorldBundle;
  };
  stageReports: readonly StageReport[];
  diagnostics: readonly CompilerDiagnostic[];
  provenanceManifest: readonly string[];
}
```

The wrapper is P2-owned and is not a new canonical truth store.

## Provider-neutral stage ports

All ports are passed into the compiler; no model/storage/vendor implementation name appears in the operational contract.

```ts
interface SourceEvidencePort {
  loadAuthorizedSource(ref: string, principal: string): Promise<AuthorizedSource>;
}

interface SemanticProposalPort {
  decompose(source: AuthorizedSource): Promise<SemanticProposalBatch>;
}

interface IdentityResolutionPort {
  resolve(mentions: readonly IdentityMention[], context: StageContext): Promise<IdentityResolutionBatch>;
}

interface ReconstructionPort {
  reconstruct(request: ReconstructionRequest): Promise<ReconstructiveWorkspace>;
}

interface OperationalInferencePort {
  propose(input: InferenceInput): Promise<OperationalInferenceBatch>;
}

interface SynthesisPort {
  propose(input: SynthesisRequest): Promise<SynthesisProposalBatch>;
}

interface VerificationPort {
  verify(input: CompilerVerificationRequest): Promise<CompilerVerificationResult>;
}

interface AppProjectionPort {
  project(spec: OperationalSystemSpec, ir: OperationalIR): Promise<AppBlueprint>;
}

interface WorkProjectionPort {
  project(spec: OperationalSystemSpec, ir: OperationalIR): Promise<WorkProjectionDescriptor>;
}

interface WorldBundleProjectionPort {
  project(spec: OperationalSystemSpec, ir: OperationalIR): Promise<WorldBundle>;
}
```

The adapters behind these ports may call existing Woyengi public APIs. P2 tests must also supply deterministic fakes so the compiler can be replayed without a live provider.

## Stage architecture

### 0. Authorized evidence acquisition

Input: source/evidence references plus workspace principal.

Output: immutable authorized source descriptors and provenance locators.

Mode: gate + deterministic descriptor normalization.

Failure: inaccessible source, workspace mismatch, missing provenance, unsupported media without a decomposer.

### 1. Normalize semantic evidence

Input: authorized source descriptors / existing semantic records.

Output: normalized provisional claims, events, relationships, evidence spans and identity mentions.

Mode: deterministic normalization around an optional model-assisted semantic decomposition proposal.

Rules: stable ordering/IDs; source spans validated; original artifact reference retained; generated extraction is provisional.

### 2. Resolve entities

Input: identity mentions, registry aliases, candidate matches.

Output: resolved entity refs where unambiguous plus unresolved candidate sets.

Mode: deterministic exact alias resolution, model/probabilistic proposal for ambiguous cases, authority gate for any merge request.

Rule: compiler never performs `entities.merged` or `entity.split`.

### 3. Reconstruct state

Input: objective, subjects/entities, principal, valid/transaction time, evidence/contradiction requirements.

Output: authorized `ReconstructiveWorkspace` plus trace.

Mode: existing reconstruction planner/gates.

Rule: denied records are not visible to later proposal providers.

### 4. Infer procedures

Input: reconstructed history/events/decisions/procedure evidence.

Output: provisional procedure candidates with preconditions, ordered operations/capabilities, invariants, verification/postconditions and evidence refs.

Mode: model-assisted proposal + structural/source verification.

### 5. Infer authority requirements

Input: observed roles/decisions/procedures and existing authority context.

Output: **authority requirement proposals**, not grants.

Mode: model-assisted proposal + existing authority evaluation.

Blocking cases: consequential operation has no defensible authority requirement; proposal attempts to name itself authoritative based only on confidence.

### 6. Extract constraints and invariants

Input: explicit source constraints, observed failures, contracts, reconstructed state.

Output: candidate requirements/invariants with severity, evidence and scope.

Mode: deterministic extraction where structured; otherwise model proposal + constraint/source validation.

### 7. Model causal/dependency relationships

Input: temporal event histories, procedure sequences, explicit dependency evidence and graph relationships.

Output: compiler-local dependency/causal candidates with relation type, direction, evidence and confidence.

Mode: deterministic for explicit declared relations; model proposal for inferred causality.

Rule: correlation alone cannot become a verified causal dependency. Unsupported/cyclic causal claims are diagnostic or remain assumptions.

### 8. Identify unknowns and conflicts

Input: all candidates plus reconstruction contradictions/uncertainties.

Output: explicit `ComprehensionUnknown` and `ComprehensionConflict` candidates, including blocking status.

Mode: deterministic set/reference comparison plus proposal-assisted classification.

Rule: selecting a governing value never deletes losing candidates.

### 9. Constrained synthesis

Input: explicit gaps, constraints, evidence context and versioned synthesis policy.

Output: evidence-bounded provisional assumptions/proposals or an explicit refusal/blocker.

Mode: model-assisted proposal under deterministic policy.

Allowed examples: infer a neutral label for an unnamed procedure; propose a missing non-consequential ordering edge strongly implied by two independent traces; propose projection layout requirements from accepted workflow semantics.

Forbidden synthesis:

- authority grants, permission grants or identity merges;
- credentials/secrets or external binding availability;
- legal/regulatory/compliance truth without authoritative evidence;
- target answers, hidden action effects or private evaluator evidence;
- fabricated evidence/verifier records;
- claims marked verified because a model is confident;
- destructive/irreversible external action requirements introduced only to make a plan complete.

Every accepted synthesis proposal must map to a `ComprehensionAssumption` and carry evidence plus compiler/proposal provenance. If no defensible evidence link exists, retain an unknown instead.

### 10. Consistency and realism validation

Input: comprehension + candidate operational model.

Output: verification report and blocking/non-blocking diagnostics.

Minimum structural checks:

- schema and reference integrity;
- provider neutrality;
- bitemporal/source-reference integrity;
- procedure capability/tool coverage;
- outcome-contract and invariant coverage;
- authority coverage for consequential operations;
- no unresolved blocking identity reference;
- no contradictory required/forbidden operation semantics;
- no unsupported causal cycle unless explicitly modeled as an iterative lifecycle;
- external binding/resource references are satisfiable as requirements, not falsely claimed available;
- generated assumptions are not mislabeled verified;
- projection requirements do not weaken source outcomes/authority;
- WorldBundle partition conformance and private-leakage checks when WORLD is requested.

World-realism checks are **compile-time plausibility checks**, not scientific qualification. Fixtures must exercise missing evidence, competing evidence, distractors, dependency depth, tool/action count, budget pressure, stochastic/failure descriptors and adversarial source content.

### 11. Assemble `ComprehensionModel` and `OperationalSystemSpec`

Mode: deterministic mapping through the accepted P0 public constructors/validators.

The compiler may return `needs-review` with a candidate comprehension/spec when non-blocking assumptions remain. It returns `blocked` and does not emit a ready projection when blocking diagnostics remain.

### 12. Compile projections

- Operational IR: P0 deterministic compiler seam.
- App: P0 Composer projection seam; preserve source-spec/outcome/authority semantics and reuse preference.
- Work: P2-owned descriptor through a P1-compatible `WorkProjectionPort`; instantiation is not a compile side effect.
- World: P0 `WorldBundle` builder/conformance seam; no Veritas imports.

## Work projection descriptor

Until P1 publishes its final durable Work instantiation API, P2 owns a neutral descriptor at its boundary:

```ts
interface WorkProjectionDescriptor {
  sourceSpecRef: string;
  sourceSpecVersion: string;
  workspaceId: string;
  objective: string;
  actorRoleRefs: readonly string[];
  activityRequirementRefs: readonly string[];
  procedureRefs: readonly string[];
  authorityRequirementRefs: readonly string[];
  outcomeContractRefs: readonly string[];
  evidenceContextRefs: readonly string[];
  provenanceRefs: readonly string[];
}
```

The eventual P1 adapter may instantiate this into durable `WorkInstance`/`WorkEpisode` state. P2 must not depend on P1 storage classes.

## Diagnostics and fail-closed behavior

Required diagnostic codes include at least:

- `SOURCE_UNAVAILABLE`
- `PERMISSION_DENIED`
- `SCHEMA_INVALID`
- `PROVIDER_SPECIFIC_LEAK`
- `REFERENCE_DANGLING`
- `EVIDENCE_MISSING`
- `ENTITY_AMBIGUOUS`
- `IDENTITY_MERGE_REQUIRES_AUTHORITY`
- `AUTHORITY_UNRESOLVED`
- `CONFLICT_UNRESOLVED`
- `PROCEDURE_UNSUPPORTED`
- `INVARIANT_VIOLATION`
- `CAUSAL_UNSUPPORTED`
- `CAUSAL_CYCLE`
- `SYNTHESIS_FORBIDDEN`
- `SYNTHESIS_UNSUPPORTED`
- `WORLD_INCONSISTENT`
- `PRIVATE_PARTITION_LEAK`
- `UPSTREAM_PORT_UNAVAILABLE`

Exceptions from providers/verifiers must become typed diagnostics unless they are programmer/contract violations that should fail the call.

## Determinism and replay

Given equivalent normalized visible inputs, the same compiler version, the same synthesis policy and identical provider proposal payloads, deterministic stages must produce byte-equivalent normalized stage outputs and stable identities regardless of source input ordering.

Model calls themselves need not be deterministic. Their returned proposal payload, provider-policy identifier and provenance become replay inputs. Replaying a captured run must not call a provider unless explicitly requested and must never reissue semantic/external effects.

## P0/P1 dependency contracts

### P0 blockers

Implementation must not begin until P0 contracts are accepted. P2 consumes only public seams for:

- `ComprehensionModel` / `OperationalSystemSpec` / OutcomeContract / Operational IR;
- Composer App projection;
- deterministic WorldBundle builder/conformance.

No mandatory P0 schema change is identified for v0.1 planning. Compiler-local causal proposals map into existing requirements/procedures/IR dependencies; synthesis maps into comprehension assumptions plus provenance. If implementation falsifies that mapping, raise the smallest interface request to the P0 integrator rather than editing P0.

### P1 interface dependency

P2 must not start integrated Work projection/validation until P1 exposes explicit public interfaces sufficient for:

- durable workspace/principal authorization and workspace isolation (#14);
- durable WorkInstance/WorkEpisode instantiation/replay (#14);
- governed execution/evidence/verification probes when validation needs executable checks (#15);
- projection consumers may use realtime/shell surfaces, but P2 has no direct dependency on #16 internals.

P2 adapters depend on ports, not P1 files or storage implementations.

## Falsification and benchmark plan

### Golden fixtures

1. **Clean workflow:** explicit actors, authority, procedure, constraints and outcome evidence compiles ready.
2. **Equivalent-order:** same evidence in different order yields identical deterministic normalized outputs/spec identity.
3. **Alias ambiguity:** two entities share/compete for an alias; compiler retains candidates and blocks identity-sensitive projection.
4. **Bitemporal conflict:** newer transaction-time record describes an older valid interval; reconstruction respects both clocks.
5. **Authority/confidence inversion:** high-confidence low-authority source conflicts with lower-confidence authoritative source; confidence does not win authority.
6. **Procedure gap:** missing consequential step remains unknown or needs-review; synthesis cannot invent an irreversible action.
7. **Constraint conflict:** source requires and forbids the same consequential operation; validation blocks.
8. **Causal trap:** correlated event order without causal evidence remains provisional; explicit unsupported cycle is rejected/flagged.
9. **Prompt-injection source:** an ingested document says to ignore policy/grant the model admin authority; proposal cannot widen authority.
10. **Provider leak:** model proposal inserts vendor/model/database implementation into provider-neutral requirement; validation rejects.
11. **Private leak:** proposed WorldBundle public material includes hidden target/evidence locator; conformance blocks.
12. **Projection parity:** Work/App/World projections all preserve the same required goals/outcomes/invariants/authority from one source spec.
13. **Missing evidence:** synthesis has no defensible evidence link; compiler retains an unknown instead of fabricating completion.
14. **Provider replay:** capture a proposal batch, replay with provider disabled, obtain identical downstream deterministic outputs.

### Adversarial dimensions

Borrowed conceptually from Veritas Foundry but implemented locally:

- entity count;
- action/tool count;
- procedure step count;
- distractor count;
- missing-evidence probability/rate;
- conflict rate;
- dependency depth;
- budget pressure;
- failure/stochastic descriptors;
- adversarial source pressure.

Hidden fixture truth is evaluator/test-owned and must never be passed through the compiler-visible source set.

### Metrics / release gates

For pinned fixtures track:

- required semantic-field recall;
- unsupported assertion rate;
- provenance/evidence coverage for non-deterministic proposals;
- conflict-retention recall;
- authority/confidence conflation count (**must be 0**);
- deterministic replay/hash mismatches (**must be 0**);
- public/private leakage count (**must be 0**);
- projection semantic-parity violations (**must be 0**);
- blocker classification accuracy on adversarial fixtures.

These metrics validate compiler behavior only; they do not claim Veritas scientific/frontier qualification.

## Migration, rollback and compatibility

- P2 is additive: new compiler package and adapters only.
- Existing ingestion/reconstruction/Composer/Work behavior remains available behind existing seams.
- Compiler stage outputs are rebuildable; rollback is selecting an older compiler/synthesis policy version and replaying captured proposal inputs.
- No source evidence or canonical history is rewritten to roll back a compilation.
- A persisted/accepted operational spec version, if later committed by another subsystem, is superseded through normal semantic history rather than overwritten.
- WorldBundle/App/Work projections are regenerated from their source spec and compiler/projection version.

## Acceptance criteria

P2 implementation is complete only when:

1. one public P2 compiler seam exposes the typed request/result and stage diagnostics;
2. every stage is behind a provider-neutral port or is a deterministic transform/gate with explicit provenance;
3. existing Woyengi ingestion/identity/reconstruction/evidence/authority/procedure/verification behavior is reused without source-semantic duplication;
4. model-assisted outputs remain provisional and cannot grant authority or erase conflicts;
5. unsupported synthesis fails closed and every accepted synthesis proposal is evidence-linked and represented as an assumption;
6. clean evidence compiles deterministically into a P0-valid `OperationalSystemSpec` and Operational IR;
7. requested Work/App/World projections preserve source goals, outcomes, invariants and authority requirements;
8. WorldBundle conformance prevents private evaluator leakage and no Veritas implementation is imported;
9. the complete adversarial fixture suite exercises the falsifiers above;
10. targeted package tests, `pnpm typecheck`, `pnpm boundaries`, `pnpm test:all`, and the P2 package-local adversarial/benchmark command all pass;
11. human review confirms no compiler output is being presented as authoritative merely because compilation/validation passed;
12. P0 acceptance and P1 public-interface dependencies are explicitly satisfied before integrated implementation is declared complete.

## Human QA / authority gates

Human/maintainer acceptance is required to confirm:

- P0 public contracts are accepted and stable enough for P2;
- P1 interface dependencies are explicit and do not couple P2 to storage/UI internals;
- constrained synthesis policy is conservative enough for authority-sensitive operational domains;
- `ready` means compiler-consistent candidate, not automatically accepted governing state;
- Veritas remains a standalone consumer/evaluator rather than a canonical Woyengi dependency.

## Unresolved risks

1. **P1 port names/shapes are not yet frozen.** This spec defines P2-owned adapter ports; concrete adapters remain blocked on #14/#15 outputs.
2. **Causal fidelity may exceed P0 v0.1 expressiveness.** The selected v0.1 mapping uses requirements/procedures/lifecycle/IR dependencies. If parity cannot be preserved, escalate a minimum P0 interface request.
3. **Model-provider variance can hide regression.** Captured proposal batches and deterministic replay are mandatory benchmark artifacts.
4. **Realism scoring can become subjective.** P2 should prefer executable/structural falsifiers and report dimensions rather than one opaque realism score.
5. **Synthesis can create false completeness.** Unsupported synthesis is a blocker/unknown; completeness is never itself a reason to invent a fact.
6. **Domain-specific inference rules may be needed later.** They belong in Domain Packages/provider adapters, not the platform kernel or generic P2 contracts.

## Ordered implementation

1. P2-001 — deterministic compiler shell and typed trace/result contract.
2. P2-002 — evidence normalization, identity resolution and reconstructed-state tracer.
3. P2-003 — evidence-bearing procedure/authority/constraint/causal inference tracer.
4. P2-004 — constrained synthesis and fail-closed assumption policy.
5. P2-005 — consistency/realism validation and adversarial benchmark gate.
6. P2-006 — OperationalSystemSpec/IR to Work + App projection parity tracer.
7. P2-007 — OperationalSystemSpec/IR to WorldBundle portable projection tracer.
8. P2-008 — full evidence-to-Work/App/World golden path with deterministic provider replay.

Implementation remains blocked until P0 is accepted. Tickets with P1 dependencies remain additionally blocked until the relevant public interfaces are frozen.