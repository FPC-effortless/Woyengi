# P1 realtime shell + coding planning handoff

Date: 2026-08-27
Work mode: Product engineering
Program: Woyengi #6
Planning issue: Woyengi #16
Branch: `plan/p1-realtime-shell-coding`
Mode constraint: PLANNING ONLY; P1 implementation is blocked until P0 acceptance

## Outcome and current state

The required planning lifecycle is complete:

```text
wayfinder -> to-spec -> to-tickets -> handoff
```

No production source, `prd.json`, `progress.txt`, shared ADR, or another lane's file was edited.

The lane now has an implementation-ready P1-C specification plus three dependency-ordered tracer-bullet tickets with non-overlapping future file ownership, explicit public interfaces, falsifiers, evidence requirements, authority/effect constraints, replay/rollback behavior, and verification commands.

Current state is **PLANNING COMPLETE / IMPLEMENTATION BLOCKED**.

The blocker is intentional: issue #6 requires P0 to land and receive required human acceptance before P1 implementation. The realtime/live-shell lane also depends on public contracts from P1 lane A (#14) and lane B (#15); it must not reach into those lanes' implementation files.

## Durable artifacts created

### Specification

- `docs/specs/p1-realtime-shell-coding.md`
  - current implementation/gap reconstruction;
  - wayfinder decision graph;
  - SSE/HTTP transport decision and external standards evidence;
  - browser-owned durable reconnect cursor semantics;
  - durable-vs-ephemeral collaboration boundary;
  - expected persistence/auth and execution/GitHub public ports;
  - live shell state/command model;
  - coding-first E2E contract;
  - reconnect/order/duplicate/leakage/takeover/stale-projection/recovery falsifier matrix;
  - observability, migration/replay/rollback, acceptance, human QA, blockers and risks.

### Future implementation tickets

1. `docs/tickets/p1-realtime-shell-coding/P1C-001-resumable-sse-delivery.md`
   - future ownership limited to `packages/realtime` files named in the ticket;
   - implements provider-neutral resumable SSE delivery, revocation-aware authorization, bounded backpressure, and ephemeral presence behavior.

2. `docs/tickets/p1-realtime-shell-coding/P1C-002-live-shell-collaboration.md`
   - future ownership limited to explicitly named `apps/woyengi` files;
   - wires live backend ports into the shell, adds realtime reducers/presence and takeover/handoff/suspend/resume/recovery UX;
   - leaves `apps/woyengi/src/demo.ts` as an explicit demo fixture and forbids the live entrypoint from depending on it.

3. `docs/tickets/p1-realtime-shell-coding/P1C-003-coding-live-e2e.md`
   - future ownership limited to new conformance fixture/test files;
   - proves GitHub issue -> Work -> AgentPrincipal -> governed sandbox -> code/tests/evidence -> independent verification/review -> PR, including disconnect/reconnect, takeover, ambiguous external-effect reconciliation and at-most-one provider write.

## Decisions and source

### Transport

Selected: **same-origin SSE for server -> browser durable/projection updates plus authenticated/idempotent HTTP commands for browser -> server actions**.

Primary evidence is recorded in the spec:

- WHATWG EventSource reconnect and `Last-Event-ID` semantics;
- MDN WebSocket two-way behavior and lack of backpressure in the stable browser `WebSocket` API;
- Node HTTP `upgrade` path complexity compared with ordinary HTTP streaming.

WebSocket is explicitly deferred until a measured high-frequency bidirectional requirement such as interactive terminal input or CRDT editing justifies it.

### Browser reconnect cursor

The browser presents an opaque durable causal cursor and the SSE `id` carries the event cursor. Reconnect reads non-destructively after that position.

This is intentionally distinct from the existing worker-style server subscriber cursor: advancing a durable server cursor merely because `response.write()` completed cannot prove browser receipt and creates a silent-loss window.

### Snapshot/stream race

The backend must return a projection plus causal watermark from one logical read boundary. The stream begins strictly after that watermark; invalid/expired/non-monotonic cursors fail visibly to a fresh bootstrap.

### Presence

Presence remains ephemeral, TTL/liveness bounded, authorization scoped, and absent from canonical/event replay. Durable Work/execution events survive restart; presence does not.

### Shell boundary

The shell is a browser/BFF projection over injected public ports. It does not own persistence, sessions, Work semantics, GitHub, sandbox, effect reconciliation, or authority evaluation.

### Takeover/handoff

Work assignment transition and execution control remain separate governed operations correlated by Work/episode/activity/execution/trace IDs. A UI action never silently mutates both domains.

### External-effect recovery

An ambiguous GitHub/provider outcome is represented as `uncertain`/reconciliation-required. Blind retry is prohibited until the execution lane resolves whether the effect occurred. Reconnect/replay can never reissue an external effect.

## Interfaces expected from other P1 lanes

The exact names are reversible; semantic requirements are fixed in spec section 6.

### From #14 durable state/auth

Required equivalent public seams:

- authenticated session resolution and active-session/revocation check;
- contextual authorization for principal + workspace + operation + resource + purpose;
- durable shell/Work/App projection bootstrap returning a causal watermark;
- non-destructive durable event read after an explicit workspace causal cursor;
- authoritative Work command seam for handoff/takeover/suspend/resume with expected-version/idempotency/authority behavior.

