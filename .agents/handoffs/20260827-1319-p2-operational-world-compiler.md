# P2 Operational World Compiler Planning Handoff

Date: 2026-08-27
Mode: product-engineering/research planning only
Task: Woyengi #17 — P2 planning lane: Operational World Compiler architecture and tracer bullets
Branch: `plan/p2-operational-world-compiler`

## Outcome / current state

Planning is complete for issue #17. No production/source code was edited.

Created the lane-owned architecture spec and eight implementation-ready tracer-bullet tickets. Future implementation remains blocked until:

1. P0 OperationalSystemSpec/WorldBundle alignment is accepted; and
2. P1 #14/#15 public interfaces are explicit/frozen enough for P2 to depend on ports rather than implementation files.

The plan uses one future package namespace, `packages/operational-world-compiler/**`, with non-overlapping file ownership per coding ticket.

## Planning artifacts

- `docs/specs/p2-operational-world-compiler.md`
- `docs/tickets/p2-operational-world-compiler/P2-001-deterministic-compiler-shell.md`
- `docs/tickets/p2-operational-world-compiler/P2-002-evidence-resolution-reconstruction.md`
- `docs/tickets/p2-operational-world-compiler/P2-003-operational-inference.md`
- `docs/tickets/p2-operational-world-compiler/P2-004-constrained-synthesis.md`
- `docs/tickets/p2-operational-world-compiler/P2-005-consistency-realism-validation.md`
- `docs/tickets/p2-operational-world-compiler/P2-006-work-app-projection-parity.md`
- `docs/tickets/p2-operational-world-compiler/P2-007-worldbundle-projection.md`
- `docs/tickets/p2-operational-world-compiler/P2-008-evidence-to-projections-e2e.md`
- this handoff

## Key decisions and sources

### Canonical target

`OperationalSystemSpec` remains canonical above Operational IR and Work/App/World projections, per P0 spec and ADR 0007. P2 returns a compilation proposal/result; compiler success does not itself authorize governing state.

### Existing Woyengi seams reused

The spec maps and preserves existing responsibilities:

- ingestion: immutable/idempotent source envelope;
- semantic compiler: provisional semantic decomposition with source spans;
- identity: deterministic alias lookup plus provisional match proposals; merge/split remains separately authorized;
- state/reconstruction: bitemporal projection, conflicts, authorized reconstructive workspace and trace;
- evidence: support/contradiction/mixed/unresolved evidence;
- authority: authority policy/ranking remains distinct from confidence;
- procedures: inference target/reference shape, never executed during compilation;
- graph: typed relationship/dependency evidence;
- verification: schema/source/temporal/authority/consistency/domain gates;
- Work/Composer/WorldBundle: downstream projections through public ports, not duplicated runtimes.

### Veritas boundary

Veritas Foundry/world-generation is a consumer/evaluation reference, not Woyengi's canonical substrate. P2 borrows adversarial dimensions such as missing/conflicting evidence, distractors, dependency depth, budgets, tool/action counts, stochastic/failure pressure and adversarial source pressure into local fixtures.

P2 imports no Veritas runtime classes. The only cross-repo operational-world boundary remains a P0-conformant WorldBundle; Veritas #67 owns standalone adaptation and HiddenOracle/scientific/frontier qualification.

### Deterministic vs model-assisted stages

Deterministic:

- normalization/canonical ordering/IDs;
- exact alias resolution;
- reconstruction invocation/gating;
- reference/provider-neutrality checks;
- contract assembly;
- deterministic projection/conformance mapping;
- diagnostic/benchmark normalization.

Model/provider proposals:

- semantic decomposition where needed;
- ambiguous identity candidates;
- procedure/authority-requirement/constraint/invariant/causal inference;
- constrained synthesis.

All provider output is typed provisional data with evidence/provenance; captured proposal payloads are replay inputs.

### Authority and synthesis

Confidence never grants authority. The compiler can infer an authority **requirement**, never an authority grant.

Synthesis is fail-closed and evidence-bounded. Accepted generated content becomes an explicit comprehension assumption with provider/policy provenance. It cannot fabricate authority, identity merges, credentials, binding availability, legal/compliance truth, evidence/verifier results, destructive actions or evaluator-private oracle truth.

### Causal representation / P0 contract assessment

