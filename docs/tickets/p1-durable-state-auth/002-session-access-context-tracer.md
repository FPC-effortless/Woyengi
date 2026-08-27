# DSA-002 — Durable Principal sessions + access-context tracer

Parent: #14  
Spec: `docs/specs/p1-durable-state-auth.md`  
Type: coding tracer bullet  
Status: BLOCKED until P0 is accepted and DSA-001 is complete.

## Outcome contract

A durable human Principal can receive a high-entropy bearer session, use it to resolve an authorized WorkspaceContext, durably revoke it, and prove that the same bearer is denied immediately and after a fresh-process restart. A valid session alone must never grant cross-workspace or capability authority.

This ticket creates the stable access boundary later API, execution, and realtime code consume.

## Prerequisites / blockers

- P0 verification + human acceptance gate is closed.
- DSA-001 `DurableJournalPort` and `WorkspaceStatePort` are stable and verified against PostgreSQL.
- Existing `packages/permissions` semantics remain the authority source; this ticket must not redefine them.

## Exclusive future file ownership

This ticket may create/edit only:

- `packages/access-context/src/index.ts`
- `packages/access-context/test/access-context.test.ts`
- `packages/session-persistence/src/index.ts`
- `packages/session-persistence/test/session-persistence.test.ts`

Do not edit `packages/permissions/**`, `packages/workspace/**`, `packages/persistence/**`, API files, Work/App files, migrations, root dependency files, shared ADRs, `prd.json`, or `progress.txt`.

## State inputs and outputs

### Inputs

- Durable Principal and Workspace directory access through DSA-001 `WorkspaceStatePort`.
- DSA-001 `DurableJournalPort`.
- Existing capability `AuthorizationRequest` / `AuthorizationDecision` semantics through an injected `AuthorizationPolicyPort`.
- A cryptographically secure random-byte source and one-way digest function.
- Explicit instants supplied/normalized by the service contract for deterministic tests.

### Durable session state

Use one session journal partition per immutable session ID. Minimum operations:

- `session.issued` — session ID, Principal ID, issuer Principal/reference, token digest or digest-derived ID, issuedAt, expiresAt, issuance idempotency identity.
- `session.revoked` — session ID, revoking Principal/reference, revokedAt, reason.

Rotation is revoke old + issue new. Do not mutate an issued operation into a revoked row.

The session ID may be deterministically derived from a cryptographic digest of the random bearer secret so authentication can address the session partition without a second mutable lookup table. If implemented this way, the token must have at least 256 bits of random entropy and the public session ID must reveal no plaintext secret. If the implementer instead needs a lookup projection, it must remain rebuildable and atomic with session issuance; do not add a migration without reopening DSA-001 ownership.

### Outputs

- `IssuedSessionCredential` containing session metadata and raw bearer secret returned only from the successful issuance call.
- `AuthenticatedSession` containing no bearer secret.
- `AuthorizedWorkspaceContext` containing session/principal/workspace + evaluated policy decision reference, never raw credential material.

## Public seams

Export from `packages/session-persistence/src/index.ts` a `SessionPort` with equivalent responsibilities:

```ts
interface SessionPort {
  issue(input: {
    principalId: string;
    issuedBy: string;
    issuedAt: string;
    expiresAt: string;
    operationId: string;
  }): Promise<IssuedSessionCredential>;
  authenticate(input: { bearer: string; at: string }): Promise<AuthenticatedSession | undefined>;
  revoke(input: {
    sessionId: string;
    revokedBy: string;
    revokedAt: string;
    reason: string;
    operationId: string;
  }): Promise<void>;
}
```

Required behavior:

- issuance proves the target Principal exists before publication;
- raw bearer is generated before commit but returned only after the committed `session.issued` operation is visible;
- raw bearer is never serialized into the durable payload;
- expiration and revocation are checked on every authenticate call;
- revocation is append-only and survives restart;
- a second revoke with the same operation ID/payload is idempotent; contradictory reuse conflicts;
- no method can "unrevoke" a session.

Export from `packages/access-context/src/index.ts`:

```ts
interface AuthorizationPolicyPort {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}

interface AccessContextResolverPort {
  authorize(input: AccessRequest): Promise<AuthorizedWorkspaceContext>;
  validateSession(input: { sessionId: string; at: string }): Promise<boolean>;
}
```

`AccessRequest` must include the bearer credential, independent `workspaceId`, operation, resource/graph/entity identity, purpose, sensitivity, context and evaluation instant needed by the current capability model.

Resolution order is fixed:

