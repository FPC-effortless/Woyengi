# P1C-002 — Live shell projection, presence, takeover/handoff, and recovery UX

Status: BLOCKED — planning only until P0, lane A, lane B, and P1C-001 prerequisites are accepted
Parent planning issue: #16
Spec: `docs/specs/p1-realtime-shell-coding.md`
Work mode: Product engineering

## Outcome Contract

Replace the normal shell's synthetic/snapshot-only behavior with a same-origin live product surface that consumes accepted public ports for session/state, realtime delivery, Work commands, and coding execution.

A human must be able to open the shell, see the authenticated Workspace/Work projection, follow live durable changes, observe ephemeral collaborators, and perform authorized handoff/takeover/suspend/resume operations. Network loss, stale optimistic versions, workspace switches, session revocation, and uncertain execution effects must be visible and fail closed rather than producing a misleading UI.

The existing product hierarchy stays intact: Home, Work, Apps, Inbox, Search, Ask/Create/Delegate, with advanced constitutional detail behind inspect mode.

## Prerequisites / blockers

Hard blockers:

- P0 accepted under #6.
- P1 lane A (#14) accepted public session/auth/durable Workspace/Work/App ports.
- P1 lane B (#15) accepted public coding-execution/GitHub/sandbox ports and durable execution state/events.
- P1C-001 accepted resumable SSE adapter/public seam.

Do not import lane A/B internal adapters or source files. If their public interfaces differ from the semantic contracts in the spec, adapt through this ticket's shell port boundary or re-plan the interface; do not bypass the boundary.

## Future exclusive file ownership

The future coding agent for this ticket may edit ONLY:

- `apps/woyengi/README.md`
- `apps/woyengi/src/index.ts`
- `apps/woyengi/src/live.ts` (new)
- `apps/woyengi/public/index.html`
- `apps/woyengi/public/styles.css`
- `apps/woyengi/public/app.js`
- `apps/woyengi/test/shell.test.ts`
- `apps/woyengi/test/live-shell.test.ts` (new)

`apps/woyengi/src/demo.ts` remains an explicit demo/visual fixture and is NOT part of the live implementation ownership. The live entrypoint must not import its synthetic dataset.

No later P1-C ticket may edit the files above. If another lane has already claimed one before implementation, stop and re-ticket rather than sharing ownership.

## State inputs

From lane A public ports:

- server-resolved authenticated session/principal;
- authorized Workspace list and active Workspace;
- durable shell/Work/App projection bootstrap + causal cursor;
- current Work assignment/version/applicability/authority data needed to render controls;
- Work command results for handoff, takeover, suspend, resume.

From P1C-001:

- authorized durable SSE stream after bootstrap/last-applied cursor;
- bounded ephemeral presence update/fanout seam;
- explicit reconnect/resync/forbidden/expired-cursor outcomes.

From lane B public ports:

- coding execution state correlated to Work/episode/activity/trace;
- start/suspend/resume/cancel commands where authorized;
- tests/evidence/verification/review/PR reference projections;
- explicit uncertain/reconciliation-required effect state.

## State outputs

Browser-rendered projection only:

- authenticated principal/workspace context;
- live Work/activity/execution timeline;
- connection indicator: `live`, `reconnecting`, `resyncing`, or `offline`;
- ephemeral collaborator/presence display;
- current assignee and applicable authorized controls;
- coding execution/evidence/verification/review/PR status;
- explicit pending-command/conflict/uncertain-effect messages.

Commands sent by the browser:

- presence update;
- handoff/takeover/suspend/resume with expected Work version and idempotency identity;
- coding execution start/control through lane B's public port.

Browser local state is never canonical and must be discardable/rebuildable from bootstrap + ordered events.

## Public shell port seam

Evolve the existing `ShellPorts` behind an equivalent explicit boundary rather than importing backend implementations:

```ts
export interface LiveShellPorts {
  resolveSession(request: unknown): Promise<{
    readonly sessionId: string;
    readonly principalId: string;
    readonly activeWorkspaceId: string;
  } | undefined>;

  loadSnapshot(input: {
    readonly sessionId: string;
    readonly workspaceId?: string;
  }): Promise<{
    readonly snapshot: ShellSnapshot;
    readonly cursor: string;
    readonly projectionVersion: number;
  }>;

  openRealtime(input: {
    readonly sessionId: string;
    readonly workspaceId: string;
    readonly after?: string;
  }): Promise<unknown>; // P1C-001 stream handle/adapter seam

  updatePresence(input: unknown): Promise<void>;
  handoff(input: unknown): Promise<unknown>;
  takeOver(input: unknown): Promise<unknown>;
  suspendWork(input: unknown): Promise<unknown>;
  resumeWork(input: unknown): Promise<unknown>;
  startCodingExecution(input: unknown): Promise<unknown>;
  controlCodingExecution(input: unknown): Promise<unknown>;
}
```

Exact type names may change, but all shell routes call injected public ports. No GitHub token, Docker socket, storage path, or authority registry is visible to browser code.

## Same-origin/browser authentication boundary

Native `EventSource` cannot attach an arbitrary Authorization header. Therefore:

- the live shell MUST use lane A's accepted same-origin session mechanism or a server-side BFF session resolver;
- credentials MUST NOT be placed in query parameters or SSE event data;
- browser JS MUST NOT receive the backend's provider/API bearer token;
- session cookies, if lane A selects them, must use its accepted HttpOnly/SameSite/Secure policy as appropriate to deployment;
- each command and stream request resolves the server-side session independently and remains workspace scoped.

This ticket does not invent the session store or revocation semantics.

## Browser routes / behavior

Exact route spelling is reversible, but the live shell requires equivalent behavior:

- `GET /api/shell[?workspace=...]` -> authenticated projection bootstrap `{data, cursor, projectionVersion}`;
- `GET /api/realtime?...` -> authenticated SSE stream after bootstrap/reconnect cursor;
- `POST /api/presence` -> bounded ephemeral update;
- Work command routes for handoff/takeover/suspend/resume;
- coding execution command routes for start/control.

Every write command requires an idempotency key and relevant expected version. Browser action success means "command accepted" only; the governing UI transition follows authoritative returned state or subsequent durable event.

## Rendering / reducer rules

1. Apply only events for the active authenticated workspace.
2. Track last applied durable cursor and relevant projection/resource versions.
3. Duplicate event ID/cursor is a no-op.
4. Older/non-monotonic event or incompatible projection version triggers full resync.
5. While resyncing, do not merge new-workspace state with stale old-workspace state.
6. A workspace switch first closes the old stream and clears its projection/presence, then bootstraps and opens the new stream.
7. A stream authorization failure clears protected live state and displays an authentication/authorization recovery state.
8. Presence is cleared/rebuilt on reconnect; durable activity remains.
9. Pending controls are disabled against duplicate clicks until accepted/rejected; idempotency still protects the backend.
10. `effectState: uncertain` is rendered distinctly and disables blind retry/publication until reconciliation says retry is safe or the effect is resolved.
11. Test success is not rendered as verification success; verification/review is not rendered as accepted outcome; accepted outcome is not inferred from PR existence.

## Required UX surface for selected Work

The live Work surface must expose, at minimum:

- Work title/intent/status and current version;
- current human/agent assignment;
- active WorkEpisode/execution state;
- ordered recent durable activity;
- online collaborators/presence as ephemeral metadata;
- Handoff / Take over / Suspend / Resume only when applicable/authorized;
- coding issue reference;
- sandbox/execution phase;
- test/evidence references in a bounded inspectable form;
- independent verification/review status;
- PR publication state/reference;
- reconciliation warning for uncertain external effects;
- connection/reconnect/resync state.

Do not move provenance/authority/conflict graph internals into the default navigation. Inspection may reveal relevant authority/evidence details when explicitly opened.

## Explicit non-goals

- No change to Work domain operation semantics.
- No persistence/session implementation.
- No GitHub/sandbox/provider implementation.
- No alternate realtime event log.
- No frontend framework migration.
- No CRDT editor or interactive terminal.
- No production Cloud dependency.
- No automatic accepted-outcome state based on frontend heuristics.
- No removal of the explicit demo fixture solely to make the live path exist.

## Falsifiers / tests first

Add failing public-behavior tests before implementation.

1. **No demo dependency:** live entrypoint cannot import/use `src/demo.ts`; bootstrap data comes from injected backend ports.
2. **Snapshot + cursor:** `/api/shell` returns snapshot and causal cursor from the same port result.
3. **Same-origin auth:** unauthenticated snapshot/stream/command requests fail closed; no credential appears in URL/HTML/JS-visible bootstrap.
4. **Reconnect:** force stream disconnect after event N; browser/harness reconnects from N and applies later events without duplicate rendered activity.
5. **Stale event:** deliver lower cursor/version; client enters resync and does not mutate governing display from stale event.
6. **Workspace race:** switch A -> B while an A event arrives; A content never renders in B.
7. **Session revocation:** revoke active session; stream terminates/clears protected state and commands stop succeeding.
8. **Presence durability boundary:** restart/reconnect clears presence while Work history remains.
9. **Permission leakage:** narrow/public fixture cannot render internal capability grants, credentials, hidden participant data, or private evidence locator.
10. **Takeover conflict:** submit takeover with stale Work version; UI displays conflict/current-state recovery and never claims success.
11. **Duplicate click:** invoke handoff/control twice; browser sends stable idempotency identity for the logical command and renders one authoritative transition.
12. **Handoff/takeover correlation:** accepted Work transition and separate execution suspend/cancel transition share trace/episode correlation without one silently implying the other.
13. **Uncertain effect:** execution reports `uncertain`; retry/publication control is blocked and warning remains until reconciliation event.
14. **Verification boundary:** tests pass but independent verification fails; UI cannot display accepted outcome/ready publication.
15. **CSP/security:** shell keeps restrictive CSP/referrer/content-type protections and realtime remains same-origin by default.
16. **Accessibility:** reconnect/conflict/error messages use accessible live-region/status semantics; controls remain keyboard reachable and correctly labelled.

## Required verification

Run and record:

```bash
node --test apps/woyengi/test/shell.test.ts apps/woyengi/test/live-shell.test.ts
node apps/woyengi/test/visual-qa.mjs
pnpm typecheck
pnpm boundaries
pnpm test:all
pnpm prod:check:fast
```

`visual-qa.mjs` may need no edit; this ticket does not own it. If the unchanged visual harness cannot exercise the live entrypoint, record that limitation and use the automated `live-shell.test.ts` plus human QA rather than editing an unowned file.

Global production gate state must be reported as observed. Do not modify unrelated `passes` or human-acceptance flags.

## Human QA

Use two human browser sessions plus one separately granted AgentPrincipal.

- open the same authorized Work in both sessions;
- confirm presence appears and disappears without entering durable history;
- disconnect/reconnect one browser and confirm timeline continuity/no duplicate cards;
- switch one session to a second workspace during incoming activity and inspect for leakage;
- perform authorized handoff to agent, human takeover, suspend, resume/hand-back;
- force one stale-version conflict and confirm recovery copy/state;
- force an uncertain execution effect and confirm blind retry is unavailable;
- revoke one session and confirm stream/commands fail closed;
- keyboard-navigate and verify status/error announcements.

## Evidence capture

Implementation handoff/PR must contain:

- RED test evidence and GREEN result;
- live bootstrap sample with fixture-safe IDs and causal cursor;
- reconnect/resync event transcript with no sensitive payload;
- workspace-switch/revocation leakage assertions;
- takeover/handoff conflict traces;
- uncertain-effect UI evidence;
- accessibility/visual QA result;
- targeted/full command outputs;
- list of exact public lane-A/lane-B interfaces consumed.

## Authority / external-effect constraints

- UI visibility of a control does not create authority; backend remains authoritative.
- No browser-supplied principal/workspace identity is trusted without resolved session scope.
- Handoff/takeover/suspend/resume must carry lane-A authority/idempotency/version semantics.
- Execution controls remain governed by lane B.
- GitHub PR creation is never issued directly from browser code.
- Reconnect/resync is read-only and cannot replay commands/effects.
- `uncertain` external effects block blind retries until lane B reconciliation makes a safe transition explicit.

## Rollback / replay

Rollback can disable the live entrypoint and retain the existing explicit demo path without touching durable Work/event history.

A fresh browser or resync rebuilds from bootstrap + ordered authorized durable events. Local browser state/cache is disposable. Replaying events cannot invoke command ports.

## Completion gate

Complete only when the normal live entrypoint uses backend public ports, all falsifiers pass, two-session human QA is recorded, and implementation touched only the future-owned files above.