No mandatory P0 contract change is identified for P2 v0.1. Compiler-local causal/dependency proposals can map into existing requirements, procedures/preconditions/order, lifecycle/attention rules and Operational IR dependencies. Synthesis can map into P0 comprehension assumptions plus provenance.

If implementation proves semantic parity/round-trip fidelity cannot be preserved through that mapping, stop and request the minimum P0 interface addition. Do not edit `packages/operational-spec/**` from P2.

## Ticket dependency graph

```text
P2-001 compiler shell
  -> P2-002 evidence/identity/reconstruction
  -> P2-003 operational inference
  -> P2-004 constrained synthesis
  -> P2-005 consistency/realism validation
       -> P2-006 Work/App projection parity
       -> P2-007 WorldBundle projection
            \             /
             -> P2-008 full E2E/replay gate
```

P2-006 additionally depends on P0 #8 and P1 #14's Work public interface.
P2-007 additionally depends on P0 #9 WorldBundle conformance.
P2-008 depends on all P2 tickets plus accepted P0 and explicit P1 #14/#15 ports.

## Falsifiers / evidence strategy

The spec and tickets require pinned tests for:

- source-order determinism;
- bitemporal conflicts;
- ambiguous identity retention;
- high-confidence/low-authority inversion;
- procedure evidence gaps;
- contradictory required/forbidden actions;
- unsupported causality/cycles;
- prompt-injection attempts to widen authority;
- provider-specific leakage into neutral requirements;
- unsupported/forbidden synthesis;
- private evaluator leakage;
- Work/App/World semantic parity;
- provider-disabled deterministic replay.

Required zero-count gates include authority-confidence conflations, deterministic replay mismatches, public/private leakage and projection semantic-parity violations.

## Authority / effects

Planning only. No source state was modified beyond lane-owned planning artifacts.

The future compiler is computational/proposal-only. It must not:

- commit semantic state;
- merge/split identities;
- grant authority/permissions;
- instantiate Work merely because compilation succeeded;
- execute inferred procedures;
- call connectors/external systems;
- expose private evaluator bytes in public WorldBundle material.

## Commands / verification performed in this planning lane

No code, typecheck, boundary, test or benchmark commands were run because this lane is planning-only and source implementation is prohibited.

Repository/issue inspection covered:

- `AGENTS.md`, `agent.md`, `CONSTITUTION.md`, `CONTEXT.md`, `docs/architecture.md`, agent modes;
- `wayfinder`, `domain-modeling`, `to-spec`, `to-tickets`, `handoff` skills;
- issue #17, parent #6, P1 #14/#15/#16, P0 #7/#8/#9;
- P0 ecosystem spec and ADR 0007/0008;
- existing ingestion, semantic-compiler, identity, state, reconstruction, evidence, authority, procedures, graph, verification, Work and Composer public implementation seams;
- P0 operational-spec branch contract shape;
- Veritas Foundry/operational model/reference behavior and Veritas #67 adapter boundary.

## Failures / unresolved risks

- No `docs/tickets` directory existed on this branch; issue #17 explicitly permits `docs/tickets/p2-operational-world-compiler/**`, so the lane-local directory was created without touching other ticket lanes.
- P1 port shapes are not yet frozen. P2 therefore defines adapter-level ports and avoids coupling to P1 implementation files.
- Causal fidelity remains the main possible P0 interface risk; see escalation rule above.
- Model-provider variance requires captured proposal payloads and deterministic replay; live-provider output alone is insufficient regression evidence.
- P2 realism validation must not be mislabeled Veritas scientific/frontier qualification.

## Branch / commits / PR

Branch: `plan/p2-operational-world-compiler`

Planning commits were created directly on the assigned planning branch via the repository connector. No PR was opened by this planning lane.

Latest artifact commit at handoff creation: this handoff commit (branch history also contains one commit per spec/ticket creation).

## Exact next action

Do **not** implement yet.

After P0 is formally accepted and P1 #14/#15 public interfaces are explicit:

1. assign a coding agent to `P2-001-deterministic-compiler-shell.md` only;
2. have that agent re-read `AGENTS.md`, the P2 spec and P2-001;
3. follow the repository product-engineering implementation/TDD/verification/code-review lifecycle;
4. keep the ticket's exclusive future file ownership;
5. land P2-001 before starting dependent tickets, except where maintainers explicitly approve safe parallelism across disjoint files.

If the blockers are not satisfied, the correct next action is dependency review—not source implementation.