# P2-002 — Evidence normalization, identity resolution and reconstructed-state tracer

Parent: #17
Spec: `docs/specs/p2-operational-world-compiler.md`
Depends on: P2-001
Mode: product engineering

## Outcome / Outcome Contract

Given authorized source/evidence references for a pinned fixture, produce a traced, immutable stage result that preserves source spans/provenance, resolves only unambiguous identities, retains ambiguous candidates, and obtains an authorized `ReconstructiveWorkspace` at explicit valid/transaction times.

The tracer must prove that evidence decomposition and identity matching remain provisional until existing Woyengi identity/reconstruction authority semantics permit stronger conclusions.

## Global blockers

- P0 accepted.
- #14/#15 public interfaces explicit as required by #17.
- P2-001 seam landed.

## Future exclusive file ownership

Only:

- `packages/operational-world-compiler/src/stages/evidence.ts`
- `packages/operational-world-compiler/src/adapters/woyengi-evidence.ts`
- `packages/operational-world-compiler/test/evidence-reconstruction.test.ts`
- `packages/operational-world-compiler/test/fixtures/evidence/**`

No edits to ingestion, semantic-compiler, identity, state, reconstruction, evidence, authority, P0 contracts, or other P2 ticket files.

## Reused seams

Adapter through public APIs for:

- `packages/ingestion` accepted source envelopes/locators;
- `packages/semantic-compiler` provisional claims/events/relationships/evidence/source spans;
- `packages/identity` alias resolution and match-proposal history;
- `packages/reconstruction` authorized reconstructive workspace;
- `packages/evidence` support/contradiction summaries as available.

## Inputs

- compile request context from P2-001;
- authorized source refs;
- optional already-structured semantic records;
- identity registry/read port;
- reconstruction port;
- semantic proposal port only for sources that require decomposition.

## Outputs

A stage payload containing at least:

- normalized claims/events/relationships/evidence refs;
- identity resolutions with `resolved | ambiguous | unresolved` status;
- candidate refs and scores without authority promotion;
- reconstruction ID/trace ref;
- explicit valid/transaction timestamps;
- contradictions/uncertainties/provenance manifest;
- blocking diagnostics where identity ambiguity affects required operational semantics.

## Public seam changed

No cross-package public contract change. Implements P2-001 injected stage protocol and adapter interfaces only.

## Required behavior

1. Equivalent source ordering produces stable normalized ordering/IDs.
2. Every decomposed claim/event/relationship traces to a source artifact/span or an existing semantic-record reference.
3. Exact registered alias resolution may resolve deterministically.
4. Multiple alias owners or model-scored matches remain candidates; compiler does not merge entities.
5. Reconstruction request includes principal, purpose, valid time and transaction time.
6. Records denied by reconstruction authorization never enter later stage payloads or provider contexts.
7. Existing reconstruction contradictions/uncertainties are retained verbatim by reference, not normalized away.
8. A high identity-match confidence cannot substitute for merge authority.

## Explicit non-goals

- No identity merge/split operations.
- No procedure/authority/causal inference.
- No synthesis.
- No spec/projection assembly.
- No source writes or lifecycle promotion.

## RED / falsifiers

1. Two possible alias owners are silently collapsed to one entity.
2. Model score 0.99 causes an identity merge/confirmed status without authority.
3. Source span/provenance is lost after normalization.
4. A denied record is observable in a downstream provider input or diagnostic payload.
5. Valid-time and transaction-time conflict fixture resolves as if only one clock exists.
6. Mixed/contradictory evidence is reduced to a single fact with no conflict reference.
7. Input source reorder changes deterministic normalized output.

## Required fixture cases

- exact alias;
- ambiguous alias;
- provisional semantic identity candidate;
- bitemporal conflict;
- supporting + contradicting evidence;
- permission-denied record;
- irrelevant distractor source.

## Required verification

1. `node --test packages/operational-world-compiler/test/evidence-reconstruction.test.ts`
2. P2-001 tests
3. `pnpm typecheck`
4. `pnpm boundaries`
5. `pnpm test:all`

## Evidence to capture

- source-to-output provenance examples;
- denied-record non-observability test;
- bitemporal trace assertion;
- ambiguity retention assertion;
- commands/failures.

## Authority / external-effect constraints

Read/reconstruct only under the supplied principal. Identity candidates are proposals. No identity lifecycle operation, authority grant, semantic commit or external effect.

## Rollback / replay

Captured authorized source descriptors plus semantic proposal payloads and reconstruction fixture outputs must replay deterministically. Replay cannot modify identity/state history.

## Dependencies / unlocks

Depends on P2-001. Provides the evidence/reconstruction input contract consumed by P2-003 and P2-004.