Native browser `EventSource` cannot attach arbitrary Authorization headers, so #14 must expose a safe same-origin session/BFF-compatible mechanism. Credentials in SSE query strings are forbidden.

### From #15 execution/GitHub/sandbox

Required equivalent public seams:

- start/control coding execution correlated to WorkInstance/WorkEpisode;
- durable execution state including explicit effect state;
- durable provider-neutral progress/evidence/verification/review/PR metadata/events;
- `uncertain` external-effect state and reconciliation;
- idempotent/reconcilable GitHub writes;
- no GitHub credentials or sandbox internals exposed through browser contracts.

Do not depend on #14/#15 internal file layout.

## Future file ownership

The three tickets intentionally do not overlap:

- P1C-001 owns only the exact `packages/realtime` files listed in its ticket.
- P1C-002 owns only the exact `apps/woyengi` files listed in its ticket.
- P1C-003 owns only new `benchmarks/conformance` fixture/test files listed in its ticket.

If another implementation lane has claimed any listed file by the time P1 starts, stop and re-ticket the seam. Do not create shared mutable ownership.

## Branch / planning commits

Planning commits created in order:

- `12329b698f7b99cb5d8e5eaf4d65ca1c72b5b142` — P1-C specification.
- `19f26b0eca9efe37a17557645c1bcda42d2d0f62` — P1C-001 resumable SSE tracer ticket.
- `02ba08f3e4ed8a82dabce0e36e6842bd09a43170` — P1C-002 live shell collaboration tracer ticket.
- `c2899f8475b9a43eb3c31fde168b4633e9bcd106` — P1C-003 coding live E2E tracer ticket.

This handoff is the final planning artifact on the same branch.

## Evidence inspected during planning

Read-only repository evidence included:

- issue #6 program ordering;
- issues #14, #15 and #16 lane boundaries;
- `AGENTS.md`, `agent.md`, `CONSTITUTION.md`, `docs/architecture.md`, `CONTEXT.md`;
- `docs/specs/p0-ecosystem-alignment.md` and the P0 handoff;
- current `prd.json` WYG-004/WYG-010/WYG-011/WYG-019/WYG-020 contract text;
- `progress.txt`, whose latest inspected entry states WYG-026 integrated and identifies durable multiplayer/coding vertical as next work while production readiness remains open;
- `packages/realtime/src/index.ts` and collaboration tests;
- `packages/event-bus/src/index.ts` durable event/cursor behavior;
- `packages/work/src/index.ts` handoff/takeover/suspend/resume semantics;
- `apps/woyengi` shell server/demo/client/tests;
- `services/platform-api` request/response subscription and current bearer-auth shape;
- root verification scripts.

External transport evidence was checked against the current WHATWG HTML/EventSource standard, MDN WebSocket documentation, and Node 24 HTTP documentation and is linked from the spec.

## Tests / commands actually run

No repository tests, typecheck, benchmark, production gate, or source build was run because this task is planning-only and changed documentation/handoff artifacts only.

No claim is made that P1 implementation is GREEN.

The future tickets require their own targeted RED/GREEN tests followed by:

```bash
pnpm typecheck
pnpm boundaries
pnpm test:all
pnpm prod:check:fast
```

with ticket-specific targeted commands and human QA recorded in each ticket.

## Authority / external-effect status

No operational state, user data, semantic commit, provider action, sandbox execution, GitHub issue/PR effect, release flag, or P0 acceptance state was changed.

The only external effects were the requested GitHub planning-file commits on `plan/p1-realtime-shell-coding`.

## Unresolved questions / risks

1. P0 is not yet accepted; P1 must remain blocked.
2. #14 and #15 are planning lanes at this point, so their final public contract names may differ. Reconcile semantics, not file internals, before implementation.
3. Same-origin EventSource authentication requires lane A's session/BFF-compatible mechanism; query bearer tokens are forbidden.
4. SSE proxy buffering/idle timeout behavior needs deployment-level heartbeat/flush verification in self-host mode.
5. Durable cursor retention/compaction policy belongs with persistent state; expired cursor must return explicit resync-required behavior.
6. Bulk sandbox logs may need artifact references rather than realtime state events; do not overload SSE before measuring the product need.
7. Interactive terminal/CRDT collaboration is a future WebSocket reconsideration trigger, not P1 scope.
8. P1C-002 does not own `apps/woyengi/test/visual-qa.mjs`; if that unchanged harness cannot exercise the live entrypoint, use the owned live-shell test plus human QA and record the limitation rather than expanding file ownership silently.

## Exact next skill / action

**Do not implement yet.**

1. Wait for P0 issues #7-#11 to land and for the required P0 human acceptance under #6.
2. Once #14 and #15 publish accepted implementation contracts, reconstruct only their public seams and compare them to section 6 of `docs/specs/p1-realtime-shell-coding.md`.
3. If the semantic contracts match, take `P1C-001-resumable-sse-delivery.md` as the first implementation ticket and start with its RED reconnect/revocation/backpressure falsifiers before production code.
4. If a required public semantic seam is missing, stop at the interface boundary and revise/re-ticket that contract; do not import another lane's internal files.
5. After P1C-001 is independently verified, execute P1C-002, then P1C-003 in dependency order.