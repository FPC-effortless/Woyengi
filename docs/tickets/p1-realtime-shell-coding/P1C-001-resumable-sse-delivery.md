# P1C-001 — Durable authorized SSE delivery and reconnect cursor seam

Status: BLOCKED — planning only until P0 and lane-A prerequisites are accepted
Parent planning issue: #16
Spec: `docs/specs/p1-realtime-shell-coding.md`
Work mode: Product engineering

## Outcome Contract

Deliver one provider-neutral realtime transport tracer in `packages/realtime` that can turn an authorized durable read-after-cursor source into a standards-compliant SSE stream while preserving Woyengi's causal ordering, workspace isolation, revocation, duplicate safety, and ephemeral-presence boundary.

Success means a test client can:

1. bootstrap at durable cursor `C`;
2. receive authorized durable events after `C` over SSE;
3. disconnect after an event;
4. reconnect from the last event ID;
5. receive every later authorized event in causal order, with boundary duplicates harmless;
6. be terminated on session/authority revocation;
7. never cause replayed commands or external effects.

## Prerequisites / blockers

Hard blockers:

- P0 issues #7-#11 landed and required P0 human acceptance completed.
- P1 lane A (#14) has an accepted public session/auth/durable-state contract equivalent to the spec's `SessionPort`, `AuthorizationPort`, and non-destructive `DurableEventReadPort` semantics.
- If lane A cannot expose a read-after-causal-cursor seam, resolve that interface gap before implementation. Do not import lane-A internal files.

Existing seams to reuse:

- `packages/realtime` collaboration visibility/authority/presence semantics;
- `packages/event-bus` event identity and causal `ledgerSequence` meaning;
- current package-boundary policy and Node 24 HTTP/writable-stream behavior.

## Future exclusive file ownership

The future coding agent for this ticket may edit ONLY these files within this lane's implementation scope:

- `packages/realtime/src/index.ts`
- `packages/realtime/src/sse-delivery.ts` (new)
- `packages/realtime/test/collaboration-hub.test.ts`
- `packages/realtime/test/sse-delivery.test.ts` (new)

No later P1-C ticket may edit these files. If another lane has already claimed one of them before implementation starts, stop and re-ticket rather than sharing ownership.

## State inputs

Public-port inputs only:

- authenticated session identity (`sessionId`, `principalId`, active/authorized workspace, expiry);
- requested workspace/resource/topic scope;
- bootstrap/reconnect cursor supplied by the client;
- durable events read non-destructively after that cursor;
- current authorization/session status;
- ephemeral presence updates supplied through a bounded in-memory presence path;
- optional telemetry sink that receives metadata, never protected payload bodies.

## State outputs

- `RealtimeEnvelope` values with stable event ID, durable cursor, workspace, aggregate, bounded public topic/class, transaction time, payload, optional projection version, optional trace ID;
- SSE frames with `id`, `event`, and normalized JSON `data`;
- heartbeat comments that do not advance the durable cursor;
- explicit terminal/resync conditions for revoked session, forbidden scope, invalid/expired cursor, non-monotonic source ordering, and bounded-buffer overflow;
- ephemeral presence snapshots/fanout that are not durable events.

No canonical Work/state mutation is produced by reading or replaying the stream.

## Public seam

Implement an API semantically equivalent to:

```ts
export interface RealtimeSessionContext {
  readonly sessionId: string;
  readonly principalId: string;
  readonly workspaceId: string;
}

export interface RealtimeEventSource {
  readAfter(input: {
    readonly session: RealtimeSessionContext;
    readonly scope: readonly string[];
    readonly after?: string;
    readonly limit: number;
  }): Promise<{
    readonly events: readonly RealtimeEnvelope[];
    readonly watermark: string;
  }>;
}

export interface RealtimeAccessPort {
  assertActive(input: RealtimeSessionContext): Promise<void>;
  authorizeDelivery(input: {
    readonly session: RealtimeSessionContext;
    readonly aggregateId: string;
    readonly topic: string;
  }): Promise<boolean>;
}

export interface RealtimeTelemetryPort {
  record(input: {
    readonly kind: string;
    readonly cursor?: string;
    readonly traceId?: string;
    readonly detail?: Readonly<Record<string, string | number | boolean>>;
  }): void;
}
```

`serveSse`/equivalent must accept an already-authenticated session context and injected ports. It must not parse GitHub credentials, know persistence adapters, or implement Work/effect semantics.

### Cursor rules

- cursor is opaque to the browser but monotonic within one workspace causal history;
- `id:` carries the cursor of a durable event;
- reconnect resumes strictly after the last applied cursor;
- a cursor is never treated as authorization;
- no server consumer cursor is advanced merely because `response.write()` succeeded;
- lower/non-monotonic source cursors fail to resync instead of being silently applied;
- expired/compacted cursor returns an explicit resync-required result.

### Backpressure rules

- honor writable-stream backpressure (`write() === false`/`drain` or equivalent);
- bound queued events/bytes;
- on overflow or unrecoverable slow consumer, terminate with an observable resync-required condition rather than buffer indefinitely;
- heartbeat frames are suppressed/paused as needed while backpressured.

### Presence rules

- preserve `CollaborationHub`'s durable-vs-ephemeral distinction;
- presence has TTL/expiry and is memory-bounded;
- presence is re-authorized and scoped to workspace/Work visibility;
- presence is absent after process restart/reconnect until clients republish it;
- presence cannot expose internal capability/credential data through public/narrow sessions.

## Explicit non-goals

- No browser UI changes.
- No platform-api route registration.
- No persistence/auth implementation.
- No WebSocket implementation.
- No GitHub/sandbox/execution implementation.
- No change to Work assignment semantics.
- No CRDT/editor/terminal protocol.
- No change to canonical event ordering or ledger semantics.
- No durable storage of presence.

## Falsifiers / tests first

Add the failing tests before production changes.

1. **Reconnect loss:** emit events 1..5, disconnect after 2, reconnect with cursor 2; assert 3..5 arrive in order.
2. **Boundary duplicate:** make the reconnect source include event 2 again; reducer/delivery identity makes duplicate detectable and no second logical application is required.
3. **Non-monotonic source:** source returns cursor 4 after cursor 5; stream fails/resyncs instead of emitting stale event.
4. **Snapshot-open race seam:** read after supplied bootstrap cursor includes an event committed between bootstrap and stream open.
5. **Cross-workspace cursor:** valid cursor from workspace A presented in workspace B cannot disclose A events.
6. **Revocation while open:** session becomes revoked before next event; no later protected payload is written.
7. **Per-delivery denial:** authorization changes for one resource; denied event is not leaked and stream behavior is explicit/fail-closed.
8. **Slow consumer:** force writable backpressure; queue remains within configured bound and terminates/resyncs rather than grow unbounded.
9. **Heartbeat semantics:** heartbeats do not alter last durable event ID/cursor.
10. **Presence restart:** durable events resume; presence is empty after hub restart until republished.
11. **Presence expiry:** unclean disconnect/abandoned presence expires by TTL and memory returns to bound.
12. **Public leakage:** payload/visibility adversarial fixture containing capability/credential markers never reaches public/narrow presence or durable collaboration output.
13. **Replay purity:** reconnect/read-after calls never invoke any command/effect callback.

## Required verification

Run and record:

```bash
node --test packages/realtime/test/collaboration-hub.test.ts packages/realtime/test/sse-delivery.test.ts
pnpm typecheck
pnpm boundaries
pnpm test:all
```

Then run:

```bash
pnpm prod:check:fast
```

Record its actual result. Do not change release/human-acceptance flags to make this ticket appear green.

## Evidence capture

The handoff/PR for implementation must include:

- RED test commit and the exact failing assertions;
- GREEN commit(s);
- reconnect transcript showing last emitted cursor and first resumed cursor;
- revocation test proving zero post-revocation payload writes;
- backpressure test with configured bound and observed maximum queue;
- presence restart/expiry evidence;
- targeted/full verification command outputs;
- package-boundary result;
- any unresolved proxy/runtime constraints.

No sensitive payload/body is required as evidence; identifiers may be fixture-safe values.

## Authority / external-effect constraints

- Authentication does not imply subscription authority.
- Authorization is scoped to principal + workspace + resource/topic + purpose.
- Cursor possession confers no authority.
- Revocation fails closed.
- Stream reads and replays are computational/read effects only.
- Reconnect MUST NOT call Work commands, execution commands, GitHub operations, or semantic commit paths.

## Rollback / replay

Rollback removes/disables the SSE adapter and returns callers to non-live/polling behavior without modifying canonical event history.

Replay starts from an explicit durable cursor and may duplicate a boundary delivery. It must not acknowledge browser receipt through a server-side worker cursor and must never trigger consequential effects.

## Completion gate

This ticket is complete only when the falsifiers pass, the public adapter remains provider-neutral, and the handoff explicitly confirms that implementation touched only the future-owned files above.