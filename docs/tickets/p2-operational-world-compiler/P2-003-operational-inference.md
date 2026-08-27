# P2-003 — Evidence-bearing procedure, authority, constraint and causal inference tracer

Parent: #17
Spec: `docs/specs/p2-operational-world-compiler.md`
Depends on: P2-001, P2-002
Mode: product engineering with falsifiable inference tests

## Outcome / Outcome Contract

From a pinned reconstructed workspace, emit typed provisional candidates for procedures, authority requirements, constraints/invariants and causal/dependency relationships. Every inferred candidate must retain evidence/provenance and confidence separately from authority. Unsupported or contradictory consequential semantics must produce review/blocking diagnostics rather than a completed operational model.

## Global blockers

- P0 accepted.
- P1 #14/#15 public interfaces explicit.
- P2-001/002 seams landed.

## Future exclusive file ownership

Only:

- `packages/operational-world-compiler/src/stages/inference.ts`
- `packages/operational-world-compiler/test/inference.test.ts`
- `packages/operational-world-compiler/test/fixtures/inference/**`

Do not edit `packages/procedures`, `packages/authority`, `packages/graph`, `packages/verification`, P0 contracts, or other P2 ticket files.

## Inputs

- evidence/reconstruction stage payload from P2-002;
- `OperationalInferencePort` provider proposal payload;
- read-only authority/evidence/procedure/graph validation adapters;
- explicit objective and timestamps.

## Outputs

Typed proposal collections:

- `ProcedureProposal`: preconditions, ordered operations/capability requirements, invariants, verification/postconditions/repair hints, evidence/provenance;
- `AuthorityRequirementProposal`: operation/scope/requirement, observed authority basis refs, evidence/provenance;
- `ConstraintProposal` / `InvariantProposal`: statement/scope/severity/evidence;
- `DependencyProposal`: from/to/relation, `declared | temporal | causal-candidate`, confidence/evidence;
- stage diagnostics and unknown/conflict refs.

All provider-originated values remain provisional.

## Interfaces / mapping rules

- Existing `ProcedureDefinition` is a validation/reference shape, not executed here.
- Existing `AuthorityEngine` assesses observed candidates/policies; P2 emits requirements, never grants.
- Existing graph relations may establish declared dependencies.
- Causal candidates remain compiler-local until accepted semantics can map into P0 procedure preconditions/order, lifecycle/attention rules and Operational IR dependencies.
- If exact causal semantic parity proves impossible without a P0 field, stop and raise the minimum interface request.

## Required behavior

1. Structured/explicit procedure evidence is preferred over model inference.
2. Provider-inferred procedure steps cite supporting evidence and distinguish inferred ordering from declared ordering.
3. Authority inference can state that an operation **requires** a role/policy; it cannot create that authority.
4. Authority ranking and confidence remain separate fields/traces.
5. Explicit constraints/invariants survive unchanged by meaning; inferred ones retain proposal provenance.
6. Temporal precedence alone is insufficient to mark `causal` verified.
7. Conflicting procedure/authority evidence is retained and can block consequential compilation.
8. Consequential operation with unresolved authority requirement emits `AUTHORITY_UNRESOLVED`.
9. Unsupported causal claims emit `CAUSAL_UNSUPPORTED`; cycles emit candidates for later validation rather than being silently linearized.

## Explicit non-goals

- No procedure execution.
- No authority/permission/identity writes.
- No synthesis of missing evidence.
- No final OperationalSystemSpec assembly.
- No Work/App/World projection.

## RED / falsifiers

1. High-confidence low-authority evidence governs over an authoritative conflicting source solely because confidence is higher.
2. A provider proposal creates an authority grant/principal membership.
3. Correlated event ordering becomes a verified causal relation with no causal evidence.
4. A consequential inferred procedure step has no evidence/provenance reference and still passes.
5. Contradictory procedures are collapsed without a conflict diagnostic.
6. Provider-specific tool/model/database names leak into provider-neutral capability requirements.
7. Inference code invokes a procedure/tool to test its hypothesis.

## Required fixture cases

- high-confidence vs high-authority conflict;
- explicit SOP with full evidence;
- partially observed repeated procedure;
- contradictory SOP/history;
- temporal correlation trap;
- causal cycle;
- provider-injection proposal;
- consequential action with missing authority.

## Required verification

1. `node --test packages/operational-world-compiler/test/inference.test.ts`
2. P2-001/002 targeted tests
3. `pnpm typecheck`
4. `pnpm boundaries`
5. `pnpm test:all`

## Evidence to capture

- candidate/evidence trace examples;
- authority-confidence inversion test;
- causal unsupported/cycle tests;
- provider-neutrality negative test;
- exact commands/failures.

## Authority / external-effect constraints

Inference produces proposals only. It may evaluate read-only authority context but cannot grant authority, execute a procedure, mutate state or call an external system.

## Rollback / replay

Capture provider inference payloads as replay inputs. Downstream normalization/diagnostics must replay identically without provider calls. No canonical record is rewritten on rollback.

## Dependencies / unlocks

Depends on P2-001/002. Supplies candidate semantics for P2-004 synthesis and P2-005 validation.