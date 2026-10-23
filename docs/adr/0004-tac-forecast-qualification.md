# ADR 0004 — TAC-OSM physical forecast qualification at Woyengi Compute boundary

**Status:** proposed, code+tests in draft PR; not wired to AgentGateway.act or a production deployment.

## Verified current code interfaces
- `packages/permissions/src/index.ts` `CapabilityEngine` evaluates scoped default-deny permissions including `RECONSTRUCT`, `PROPOSE_WRITE`, `EXECUTE`. Capability permission is a necessary governance condition, never evidence a predicted physical trajectory is correct.
- `packages/agent-sdk/src/index.ts` `AgentGateway.read()` checks reconstruct; `propose()` checks write proposal and optionally verification; `act()` checks EXECUTE and invokes `executeProcedure()`. **It does not currently know about TAC model checkpoint qualification, source/transfer calibration, physical risk, or forecast source state revision**. Do not treat an earlier proposal as inherently binding to the later action.
- `packages/compute/src/index.ts` `LocalComputeProvider` verifies operation authority, live compute node capability, lease and budget; a compute receipt is observation-only with semanticMutation=false. It does not certify the supplied model output.
- `docs/adr/0003-governed-execution-and-effects.md` requires immutable manifests, effect-class separation, reconciliation and verification before semantic commit.

## Empirical reasons for a new guardrail
ME062 (real `line_trash_can_with_trash_bag`) source-CAL nominal 90% TAC whole-episode intervals covered only **30.00%** on transfer, and TAC physical MAE 1.256390 lost to original FIT servo 1.031359. ME063 (real `fold_and_stack_scattered_clothes_neatly`) source-cal nominal 90% TAC intervals covered only **72.25%**, while TAC MAE 0.828290 lost to servo 0.793413. The strongest baseline changed across tasks; learned router weights are **not** calibrated posterior confidence. The real recordings contain actual observed action/state sequences, **not proven alternative action outcomes**.

## Boundary
1. Platform reconstructs an entity's permitted state with explicit `validAt`, `recordedAt`, identity/workspace and original provenance. A domain-specific adapter authorizes the **read** of 14D physical state; no secret, capability or signed authority is passed inside a model feature tensor.
2. Platform binds a request nonce/trace, exact input SHA-256, allowed candidate action list, state-revision head, valid/transaction cutoffs and TTL. Model weights, feature schema and their risk qualification status are read from Woyengi's own trusted registry (NEVER from the model).
3. TAC computation produces *proposal-only* predicted states, strictly positive uncertainty scales, source checkpoint and trace. `evaluateTacForecastForReview()` checks untrusted receipt trace, snapshot freshness, model identity, shape, finite numeric values, scenario list and `execute=false`. A valid unqualified forecast may be viewed by a human as **UNQUALIFIED_REVIEW_ONLY**, but may neither mutate canonical state nor trigger any tool or external side effect. An unknown checkpoint, invalid authority, stale snapshot, malicious self-executing instruction, nonfinite uncertainty or mismatched trace is **BLOCKED**.
4. Woyengi records prediction as an observation with immutable referenced input/model receipt; it is **not** promoted into a canonical fact or an execution decision. The dedicated authority engine and effect guards must still reauthorize all individual actual actions, recheck same state head/time, require separate evidence and explicit human approval where prescribed, enforce idempotency/budget, and independently verify/reconcile any external results. A score/forecast can never serve as the authorization token. A forecast service API should be read-only by construction.
5. Veritas may conduct *offline* real-record replay and synthetic intervention simulation. Simulated wins are not independent real counterfactual evidence and cannot change the model's trusted qualification. Publishing a `qualified` checkpoint must require independent authentic unseen-task evaluation (better than strongest per-task physical prior and matched neural control), adequate risk-coverage/calibration at measured costs, and reproducible original model/checkpoint/evaluation evidence. Even qualified forecasts do not directly authorize effects: separate governed execution remains mandatory.

## Threats and response policy
| Threat | Required deterministic result |
|---|---|
| Old task source-CAL confidence extrapolated as novel-task risk | UNQUALIFIED_REVIEW_ONLY; never auto execute |
| Model returns `execute:true`, fake authority, wrong nonce, wrong checkpoint | BLOCKED |
| Original state revision changes after model request; capability expires/revokes | BLOCKED, reconstruct again |
| Prediction NaN/infinite/zero sigma or absent action horizon | BLOCKED |
| Model from unexpected hash, unknown feature interface or absent replay bytes | BLOCKED |
| Human approves a prediction for a separate action without capability | Authorization denied by existing CapabilityEngine |
| An EXTERNAL effect returns success with no actual state verification | Do not semantic-commit; require reconciliation under ADR0003 |

## Important implementation status
`packages/compute/src/tac-forecast-guard.ts` is a **pure forecast-screening primitive**, not an SDK's wired runtime policy. It requires Woyengi call-site proof that input authorization has actually been checked and that the state revision is current; it cannot verify externally supplied booleans by itself. No automatic action path is added. Before production, integrate this at a domain-approved Woyengi platform/compute read-only endpoint, enforce trusted registry lookup and request-authentication at the service layer, add reauthorization at governed action execution, and run end-to-end negative/safety tests. Keep original code path unchanged until those controls are implemented.
