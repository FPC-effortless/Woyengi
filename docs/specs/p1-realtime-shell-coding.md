# P1 Realtime Transport, Live Shell, and Coding Vertical Specification

Status: Planning complete; implementation blocked on P0 acceptance and P1 lane dependencies
Date: 2026-08-27
Work mode: Product engineering
Program: #6
Planning lane: #16 (`plan/p1-realtime-shell-coding`)

## 1. Problem and intended outcome

Woyengi already has the semantic pieces for multiplayer Work, durable platform events, governed execution, and a unified shell, but the live product seam is incomplete:

- `packages/realtime` models authorized collaboration, durable Work events, optimistic versions, and ephemeral presence, but it has no browser/network transport;
- `packages/event-bus` persists events and server-side subscriber cursors with causal `ledgerSequence`, but the current consumption API is not a browser-owned reconnect cursor contract;
- `packages/work` already models assignment, handoff, takeover, give-back, suspend, and resume as versioned Work operations;
- `apps/woyengi` serves an accessible shell and a `/api/shell` snapshot route, but `src/demo.ts` injects synthetic state and `public/app.js` reloads whole snapshots rather than following live backend state;
- `services/platform-api` exposes authenticated request/response subscriptions, not a durable long-lived browser stream; current development authentication is a fixed bearer-token local operator and is not the P1 session model;
- the coding-first reference flow is specified by WYG-020 but is not yet proven through the real shell, GitHub execution, governed sandbox, evidence, independent verification/review, and PR publication.

The intended P1-C outcome is one live, self-hostable product tracer:

```text
authenticated principal
-> live Woyengi shell
-> authorized Workspace + Work projection
-> resumable durable event stream + ephemeral presence
-> GitHub issue represented as shared Work
-> separately granted coding agent
-> governed sandbox execution
-> tests/evidence
-> independent verification/review
-> authorized PR publication
-> live accepted-outcome projection
```

Network loss, server restart, session revocation, human takeover, execution failure, and resumed agent work must not create silent event loss, cross-workspace leakage, stale governing UI state, or duplicate external effects.

## 2. Scope

This lane specifies:

1. durable multiplayer browser delivery over a resumable transport;
2. the boundary between durable event cursors and ephemeral presence;
3. a live Woyengi shell backed by public state/auth/execution ports rather than demo state;
4. user/agent handoff, takeover, suspend, resume, reconnect, and recovery UX;
5. the coding-first GitHub issue -> Work -> agent -> sandbox -> tests/evidence -> independent verification/review -> PR flow;
6. observability for connect/reconnect, lag, authorization failure, stale projection, command conflict, recovery, and stream termination;
7. falsifier-first verification and a final local E2E gate.

## 3. Non-goals

- Do not redesign `OperationalSystemSpec`, Work, authority, effect, verification, accepted-outcome, or semantic-commit semantics from the UI/transport layer.
- Do not make presence canonical or durable.
- Do not implement a second event log in the shell or transport.
- Do not let a UI command imply that a Work transition or external effect happened before the authoritative backend accepts and records it.
- Do not expose GitHub credentials, sandbox internals, provider tokens, private capability grants, or internal evaluation material to the browser.
- Do not add CRDT collaborative text editing, interactive terminal multiplexing, voice/video, or arbitrary binary streaming in this slice.
- Do not make Woyengi Cloud necessary; the slice must work in the local/self-hosted deployment.
- Do not begin P1 implementation before P0 is accepted.

## 4. Reconstructed context and governing invariants

The governing sources are `CONSTITUTION.md`, `docs/architecture.md`, `CONTEXT.md`, `docs/specs/p0-ecosystem-alignment.md`, issue #6, issue #16, and the current public package seams.

The implementation must preserve these invariants:

