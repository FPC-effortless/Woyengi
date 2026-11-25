# Proposal: governed read-only Woyengi projection export for predictive models

**2026-10-26 — PROPOSAL / NOT AN APPROVED PRD TICKET.** Scope is an additive, domain-neutral read adapter for authorized source projections, for example TAC-OSM. This document does not modify the state kernel, authorizations, production endpoints, verified semantic commits, release policy or ordered `prd.json` tickets. Adoption requires a maintainer-approved ticket and independent runtime tests.

## Existing interfaces that govern the proposal

- [Constitution](../CONSTITUTION.md): canonical facts are reconstructed, history append-oriented, observations are distinct from claims, confidence is not authority, candidate conflicts retained, and agent writes remain proposals.
- [ClaimLedger.projectAt](../packages/state/src/index.ts) accepts `{subject,predicate,validAt,recordedAt}` and returns a `StateProjection` with `selected`, `candidates`, `conflicts`, and `trace`. **It is not itself a permission gate.**
- [ReconstructionEngine](../packages/reconstruction/src/index.ts) checks principal/purpose reconstruction authorization, filters each retrieved record using `authorizeRecord`, and exposes a `permissionContext` only after authorizing.
- [IngestionFabric](../packages/ingestion/src/index.ts) receipts remain provisional and carry source principal, content hash and data locality; neither SHA nor receipt means verified truth.
- [AuthorityEngine](../packages/authority/src/index.ts) evaluates governing policy separately from source/model confidence.
- [Effects contracts](../packages/effects/src/index.ts) distinguish intents, policy/risk/budget decisions, independent verification, observed/reconciled effects and acceptance. An ML prediction must never construct an `AUTHORIZED` manifest or canonical semantic commit by itself.

## Proposed narrow extension boundary

Prefer adding a **new read-only adapter/port** as an isolated application/integration module, not in `packages/state`, `packages/core` or a new domain-specific kernel primitive. Inputs must be supplied by the existing fully permission-checked reconstruction service (or by an equivalently authoritative principal/purpose read port), **not** by arbitrarily deserialized `StateProjection` JSON.

Proposed request:

```ts
type PredictiveProjectionReadRequest = {
  principal: string;
  purpose: string;
  subject: string;
  predicate: string;
  validAt: string;
  recordedAt: string;            // as-known-at cutoff
  predictionCutoff: string;
  allowedFeatureNames: readonly string[];
};
```

Expected sequence:
1. Authenticate principal and scope to declared purpose, source locality, authorized subject and graph.
2. Resolve the bitemporal Woyengi read using the existing permission + per-record ACL checks; refuse when any required retained conflicting claim cannot be disclosed safely. **Do not filter rivals silently to make a selected claim look unopposed**: explicitly defer/restrict output instead.
3. Ensure `recordedAt` and all exported claim transaction/knowledge times are at or before `predictionCutoff`; verify validAt is not in the future of a purported live observation. Record actual source-availability semantics; use Woyengi transaction time as a conservative knowledge proxy only if provenance confirms it is safe.
4. Export all authorized candidates, selected ID, conflict IDs, actual valid/recorded times, source IDs, lifecycle and trace IDs, and strictly allowlisted feature values. Strip restricted fields, storage locators, policy internals, credentials, test labels, future outcomes and confidential evidence.
5. Bind result to a source projection hash + original artifact/source identity. A derived JSON SHA only proves exported-byte identity, not original publisher authenticity or AI-use rights. Provide explicit source-rights decision from an authorized data steward before moving into Forge.
6. Return an advisory, scoped **read export**; never mutate state, grant `EffectPlan` or `ExecutionManifest`, or equate a model prediction with verified Woyengi state.
7. A separate Forge/TrainLab adapter may produce FIT/DEV records from eligible real data with strict split isolation. Protected TEST, independent Veritas reward oracle and agent/action receipts remain independently gated.

## TAC-OSM consumer scaffold

[Stacked TAC-OSM PR #435](https://github.com/FPC-effortless/TAC-OSM/pull/435) contains a real `ClaimLedger.projectAt` **shape adapter** and no-fit adversarial tests. It needs an authorized Woyengi host before any actual source data can be used. Its `read_authorized` callback is **not a cryptographic permission proof** when supplied by an untrusted caller, and the adapter explicitly labels source authenticity and scientific qualification unverified. Its timestamp and conflict checks are defense-in-depth, not a substitute for Woyengi ACLs.

## Minimum Woyengi implementation acceptance / falsifiers

| Control | Required independent test |
| --- | --- |
| Principal/purpose and per-record ACL | Deny unauthorized principals, subjects and purposes; no policy predicate bypass by a model-supplied principal or Boolean |
| Bitemporal as-of | Claim valid in past but recorded after cutoff is absent; offset-aware time comparison and retractions reconstructed at as-of time |
| Conflict transparency | Two contradictory eligible claims remain visible or export is explicitly denied; selected cannot hide rivals |
| Source rights/locality | Cloud export of local-only/ephemeral source denied; AI-use/redistribution permissions verified externally |
| Provenance and identity | Original source record vs derived export hash distinguished; ambiguous identity fails or defers |
| Immutable history | Export changes no canonical ledger, lifecycle transitions, authoritative acceptance, external effects or audit evidence |
| Protected model/evaluator separation | Hidden TEST and Veritas goal/reward/evaluator data not exported to model-fit or prediction side |
| One-way proposals | Model confidence cannot authorize action; actual Woyengi execution and acceptance remain governed |
| Real qualifying source | Independent rights, source, entity and outcome verification; no fabricated timestamps/labels |
| Scientific evidence | Real trained TAC-OSM comparison only with applicable equal parameters/data/compute and independent replay |

## Next action after review

Have a Woyengi maintainer register/approve a narrow integration ticket without reordering active **WYG-025/WYG-026** remediation. Implement the source-side permissioned export with Node 24 TypeScript tests and no network/canonical mutation. Then test a real lawful **read-only** flow through Forge and TAC-OSM with independent Veritas checking. Current document and TAC CI fixtures are **specification/structural evidence only**, not a live adapter/verified pilot.