1. authenticate active session;
2. resolve durable WorkspaceContext for the session Principal;
3. require the requested Workspace ID to equal the resolved context;
4. call injected `AuthorizationPolicyPort` using that Principal + WorkspaceContext;
5. return immutable authorized context only on allow.

If the policy port is absent or throws an unavailable/unknown result, deny rather than treating authentication as authorization.

## Local bootstrap seam

Define a narrow `CredentialVerifierPort` type in `packages/access-context` for future API composition. It verifies an external/local bootstrap credential into an already-configured bootstrap identity; it does not itself grant workspace authority.

DSA-002 does not implement HTTP bootstrap. DSA-005 will use this port so the existing environment bearer can become exchange/bootstrap-only rather than a universal governed-route credential.

## Non-goals

- No password hashing/user password database.
- No OAuth/OIDC/SAML/SSO/SCIM/MFA.
- No changes to capability narrowing, expiry, resource scope or delegation semantics.
- No durable capability grant/revoke administration.
- No API route changes.
- No realtime disconnect transport.
- No accepted semantic commit or external provider action.

## Falsifiers / tests

Write each falsifier as a failing public-behavior test before implementation.

### F1 issuance survives restart

1. Use DSA-001 to create a durable human Principal/Personal Workspace.
2. Issue a session and authenticate it.
3. Destroy SessionPort/WorkspaceStatePort objects and reconnect to PostgreSQL.
4. Authenticate the same bearer.

Required: same session ID/Principal; active until expiry/revocation; no process-memory dependency.

### F2 revocation survives restart

Authenticate -> revoke -> authenticate immediately -> restart -> authenticate again.

Required: both post-revocation attempts are denied. Replaying older issued state must not resurrect it.

### F3 expiration boundary

Test just before, exactly at, and after `expiresAt` according to one documented comparison rule. Required: no grace period is inferred from clock skew unless the contract explicitly provides one.

### F4 plaintext secret leakage

Inspect serialized durable session envelopes, thrown errors, normalized test evidence and any returned non-issuance object.

Required: raw bearer string appears only in the one issuance result held by the test caller. It does not occur in durable payload JSON, session ID metadata, errors, logs or authorization context.

### F5 valid session but wrong Workspace

Principal belongs to Workspace A but not B. Authenticate A session and request B access.

Required: access resolver denies before calling the policy provider with an invalid WorkspaceContext. No B state is returned.

### F6 authentication is not authority

Inject an `AuthorizationPolicyPort` that denies. Use a valid active session and valid Workspace membership.

Required: access is denied. Then omit/unavailable the policy provider; required result remains deny.

### F7 lost issuance response / idempotency

Simulate successful durable issue commit followed by lost caller response; retry the same operation ID.

Required: the service does not reconstruct/re-disclose the original raw bearer. It reports an already-committed/non-replayable credential condition or equivalent safe result; it does not silently create a second active token. Explicit rotation/new issuance is required.

### F8 stale process after revoke

Hold two independent SessionPort instances. Instance A authenticates/caches nothing authoritative; instance B revokes. Instance A authenticates the bearer again.

Required: denial is based on current durable state, not a process-lifetime active-session cache.

## Verification ladder

1. targeted `session-persistence` tests against real PostgreSQL provider;
2. targeted `access-context` tests;
3. DSA-001 persistence/workspace tests;
4. existing `packages/permissions` tests;
5. `pnpm typecheck`;
6. `pnpm boundaries`;
7. `pnpm test:all`;
8. security gate(s) relevant to secret/auth changes.

Record whether a test used a real PostgreSQL provider. Mock-only evidence cannot satisfy restart/revocation durability.

## Evidence to preserve

- session operation IDs and non-secret session IDs;
- issue/revoke sequence numbers;
- restart boundary evidence;
- negative cross-workspace and deny-policy results;
- a redaction/leakage assertion proving the raw bearer is absent from persistence/evidence;
- exact security/test commands.

Never copy raw session bearers into handoffs or issue comments.

## Authority / external effects

- Session issue/revoke changes security state and requires an explicit authorized actor/credential path.
- A session is identity proof, not domain authority.
- DSA-002 creates no external business effects and no semantic commits.

## Rollback / replay

- Replay folds `session.issued` then any later `session.revoked` operation by durable sequence.
- Code rollback must preserve recognition of already-issued/revoked session records.
- Revocation is monotonic; a rollback cannot make a revoked session active.

## Completion gate

Done only when issuance, restart, revocation, expiration, leakage, cross-workspace, default-deny, lost-response and stale-process falsifiers pass and `AccessContextResolverPort` is stable for DSA-005 and later execution/realtime lanes.