1. Durable Work/execution state is reconstructed from typed history; the browser is a projection, never a source of canonical truth.
2. Presence is ephemeral. A reconnect rebuilds presence from currently connected sessions; it must not replay historical presence.
3. Workspace and principal scope are explicit on every read, subscription, command, and emitted event.
4. Authority is checked at connection/subscription time and again whenever a durable or ephemeral item could be disclosed; session revocation must terminate access rather than wait for a page reload.
5. Durable events retain one causal ordering source. The transport must not invent a competing sequence.
6. Delivery is at-least-once at the reconnect boundary; duplicate deliveries are detectable and client reducers are idempotent.
7. Replay/reconnect may re-deliver observations/events, but it must never reissue semantic or external effects.
8. Handoff/takeover/suspend/resume remain Work operations with optimistic version checks and authorization references.
9. Execution progress does not imply accepted outcome. Tests/evidence, reconciliation, independent verification/review, and acceptance remain distinct stages.
10. App/shell projections remain downstream of P0 `OperationalSystemSpec`; this lane does not restore AppBlueprint as canonical product meaning.

## 5. Wayfinder decision graph

### D1 — Which network transport should carry the P1 live vertical?

**Selected:** same-origin Server-Sent Events (SSE) for server -> browser durable/projection updates, paired with ordinary authenticated/idempotent HTTP commands for browser -> server actions.

**Why:**

- the product's durable realtime flow is predominantly ordered backend state/progress -> browser projection;
- the WHATWG EventSource contract has reconnection semantics and `Last-Event-ID`, which maps directly to an explicit durable causal cursor: https://html.spec.whatwg.org/multipage/server-sent-events.html;
- SSE is ordinary HTTP and can be hosted by the repository's existing Node HTTP server shape without an HTTP Upgrade/raw-socket protocol path;
- command writes already need distinct authorization, idempotency, optimistic-version, and effect semantics, so sending them as explicit HTTP requests keeps the write boundary inspectable;
- browser WebSocket is two-way, but MDN notes that the stable `WebSocket` API has no backpressure: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket;
- Node's HTTP server exposes WebSocket-style protocol switching through the low-level `upgrade` socket path, adding connection machinery that is not justified by this slice's predominantly server-push workload: https://nodejs.org/download/release/latest-v24.x/docs/api/http.html#event-upgrade.

**Rejected for P1:** WebSocket as the default transport. It is viable, but it creates a second bidirectional command protocol, requires explicit reconnect/replay semantics anyway, and adds server upgrade/backpressure complexity before a high-frequency bidirectional use case exists.

**Revisit trigger:** interactive terminal input/output, CRDT editor synchronization, binary/high-frequency collaboration, or measured SSE/HTTP constraints that cannot be solved without a bidirectional session.

### D2 — Who owns the durable reconnect cursor?

**Selected:** the client presents an opaque cursor representing an immutable workspace causal position. The SSE `id` field carries that cursor; the browser's reconnect `Last-Event-ID` resumes after it. The transport reads non-destructively from the durable event history after that position.

**Reason:** server-side subscriber cursor advancement after `response.write()` cannot prove the browser received the bytes. Treating a network write as an acknowledgement creates a silent-loss window. Existing durable server-side subscription cursors remain valid for worker consumers, but the browser transport requires a public read-after-cursor seam that does not mutate consumer progress.

**Constraint:** cursors are non-authoritative locators, not capabilities. Authorization is evaluated independently of cursor possession.

### D3 — How is a snapshot made consistent with the event stream?

**Selected:** bootstrap returns a projection and its causal watermark atomically or from the same reconstruction boundary:

```ts
interface ProjectionBootstrap<T> {
  readonly projection: T;
  readonly cursor: string;
  readonly projectionVersion: number;
}
```

The client opens the stream strictly *after* that cursor. On reconnect it resumes from its last applied cursor. If a cursor is expired/invalid, ordering regresses, authorization changes, or the projection version cannot accept an event, the client fails closed to a fresh bootstrap rather than guessing.

### D4 — What is durable versus ephemeral?

**Durable:** Work/activity transitions, execution lifecycle/progress that must survive restart, evidence/verification/review/accepted-outcome changes, and any user-visible state transition whose history matters.

**Ephemeral:** online/away state, currently viewed Work/activity, transient typing/focus hints. Presence uses TTL/connection liveness and is republished after reconnect; it is not written to the canonical/event ledger.

### D5 — Where do browser commands terminate?

