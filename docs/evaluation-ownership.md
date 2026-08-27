# Evaluation ownership and claim boundary

Woyengi evaluation and Veritas qualification are separate gates with separate owners, contracts, provenance, and authority.

## Woyengi evaluated scope

`packages/evaluation` may evaluate and certify only Woyengi package/runtime behavior for the evidence actually supplied. Its allowed claim classes are:

- conformance;
- compatibility;
- replay/effect correctness;
- tested failure behavior;
- package/runtime certification for the evaluated scope.

The existing package certification artifact is `woyengi.package-certification.v1`. A consumer that needs an explicit machine-readable claim boundary should derive `woyengi.evaluation-claim-boundary.v1` with `certifyClaimBoundary()` from `packages/evaluation/src/certification-boundary.ts`.

That boundary is fail-closed. It accepts only the Woyengi package-certification contract and rejects scientific/frontier qualification fields or semantic-commit authority fields smuggled into the source artifact.

## Veritas-owned qualification

Veritas owns scientific benchmark qualification, frontier qualification, capability comparisons, longitudinal capability observation, training-value evidence, evaluator secrecy, contamination/leakage controls, and evaluator-private truth.

A Veritas qualification artifact is not a Woyengi certification artifact. Its contract/provenance must remain Veritas-owned and must not be accepted under the `woyengi.package-certification.v1` contract.

Passing Woyengi certification never implies Veritas scientific qualification or Veritas frontier qualification. Passing Veritas qualification never implies Woyengi package/runtime certification.

## Production and authority are separate

Evaluated-scope certification does not establish production readiness. Release/production claims require their own product, operational, security, deployment, and human-acceptance gates.

Evaluation also does not grant authority. A certification result or a Veritas qualification result cannot create, authorize, or replay a Woyengi semantic commit and cannot issue semantic or external effects. A replay result may contain a retrospective `semanticCommitId` reference to an already accepted outcome; that reference is evidence/correlation only, not commit authority.

The constitutional path remains independent:

`proposal -> validation -> authority -> reconciliation -> verification -> accepted outcome -> semantic commit`

Evaluation evidence may inform that path, but it cannot replace any authority or acceptance gate.

## Contract and provenance separation

Woyengi artifacts use Woyengi-owned contract identifiers, including:

- `woyengi.package-certification.v1` — evaluated package/runtime certification result;
- `woyengi.evaluation-claim-boundary.v1` — machine-readable statement of what that certification is and is not allowed to claim.

The claim-boundary provenance records:

- producer: `WOYENGI_EVALUATION`;
- source contract;
- source certification ID;
- source package ID;
- evaluation timestamp.

No field in the boundary can claim scientific qualification, frontier qualification, production readiness, semantic-commit authority, or issued semantic/external effects; those fields are literal `false`.

## Falsifiers

The boundary is broken if any of these becomes possible:

1. a Woyengi certification artifact is accepted with a scientific/frontier-qualified claim;
2. a Woyengi certification artifact produces a production-ready claim;
3. evaluation success grants semantic-commit authority or issues semantic/external effects;
4. a Veritas qualification contract is accepted as Woyengi package certification;
5. external qualification metadata is copied into the Woyengi claim envelope;
6. UI/docs treat the two gate categories as interchangeable.

These are ownership failures, not scoring-methodology failures. Fix them at the contract/claim seam rather than by adding a new benchmark score.
