# Woyengi predictive-state read export — review candidate

**Scope:** isolated, read-only `packages/predictive-export` library using the existing `ClaimLedger` and `CapabilityEngine`. No HTTP endpoint, no canonical state mutation, no model execution, no implicit AI-use license, no verified publisher, no production integration or authorization by model outputs.

It is a proposed source-side counterpart to [TAC-OSM ecosystem PR #435](https://github.com/FPC-effortless/TAC-OSM/pull/435). Woyengi's existing [constitutional state and effects rules](../../CONSTITUTION.md) govern the implementation.

## Binding offline customer-inference policy (2026-10-30)

Customer inference is **local-only on the user's controlled device** for all six TAC-OSM families. This exporter rejects any `destination: "external-model"` request **even if** the trusted source policy says `cloud-allowed`; the legacy discriminant remains in the TypeScript interface solely so old integrations fail explicitly instead of silently using a remote path. Unrecognized locality metadata fails closed. Cloud training, CI and signed artifact delivery remain permitted, but inference-time embeddings, preprocessing, model calls, state updates, speech and fallbacks may not use remote services.

This is a **source-export guard**, not a mobile SDK or proof of complete offline operation. It does not by itself establish Android/iOS/embedded export, operator coverage, numerical agreement, physical-device p50/p95 latency, peak RAM, energy use or airplane-mode behavior. Each remains **NOT RUN/BLOCKED** until evidence from an actual named device exists. The caller's authenticated host must also enforce that the `local-model` destination is genuinely local, and the model runtime must have no hidden network fallback.

## Trusted host contract

Only a trusted Woyengi server/process constructs `PredictiveReadHost`: its **authenticated** principal, workspace, purpose, graph, context, current `accessAt`, actual `destination`, capability engine, projection resource map, source metadata/rights and strict feature projection must not be accepted from a model, browser or untrusted JSON.

The request contains **only** a subject, predicate, historic valid/recorded/prediction cutoffs and allowlisted feature names. Current authorization is evaluated at the trusted `accessAt` (not the historical cutoff), preventing expired/revoked grants from being resurrected. `predictionCutoff` cannot exceed `accessAt`. The actual destination is host-owned, not caller-controlled.

1. Require Woyengi `RECONSTRUCT` and `EXPORT` before reading the projection; both are independently evaluated by `CapabilityEngine` under principal, workspace, entity, purpose, conditions, sensitivity and present grant.
2. Read `ClaimLedger.projectAt` at distinct valid and recorded times. No selected value is exported without its eligible competing candidates and conflicts.
3. Require Woyengi `READ` and `EXPORT` separately for **every** candidate, including competing claims; if any candidate is forbidden, **deny the whole export** rather than imply there was no contradiction.
4. Fail closed on absent source AI-use permission, missing/late source availability, source locality mismatch, restricted fields, nonfinite numbers, unauthorized destinations and untrusted model outputs.
5. Detached features only, with derived SHA256, separate validity/knowledge/availability time and explicit `ADVISORY_ONLY` / `STRUCTURAL_EXPORT_ONLY` / `NOT_ATTESTED_BY_THIS_EXPORTER` / `NOT_GRANTED` evidence tiers.

**High-trust remaining dependency:** `sourcePolicy(claim)` is a port from the authorized host. It must be backed by independently reviewed source licensing, privacy, consent, data locality and true availability evidence. A boolean `verifiedAiUse` invented by a client is insufficient; this library does not independently adjudicate source rights.

No external effects, `ActionIntent`, `ExecutionManifest`, `AcceptanceOutcome` or `VerifiedSemanticCommit` are constructed. A returned `featureHash` identifies detached bytes, **not** original publisher truth, independent Veritas attestation or scientific training quality.

## Tests and usage

`node --test packages/predictive-export/test/export.test.ts` exercises *constructed* Woyengi-native claims with the real source `ClaimLedger` and `CapabilityEngine`. `pnpm typecheck && pnpm boundaries && pnpm test:all` and other standard Woyengi CI gates are required before approval. Tests cover principal/purpose denial, missing READ/EXPORT, per-record conflict access, revocations after historic cutoff, current-time gate, rights/locality policy, no oracle fields and no canonical write. The tests do **not** validate real authenticated HTTP, legal publisher rights, cross-repository Fit/DEV/TEST isolation, external scoring, or real AI performance.

The matching TAC consumer checks the versioned serialized structure while explicitly declining to authenticate Woyengi host signatures, publisher original hashes or Veritas rewards from a JSON sample. Its future integration must happen only after trusted read-port wiring and source-controlled end-to-end tests.

**Rollout:** draft review → source-policy and permission-checked host wiring → authenticated audit → one legal real dataset import to Forge → TrainLab honest source partitions → TAC original model prediction → independent Veritas result, then only separately authorized governed effects. No release/PRD ticket completion or model qualification is claimed by this module.