**Selected:** the shell is a thin browser/BFF surface over injected public ports. It may host same-origin HTTP/SSE routes, but it does not implement persistence, GitHub, sandbox, authority, or effect semantics. Commands are delegated to public ports from the owning P1 lanes.

This avoids browser possession of backend/provider credentials and avoids coupling this lane to another lane's internal files.

### D6 — How does takeover/handoff interact with running execution?

**Selected:** Work assignment state and execution control remain separate but correlated by trace/episode/activity identifiers.

- Handoff/takeover/suspend/resume is first authorized and recorded through the Work command port.
- If the transition requires execution cancellation/suspension, the execution lane receives a separate governed command with its own idempotency/effect semantics.
- The shell may display a pending transition, but the governing UI state changes only from the accepted Work/execution projection.
- An uncertain external effect blocks blind retry until reconciliation resolves whether it occurred.

### D7 — What is the stale-UI policy?

**Selected:** fail visibly and resynchronize. Every durable UI reducer checks cursor monotonicity plus the relevant projection/work/execution version. Conflicting or older events are never silently applied. Command conflicts return the authoritative version/cursor needed for refresh.

## 6. Required provider-neutral interfaces

The concrete packages may choose equivalent names, but the semantics below are required. This lane consumes public indexes/ports only and must not import persistence/auth or execution/GitHub implementation files.

### 6.1 Expected from P1 lane A (#14): persistence/auth/session/work

```ts
interface AuthenticatedSession {
  readonly sessionId: string;
  readonly principalId: string;
  readonly activeWorkspaceId: string;
  readonly expiresAt: string;
}

interface SessionPort {
  resolve(request: unknown): Promise<AuthenticatedSession | undefined>;
  assertActive(sessionId: string): Promise<AuthenticatedSession>;
}

interface AuthorizationPort {
  authorize(input: {
    readonly principalId: string;
    readonly workspaceId: string;
    readonly operation: "READ" | "SUBSCRIBE" | "PRESENCE" | "EXECUTE" | "CONTROL";
    readonly resourceId: string;
    readonly purpose: string;
  }): Promise<{ readonly allowed: boolean; readonly authorizationReference?: string; readonly rationale: string }>;
}

interface ShellStateReadPort {
  bootstrap(input: {
    readonly principalId: string;
    readonly workspaceId: string;
  }): Promise<ProjectionBootstrap<unknown>>;
}

interface DurableEventReadPort {
  readAfter(input: {
    readonly principalId: string;
    readonly workspaceId: string;
    readonly scope: readonly string[];
    readonly after?: string;
    readonly limit: number;
  }): Promise<{
    readonly events: readonly {
      readonly id: string;
      readonly cursor: string;
      readonly topic: string;
      readonly aggregateId: string;
      readonly payload: unknown;
      readonly transactionTime: { readonly from: string };
    }[];
    readonly watermark: string;
  }>;
}

interface WorkCommandPort {
  handoff(input: unknown): Promise<unknown>;
  takeOver(input: unknown): Promise<unknown>;
  suspend(input: unknown): Promise<unknown>;
  resume(input: unknown): Promise<unknown>;
}
```

Semantic requirements on lane A:

- session revocation is observable on an already-open stream via `assertActive`/equivalent;
- Work/App/shell reads are durable across restart and strictly workspace scoped;
- `bootstrap()` exposes a causal watermark from the same logical read boundary as the projection;
- `readAfter()` is non-destructive and client-cursor driven; it must not advance a server consumer cursor merely because bytes were written to a socket;
- authorization defaults to deny and does not trust a browser-supplied workspace/principal claim;
- Work commands require idempotency/expected version/authority semantics even if exact request shapes differ.

### 6.2 Expected from P1 lane B (#15): execution/GitHub/sandbox

