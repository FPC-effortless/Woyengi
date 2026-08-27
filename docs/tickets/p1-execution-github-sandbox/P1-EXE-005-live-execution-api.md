# P1-EXE-005 — Live Execution API + Read/Event/Session Ports

Status: **BLOCKED ON P0 ACCEPTANCE, P1-EXE-001, P1-EXE-004 AND #14 PUBLIC PORTS**  
Issue lane: #15  
Depends on: P1-EXE-001, P1-EXE-004, lane #14 durable principal/session + persistence adapters  
Unblocks: P1-EXE-006 and lane #16 backend integration

## Outcome contract

Expose the governed execution subsystem through an authenticated, workspace-scoped, idempotent live HTTP API and stable provider-neutral read/event/sandbox-session ports. The API must let a caller create, inspect, page the journal, cancel and request recovery of an execution without exposing credentials or bypassing authority.

Success means an authenticated caller can drive a sandbox-backed execution through the API, restart the service, recover the same execution from durable state, and observe ordered projections; duplicate/conflicting commands and cross-workspace access fail closed.

## Future exclusive file ownership

The implementation agent owns **only**:

- `services/platform-api/**`.

All `packages/**`, `services/runtime/**`, `services/compute-node/**`, #14/#16 files, shared ADRs, `prd.json`, and `progress.txt` are read-only.

If public coordinator or #14 contracts are insufficient, report the minimum contract change rather than importing internal implementation files or editing them in this ticket.

## Preconditions / blockers

1. P0 accepted.
2. P1-EXE-001 public coordinator/query/recovery contracts merged.
3. P1-EXE-004 runtime dispatch/cancel path merged.
4. Lane #14 provides public durable session/principal and persistence adapters with restart/revocation/workspace isolation semantics.
5. Existing `PlatformApiPorts.authenticate` / `authorize` behavior remains fail-closed.

## Required HTTP behavior

Route spelling should follow existing `/v1` conventions. Unless an existing accepted API convention requires a different path, implement:

- `POST /v1/executions` — create/authorize an execution from existing WorkEpisode + accepted operational/outcome contract references;
- `GET /v1/executions/:executionId` — current execution projection;
- `GET /v1/executions/:executionId/journal?afterSequence=&limit=` — ordered paginated journal projection;
- `POST /v1/executions/:executionId/cancel` — idempotent cancellation request;
- `POST /v1/executions/:executionId/recover` — explicit recovery/reconciliation request;
- optional sandbox-session read/control routes only if required to expose the `SandboxSessionControlPort` to lane #16; do not add WebSocket/SSE here.

Every mutating route requires `Idempotency-Key`. Every route requires authentication and workspace-scoped authorization.

## Typed ports

Extend `PlatformApiPorts` with public execution dependencies rather than reaching into coordinator internals. The API layer should depend on semantically narrow functions such as:

```ts
export interface PlatformExecutionPorts {
  createExecution(input: ApiCreateExecution): Promise<ExecutionProjection>;
  getExecution(input: ApiExecutionQuery): Promise<ExecutionProjection | undefined>;
  readExecutionJournal(input: ApiJournalQuery): Promise<ExecutionJournalPage>;
  cancelExecution(input: ApiCancelExecution): Promise<ExecutionProjection>;
  recoverExecution(input: ApiRecoverExecution): Promise<ExecutionProjection>;
  inspectSandboxSession?(input: ApiSandboxInspection): Promise<SandboxSessionProjection>;
  writeSandboxStdin?(input: ApiSandboxStdin): Promise<void>;
  cancelSandbox?(input: ApiSandboxCancel): Promise<SandboxSessionProjection>;
  readSandboxOutput?(input: ApiSandboxOutputQuery): Promise<SandboxOutputPage>;
}
```

The stable contract consumed by lane #16 is behaviorally equivalent to:

- `ExecutionReadPort.getExecution/readJournal`;
- execution events carrying `workspaceId`, `executionId`, stable sequence, type, payload and time;
- `SandboxSessionControlPort.inspect/writeStdin/cancel/readOutput`.

Lane #16 owns realtime transport/cursor fanout and UI takeover semantics. It must not import API internals.

## Request identity and idempotency

For each mutation:

- combine authenticated workspace/principal context with the supplied `Idempotency-Key`;
- compute a stable command fingerprint over normalized request body + target execution/work IDs;
- same key/same fingerprint returns prior command result/projection;
- same key/different fingerprint returns conflict (`409` class) and performs no new coordinator command;
- do not treat a network retry from the client as permission to replay an ambiguous GitHub effect; the coordinator owns that decision.

