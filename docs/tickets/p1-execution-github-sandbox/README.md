# P1 Execution + GitHub + Sandbox — Ticket Index

Planning lane: #15  
Branch: `plan/p1-execution-github-sandbox`  
Status: **implementation blocked until P0 acceptance**

Source specification: `docs/specs/p1-execution-github-sandbox.md`

## Dependency order

```text
P0 accepted
    |
    v
P1-EXE-001 durable governed execution coordinator
    |-------------------------|
    v                         v
P1-EXE-002 GitHub provider    P1-EXE-003 isolated sandbox
                                |
                                v
                         P1-EXE-004 compute/runtime
                                |
                                v
                         P1-EXE-005 live execution API
                                |
                +---------------+
                | P1-EXE-002 + #14 durable ports
                v
P1-EXE-006 coding issue -> sandbox/tests -> reconciled verified PR
```

P1-EXE-005 also requires lane #14's public durable principal/session + persistence adapters. Lane #16 should consume P1-EXE-005's public execution read/event/sandbox-session behavior and must not depend on the internal files listed below.

## Tickets

| Ticket | Tracer-bullet outcome | Future exclusive ownership | Key falsifier |
| --- | --- | --- | --- |
| `P1-EXE-001` | restart-safe governed coordinator over existing effects | `packages/execution/**`; narrow restore seam in `packages/effects/src/index.ts` + its governed test | crash after ambiguous external dispatch never causes second mutation |
| `P1-EXE-002` | typed GitHub read/write adapter + canonical reconciliation | `packages/github-connector/**` | PR write times out after provider applies it; reread confirms with mutation call count one |
| `P1-EXE-003` | real isolated Docker/process sandbox + content-bound evidence | `packages/sandbox/**` | host/Docker/network escape attempts fail closed; timeout/cancel leaves no process running |
| `P1-EXE-004` | sandbox-backed compute-node/runtime + budget/cancel/recovery | `services/compute-node/**`; `services/runtime/**` | runtime restart on ambiguous external state uses reconcile-only path |
| `P1-EXE-005` | authenticated live execution API + lane #16 ports | `services/platform-api/**` | duplicate/conflicting idempotent client commands cannot duplicate coordinator/provider effect |
| `P1-EXE-006` | GitHub issue -> governed sandbox -> tests/evidence -> reconciled PR -> independent verification/outcome | `packages/coding-agent/**` | failed/missing/corrupt test evidence or revoked authority yields zero publish calls/no acceptance |

## Parallelization rules

- All tickets are hard-blocked until P0 acceptance.
- `P1-EXE-002` and `P1-EXE-003` may run in parallel **after** `P1-EXE-001` is merged because their future file ownership is disjoint.
- `P1-EXE-004` waits for the public sandbox contract from `P1-EXE-003`.
- `P1-EXE-005` waits for coordinator/runtime behavior and #14's public adapters.
- `P1-EXE-006` is the integration tracer and waits for all upstream tickets plus #14 durable Work/principal behavior.
- No ticket may solve a missing upstream interface by editing another ticket's files. Report the smallest public-contract change to the owning ticket/lane.

## Cross-lane contracts

### From lane #14

Consume through public ports only:

- durable execution append/CAS + external-effect claim adapter;
- active/revoked principal/session resolution;
- workspace-scoped authorization;
- durable WorkInstance/WorkEpisode lookup/reference behavior.

No direct dependency on #14 tables, files or storage classes.

### To lane #16

Expose through public behavior only:

- execution projection read;
- paginated journal read by stable sequence;
- at-least-once execution event envelope whose durable sequence is canonical;
- sandbox session inspect/stdin/cancel/output controls.

Lane #16 owns WebSocket/SSE, reconnect cursor fanout, shell UI, takeover/handoff and multiplayer projection.

## Global falsifiers carried by every ticket

1. provider/transport success is never accepted truth by itself;
2. same external idempotency key + changed request fails closed;
3. ambiguous external write never auto-retries across restart;
4. cancellation never erases/reverses an already-observed external effect;
5. workspace/principal revocation/isolation is checked at the actual effect boundary;
6. credentials never enter durable execution/journal/evidence/realtime payloads;
7. replay/restore does not perform external or semantic effects;
8. required evidence must validate by content digest;
9. independent verification remains distinct from provider/sandbox self-observation;
10. no implementation starts before P0 acceptance.

## Verification baseline

Every coding ticket begins with its targeted failing public-behavior tests, then expands through:

1. targeted `node --test ...` command named in the ticket;
2. `pnpm typecheck`;
3. `pnpm boundaries`;
4. `pnpm test:all`;
5. `pnpm benchmark` when state/replay/adversarial semantics are affected;
6. `pnpm prod:check` when the production runtime/API path changes.

Do not report a gate as passing unless it was run. Real Docker and live-provider checks must be separately identified from fake-only tests.