```ts
interface CodingExecutionPort {
  startFromIssue(input: {
    readonly principalId: string;
    readonly workspaceId: string;
    readonly workInstanceId: string;
    readonly workEpisodeId: string;
    readonly issueRef: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly executionId: string; readonly traceId: string; readonly state: string }>;

  suspend(input: unknown): Promise<unknown>;
  resume(input: unknown): Promise<unknown>;
  cancel(input: unknown): Promise<unknown>;
}

interface CodingExecutionReadPort {
  get(input: {
    readonly principalId: string;
    readonly workspaceId: string;
    readonly executionId: string;
  }): Promise<{
    readonly executionId: string;
    readonly traceId: string;
    readonly state: string;
    readonly effectState: "none" | "planned" | "observed" | "uncertain" | "reconciled";
    readonly evidenceRefs: readonly string[];
    readonly verificationRefs: readonly string[];
    readonly reviewRefs: readonly string[];
    readonly pullRequestRef?: string;
  }>;
}
```

Semantic requirements on lane B:

- every execution/status/evidence/verification/review transition needed by the shell is available as durable provider-neutral state/event data correlated by `workspaceId`, Work IDs, `executionId`, and `traceId`;
- GitHub credentials and Docker/process internals never cross the browser interface;
- provider writes remain idempotent/reconcilable and expose an explicit `uncertain` state when outcome cannot be known;
- resuming after failure/takeover cannot blindly repeat a GitHub or other external effect;
- PR publication is a governed external effect after the required verification/review boundary, not a frontend convenience call.

## 7. Realtime wire contract

The exact JSON schema remains implementation-reversible, but the first implementation must preserve this semantic envelope:

```ts
interface RealtimeEnvelope {
  readonly contract: "woyengi.realtime.v1";
  readonly id: string;
  readonly cursor: string;
  readonly workspaceId: string;
  readonly aggregateId: string;
  readonly topic: string;
  readonly projectionVersion?: number;
  readonly transactionTime: { readonly from: string };
  readonly payload: unknown;
  readonly traceId?: string;
}
```

SSE rules:

- `Content-Type: text/event-stream`; no buffering cache;
- `id:` is the opaque durable cursor for durable events;
- `event:` is a bounded public event class, not an arbitrary internal topic escape hatch;
- `data:` is one normalized JSON envelope;
- heartbeat comments keep intermediaries/liveness detectable but never advance the durable cursor;
- stream start authenticates and authorizes the session; each delivery rechecks current session/authority or an equivalent revocation-aware capability snapshot with a bounded lifetime;
- server disconnects on revocation/forbidden scope and emits no further payload;
- backpressure uses Node writable-stream signals; bounded queues terminate/resync rather than accumulate without bound;
- duplicate durable IDs are safe; a lower/non-monotonic cursor forces resync;
- reconnect after a valid cursor may duplicate the boundary event but may not omit a later authorized durable event.

Presence rules:

- separate best-effort command and fanout channel under the same authenticated session;
- presence has `sessionId`, principal, workspace, Work/target scope, state, observed time, and TTL/expiry;
- presence is rate-limited, authorization-filtered, memory-bounded, and removed on expiry/disconnect;
- no presence item enters canonical storage or durable event replay;
- a public/narrow session cannot infer internal participants or capabilities through presence.

## 8. Live shell state and command model

The shell keeps the existing product hierarchy: Home, Work, Apps, Inbox, Search, and Ask/Create/Delegate, with advanced constitutional details behind inspect mode.

The live shell must add only projection/control behavior required by this slice:

- authenticated current principal and workspace selector from durable state;
- active Work list and selected Work details from durable Work projections;
- live activity/execution timeline with connection state (`live`, `reconnecting`, `resyncing`, `offline`);
- current assignee/agent/human presence;
- explicit Handoff, Take over, Suspend, Resume controls shown only when the backend says the operation is authorized/applicable;
- coding execution state: issue, sandbox/run state, tests, evidence, independent verification/review, PR publication state;
- explicit `uncertain`/reconciliation-required state for ambiguous external effects;
- no optimistic claim that an external effect, verification, accepted outcome, or PR exists before backend confirmation.

Workspace switch is a security boundary: close the old stream, clear old in-memory projection/presence, bootstrap the new authorized workspace, then open its stream. Old-workspace events arriving during the transition are discarded before render.

## 9. Coding-first E2E contract

The final tracer must prove this sequence under one correlated Work/episode/execution trace:

