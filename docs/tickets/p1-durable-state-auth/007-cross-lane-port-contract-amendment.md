# P1A-007 — Cross-lane generic durability and session revalidation ports

Issue: #14  
Status: planning-only amendment  
Depends on: tickets 001–006 conceptually; no source implementation begins from this file alone.

## Why this amendment exists

The execution lane (#15) originally named `ExecutionDurabilityPort` and `ExecutionPrincipalPort` as if they were owned by the durable-state/auth lane. That would leak execution-domain semantics into #14 and create shared-file ownership pressure.

The corrected boundary is:

### #14 owns generic infrastructure ports

```ts
export interface DurableJournalPort<Payload> {
  readPartition(input: { journal: string; partition: string; afterSequence?: number }): Promise<readonly DurableEnvelope<Payload>[]>;
  compareAndAppend(input: {
    journal: string;
    partition: string;
    expectedSequence: number;
    operationId: string;
    transactionTime: string;
    payload: Payload;
  }): Promise<DurableEnvelope<Payload>>;
}

export interface DurableIdempotencyClaimPort {
  claim(input: {
    namespace: string;
    key: string;
    fingerprint: string;
    transactionTime: string;
  }): Promise<{ status: "CLAIMED" | "REPLAY" | "CONFLICT"; outcomeRef?: string }>;
  complete(input: { namespace: string; key: string; outcomeRef: string }): Promise<void>;
}

export interface SessionRevalidationPort {
  revalidate(input: {
    sessionId: string;
    at: string;
  }): Promise<AuthenticatedSession | undefined>;
}

export interface WorkspaceAuthorizationPort {
  authorize(input: {
    sessionId: string;
    workspaceId: string;
    operation: string;
    resourceId: string;
    purpose: string;
    at: string;
    context?: Readonly<Record<string, string>>;
  }): Promise<AuthorizedWorkspaceContext>;
}
```

The exact type names may move during implementation, but these semantic responsibilities may not collapse into an execution-specific abstraction inside #14.

### #15 owns execution-domain adapters

The execution lane may define `ExecutionDurabilityPort` and `ExecutionPrincipalPort`, but those are #15-owned adapters over the generic #14 ports. They are not added to #14 packages merely because execution consumes durability/auth.

## Effect-time authority rule

A queued or resumed execution may outlive the HTTP request that created it. Therefore #14 must support server-internal revalidation by persisted `sessionId`.

The execution record may persist:

```text
sessionId
principalId (for audit/reference only)
workspaceId
requested operation/resource
original authorization decision reference
```

It must **not** persist a reusable bearer credential for later execution.

Immediately before any consequential external effect, #15 must call:

```text
SessionRevalidationPort.revalidate(sessionId, now)
        ↓
WorkspaceAuthorizationPort.authorize(sessionId, workspaceId, operation, resource, now)
        ↓
only then execute the effect
```

Revocation, expiry, membership removal, or authority narrowing between request-time and effect-time therefore stops the effect.

## Falsifiers

1. **Bearer-retention falsifier:** serialized execution durability records contain a raw bearer secret → FAIL.
2. **Revoked-after-queue falsifier:** request is authorized, session is revoked before worker execution, worker still performs external effect → FAIL.
3. **Cross-workspace revalidation falsifier:** persisted sessionId from workspace A is reused for an effect in workspace B without a new workspace decision → FAIL.
4. **Ownership falsifier:** #14 implementation imports execution-domain types or defines GitHub/sandbox-specific durability semantics → FAIL.
5. **Idempotency ambiguity falsifier:** same idempotency key with a different fingerprint can claim a second effect → FAIL.

## Future implementation ownership

#14 future coding agents own only generic durable journal/idempotency/session/workspace authorization implementations in the file ranges assigned by tickets 001–006. #15 future coding agents own execution adapters and must depend only on #14 public indexes/ports.

## Verification

Planning acceptance requires #14 and #15 ticket sets to reference this boundary consistently before P1 implementation begins.