## Authentication / authorization rules

1. resolve active session/principal using lane #14 public port;
2. identify workspace from authenticated/request resource context, never from an unchecked body field alone;
3. authorize `EXECUTE` against a workspace-contained execution/work resource;
4. revalidation at external-effect time remains the coordinator's responsibility;
5. revoked/expired session returns unauthenticated/forbidden response and cannot create/cancel/recover work;
6. caller may only read execution/journal/sandbox resources in its workspace and granted scope;
7. API errors reveal no existence/metadata across workspace boundaries.

## Response semantics

Expose explicit machine-readable states including:

- `BLOCKED` / authority denial;
- runtime failure/budget/cancellation;
- `RECOVERY_REQUIRED`;
- `UNCERTAIN_EXTERNAL_EFFECT` distinct from ordinary provider rejection;
- reconciliation status;
- verification/acceptance status;
- stable trace/execution IDs.

Never expose:

- raw credentials/tokens;
- secret environment values;
- private provider response headers containing authentication material;
- internal persistence schema;
- acceptance not present in the canonical governed execution record.

## Journal and projection paging

- entries ordered by durable execution sequence;
- `afterSequence` is exclusive and monotonic;
- maximum page size bounded (follow current API limit conventions where practical);
- duplicate transport delivery does not duplicate durable entries;
- stale/unknown sequence cannot cause reordered output;
- projections may be cached but durable journal/read port is authoritative for lane #16 reconnect/catch-up.

## Event sink integration

The platform service may publish execution events to an injected `ExecutionEventSink` after durable append. Publication is at-least-once and may fail independently of durable execution.

Required rule: event publication failure must not roll back or repeat a GitHub/provider mutation. A later publisher may replay the already-durable projection event by sequence.

## Non-goals

- WebSocket/SSE implementation;
- live shell UI;
- realtime presence/multiplayer;
- GitHub provider implementation;
- durable storage implementation;
- generic API redesign;
- raw secret/credential endpoints;
- accepting provider success as truth.

## Falsifiers / tests first

Write failing API tests before implementation for:

1. unauthenticated execution create -> 401 and no coordinator call;
2. authenticated but unauthorized -> 403 and no coordinator call;
3. cross-workspace execution GET/journal/cancel/recover -> fail closed without metadata leakage;
4. create without `Idempotency-Key` -> 400;
5. same key/same body twice -> one coordinator create, stable execution identity;
6. same key/different body -> 409, one coordinator create;
7. duplicate cancel -> idempotent result and one effective cancellation transition;
8. recover an execution with `UNCERTAIN` GitHub effect -> reconcile-only path, no provider mutation replay;
9. API restart with durable adapter -> same execution/journal projection and sequence;
10. journal pagination returns strict ordered non-overlapping pages;
11. event sink throws after durable transition -> HTTP behavior may report publication issue according to policy, but durable state remains exactly once and no external effect repeats;
12. revoked session between requests -> subsequent read/cancel/recover denied;
13. response for uncertain external effect clearly differs from ordinary failed provider response;
14. token/secret fixture in lower-layer error -> API response/log projection redacts/omits it;
15. oversized/invalid JSON/current API security limits remain enforced;
16. sandbox session access requires same workspace/principal authority;
17. repeated client retry after transport disconnect cannot make GitHub mutation call count exceed one in integration fake.

## Evidence required from implementation

- route/authorization matrix;
- idempotency conflict transcripts;
- restart projection/journal before/after comparison;
- API response fixture for `UNCERTAIN_EXTERNAL_EFFECT`;
- proof event-publish failure does not replay execution effect;
- secret-redaction/absence fixture;
- explicit contract note for lane #16 showing only public read/event/session seams.

## Verification ladder

1. `node --test services/platform-api/test/*.test.ts`
2. targeted integration test with fake/durable #14 adapters and P1 execution coordinator
3. `pnpm typecheck`
4. `pnpm boundaries`
5. `pnpm test:all`
6. `pnpm benchmark` for idempotency/restart/workspace-adversarial API cases where registered
7. `pnpm prod:check` because this ticket changes the live platform API surface

## Authority / external effects

The API does not grant effect authority. It authenticates/authorizes commands and forwards them to the coordinator, which rechecks current authority before consequential dispatch. API/client retry semantics must never override the coordinator's external-effect idempotency/reconciliation state.

## Rollback / compatibility

New routes are additive. Rolling back API code must not delete execution records or imply cancellation of provider effects. Preserve stable response identifiers/sequence contracts once lane #16 depends on them; incompatible changes require an explicit version/migration plan.