1. An authenticated human imports/selects a GitHub issue through the execution lane's public contract.
2. The issue becomes or is linked to shared `WorkInstance` state, with a bounded `WorkEpisode` for the coding attempt.
3. A separately granted `AgentPrincipal` receives the assignment; the human can observe the durable transition live.
4. The agent starts a governed sandbox execution through lane B.
5. The shell streams durable execution progress without receiving provider credentials or private sandbox internals.
6. Code/test outcomes produce evidence references.
7. Independent verification/review is represented separately from execution success.
8. Only after required gates can a governed GitHub PR publication effect be attempted.
9. The PR reference and accepted outcome appear through durable backend state/events.
10. A second human session sees the same authorized Work history and live transitions.

Required interruption branch:

- disconnect the first human client during execution;
- reconnect from its last cursor and recover all later durable authorized events without duplicate rendered activities;
- take over or suspend the agent from a human session;
- simulate a failed/uncertain external operation;
- verify retry is blocked until reconciliation or is idempotently resolved;
- resume/hand back to the agent and complete without creating a duplicate PR/effect.

## 10. Falsifier-first matrix

| Falsifier | Required observation if implementation is correct |
| --- | --- |
| Client disconnects after event N and reconnects with cursor N | Every authorized durable event after N is delivered in causal order; no silent loss. |
| Reconnect boundary re-delivers event N | UI reducer applies N once; Work/activity counts do not double. |
| Transport receives an event with a lower/non-monotonic cursor | Event is not silently applied; shell enters resync and obtains a fresh bootstrap. |
| Durable events exist between snapshot read and stream open | Bootstrap cursor + read-after-cursor closes the race; no event is missed. |
| Browser presents a valid cursor from another workspace | Authorization rejects/filters it; cursor possession grants nothing. |
| Session is revoked while SSE is open | Stream terminates before any post-revocation protected payload is emitted. |
| Workspace switch races with old stream delivery | Old-workspace event never renders in the new workspace. |
| Public/narrow session subscribes to internal Work/capability data | No protected payload, participant, capability, credential, or private evidence locator leaks. |
| Presence process/server restarts | Durable Work history resumes; stale presence does not replay. |
| Presence client disappears without clean disconnect | TTL expires the presence entry; memory remains bounded. |
| Human takeover uses stale Work version | Command fails explicitly with conflict/current version; frontend does not claim takeover. |
| Handoff/takeover accepted while agent execution is active | Work and execution control transitions remain correlated but separate; no hidden semantic shortcut. |
| Execution crashes after an external request with unknown outcome | UI shows `uncertain`/reconciliation required; blind retry cannot create a duplicate effect. |
| GitHub PR creation response is lost | Recovery reconciles by stable idempotency/trace identity; at most one PR/effect is accepted. |
| Test command succeeds but verification fails | Shell does not display accepted outcome/ready-to-publish as if verification passed. |
| SSE consumer is slower than producer | Buffer is bounded; backpressure/termination/resync occurs instead of unbounded memory growth. |
| Server restarts while clients are connected | Clients reconnect from durable cursors; durable history survives, presence rebuilds ephemerally. |

## 11. Observability and evidence seams

Minimum safe telemetry, without sensitive payload bodies:

- stream open/close/reconnect/resync count by workspace-safe hashed/bounded identifier;
- reconnect reason and last/next cursor metadata;
- event delivery lag from transaction time;
- duplicate/drop/resync counters;
- authorization/session-revocation termination count;
- presence entry count/expiry count and rate-limit rejections;
- command conflict/idempotent replay count;
- execution recovery and `uncertain -> reconciled` transitions by trace ID;
- E2E trace correlation from Work -> execution -> evidence -> verification/review -> external PR reference.

Never log bearer/session secrets, GitHub credentials, command bodies containing secrets, private evidence content, sandbox environment variables, or internal capability grants.

## 12. Migration, replay, rollback

- Existing `CollaborationHub` and `LocalEventBus` behavior remains available to non-browser consumers.
- Add the browser-cursor read seam without silently changing worker subscription acknowledgement semantics.
- The demo shell may remain as a visual fixture/explicit demo entrypoint, but the normal live entrypoint must not seed fake product state.
- Frontend reducers must be rebuildable from a live bootstrap plus ordered events; browser local storage is not canonical state.
- Rolling back the realtime transport returns the shell to explicit non-live behavior; it must not corrupt durable Work/event history.
- Reconnect/replay never invokes command handlers or external effect ports.

