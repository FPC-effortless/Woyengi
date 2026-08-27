# P1-EXE-000 — Cross-lane execution adapter contract amendment

Issue: #15  
Status: planning-only amendment; normative for tickets P1-EXE-001 through P1-EXE-006.

## Corrected dependency boundary

The durable-state/auth lane (#14) does **not** own execution-domain ports. It owns generic public infrastructure contracts:

- `DurableJournalPort`
- `DurableIdempotencyClaimPort`
- `SessionRevalidationPort`
- `WorkspaceAuthorizationPort`

The execution lane (#15) may expose:

```ts
export interface ExecutionDurabilityPort {
  load(executionId: string): Promise<ExecutionRecord | undefined>;
  compareAndAppend(input: ExecutionAppendRequest): Promise<ExecutionRecord>;
  claimEffect(input: EffectClaimRequest): Promise<EffectClaimResult>;
}

export interface ExecutionPrincipalPort {
  reauthorizeEffect(input: {
    sessionId: string;
    workspaceId: string;
    operation: string;
    resourceId: string;
    purpose: string;
    at: string;
  }): Promise<AuthorizedExecutionPrincipal | undefined>;
}
```

but these interfaces and their adapters are #15-owned. Their implementations delegate to #14's generic ports through public indexes. #14 must not import execution/GitHub/sandbox types.

## Effect-time authority is mandatory

Request-time authorization is insufficient for queued, resumed, retried, or reconciled execution. The durable execution record persists an opaque `sessionId`, never a bearer credential. Immediately before every consequential external effect:

1. revalidate the persisted `sessionId` at the current time;
2. resolve the current workspace authorization for the concrete operation/resource;
3. fail closed on expiry, revocation, membership removal, narrowed authority, missing policy provider, or workspace mismatch;
4. only after current authorization, attempt/claim the external effect;
5. journal the attempt/outcome/uncertainty through the execution-owned adapter.

A worker may use `principalId` from the record for audit correlation, but never as proof of current authority.

## Idempotency and uncertain-write rule

`ExecutionDurabilityPort.claimEffect` adapts the generic durable idempotency claim using an execution-specific fingerprint. The fingerprint must bind at minimum:

```text
workspaceId
executionId
effect kind/provider
operation
resource target
normalized parameters
```

The same key + different fingerprint is a conflict. An uncertain external write remains uncertain and must reconcile before any retry can issue the effect again.

## Falsifiers that update the existing tickets

All implementation tickets inherit these RED cases:

- authorized HTTP request, session revoked before worker reaches GitHub write → no GitHub write;
- queued execution survives restart, bearer secret is absent from all durable records/logs → PASS; any secret present → FAIL;
- execution record from workspace A replayed against workspace B → reauthorization denies before provider call;
- provider write returns transport uncertainty, retry with same key issues a second write before reconciliation → FAIL;
- #15 imports a private #14 module or writes directly to #14 storage tables rather than using public ports → FAIL.

## Dependency order impact

P1-EXE-001 remains the first executable ticket after P0 acceptance, but its prerequisite is now the generic #14 port contract rather than #14-owned `ExecutionDurabilityPort`/`ExecutionPrincipalPort`. Tickets 002–006 depend on the execution adapters produced by P1-EXE-001.

## Future ownership

Execution-specific adapters, records, GitHub/sandbox effects, reconciliation, and live execution API stay exclusively in #15's future file ranges. Generic durability/session/workspace authority stays in #14. No shared implementation file is required.