## 13. Acceptance criteria

P1-C is implementation-ready when this plan is accepted; it is implementation-complete only when all of the following are true after P0 acceptance:

1. An authenticated browser gets a durable shell bootstrap plus causal cursor from lane A-backed state.
2. SSE delivers authorized durable Work/execution changes and resumes from `Last-Event-ID`/equivalent explicit cursor without silent loss.
3. Presence is ephemeral, scoped, expiring, and never enters durable replay.
4. Session revocation and workspace switching terminate old disclosure paths.
5. Handoff/takeover/suspend/resume use authoritative Work operations with conflicts visible.
6. Failed/uncertain execution cannot be represented as accepted outcome and cannot blindly duplicate an external GitHub effect.
7. The shell renders backend state rather than `src/demo.ts` fixtures in the live entrypoint.
8. The coding E2E proves issue -> Work -> agent -> sandbox -> tests/evidence -> independent verification/review -> PR under one trace.
9. Required reconnect/order/duplicate/leakage/stale-projection/takeover/recovery falsifiers pass.
10. Targeted tests, `pnpm typecheck`, `pnpm boundaries`, and `pnpm test:all` pass. `pnpm prod:check:fast` is executed and any unrelated human/release gate remains reported accurately rather than being overridden by this lane.
11. Human QA exercises two human browser sessions plus one AgentPrincipal, forced network loss, workspace switch, takeover/handoff, and recovery.

## 14. Human QA / authority gates

Human acceptance must confirm:

- the live shell never implies stronger authority or outcome state than the backend recorded;
- workspace switching and revocation visibly fail closed;
- reconnect behavior is comprehensible and does not duplicate timeline items;
- takeover/handoff controls match real Work authority and execution state;
- `uncertain` external effects are visibly distinct from failed/succeeded effects;
- the coding flow remains useful without exposing GitHub/sandbox/provider internals;
- P0 remains the governing operational-contract substrate and this UI/transport layer did not redesign it.

## 15. Dependencies and hard blockers

Implementation MUST NOT begin until:

1. P0 issues #7-#11 have landed and P0 human acceptance required by #6 has occurred;
2. lane A (#14) publishes accepted durable persistence/auth/session/Work public ports satisfying section 6.1 or an explicitly reviewed equivalent;
3. lane B (#15) publishes accepted governed execution/GitHub/sandbox public ports satisfying section 6.2 or an explicitly reviewed equivalent.

This plan depends on those public contracts, not on their internal files. If either lane cannot satisfy the required semantics, update the interface contract before coding rather than reaching into its implementation.

## 16. Unresolved risks

1. Native browser `EventSource` cannot attach arbitrary bearer authorization headers. The preferred P1 deployment therefore requires a same-origin session mechanism (for example an HttpOnly session cookie) or a server-side BFF that resolves the authenticated session without putting credentials in the stream URL. Query-string bearer tokens are forbidden.
2. Long-lived proxies may buffer or terminate SSE. The self-hosted deployment needs heartbeat/flush/proxy tests and documented timeout settings.
3. Cursor retention/compaction policy is owned with durable state. An expired cursor must produce an explicit resync requirement, never an empty stream that looks current.
4. High-volume sandbox logs may exceed the intended state-event channel. P1 should stream bounded progress/evidence metadata; bulk logs/artifacts remain referenced artifacts unless measured UX requires a separate stream.
5. If the coding UI later needs interactive terminal input or collaborative text editing, WebSocket (or another bidirectional transport) should be reconsidered as a separate capability rather than overloading the P1 SSE contract.

## 17. Ticket order

1. `P1C-001` — durable authorized SSE delivery and reconnect cursor seam.
2. `P1C-002` — live shell projection, presence, takeover/handoff, and recovery UX over public ports.
3. `P1C-003` — coding-first multi-client E2E and failure/reconnect proof.

Each ticket is a tracer bullet with non-overlapping future file ownership. Production work remains blocked until the dependencies in section 15 are accepted.