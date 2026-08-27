# DSA-005 — Live API session/Workspace auth enforcement tracer

Parent: #14  
Spec: `docs/specs/p1-durable-state-auth.md`  
Type: coding tracer bullet / integration seam  
Status: BLOCKED until P0 is accepted and DSA-002/003/004 are complete.

## Outcome contract

Replace the current static-bearer + unconditional allow-all governed-route path with a session-backed, independently workspace-scoped, default-deny access gate. Through the HTTP API, a caller with a valid session and an explicitly allowing policy can read its Workspace, create/reopen Work, and install/read an ApplicationInstance. The same session must receive no governed data and commit no mutation when expired, revoked, policy-denied, or pointed at another Workspace.

Existing canonical ingest/state/reconstruct/control/subscribe endpoints must also pass through the same access gate; no endpoint may retain `localAuthorize = allowed` as a bypass.

This ticket is the sole future owner of the platform API files listed below. Later execution/realtime lanes consume the stabilized access/handler interfaces rather than editing them in parallel.

## Prerequisites / blockers

- P0 verification + human acceptance gate is closed.
- DSA-001 PostgreSQL journal/Workspace service complete.
- DSA-002 SessionPort + AccessContextResolverPort complete.
- DSA-003 durable Work port complete.
- DSA-004 durable ApplicationInstance port complete.
- An `AuthorizationPolicyPort` implementation/fixture can be injected. This ticket must not replace the capability model with "authenticated = allowed".

## Exclusive future file ownership

This ticket may create/edit only:

- `services/platform-api/src/index.ts`
- `services/platform-api/src/main.ts`
- `services/platform-api/src/security.ts`
- `services/platform-api/src/access.ts`
- `services/platform-api/test/platform-api.test.ts`
- `services/platform-api/test/security.test.ts`
- `services/platform-api/test/durable-access.test.ts`

Do not edit DSA package implementations, runtime/execution/realtime packages, permissions, migrations, root dependencies, shared ADRs, `prd.json`, or `progress.txt`.

Execution/realtime agents must not edit these files while this ticket is active. If they require a changed handler contract later, they request a minimal interface ticket after DSA-005 lands.

## Current seam to replace

Today:

- `security.ts` maps one configured bearer directly to one static Principal.
- `PlatformApiPorts.authenticate` returns only `{ id }`.
- `PlatformApiPorts.authorize` is synchronous and receives no WorkspaceContext.
- `main.ts` supplies `localAuthorize = () => ({ allowed: true, ... })`.

After DSA-005, credential authentication and authorization are one governed composition through DSA-002. A static environment bearer, if retained, is not accepted as a governed-route session.

## Public HTTP scoping contract

### Governed routes

Every governed route has an independent Workspace scope:

- new product routes use `/v1/workspaces/:workspaceId/...`;
- legacy generic routes that cannot be path-scoped require `X-Woyengi-Workspace-Id` (exact spelling may be normalized once in `access.ts` and documented in tests);
- any body `workspaceId` must exactly equal the independent path/header Workspace ID;
- resource lookups occur only after AccessContextResolver allows the request.

Cross-workspace denial must not reveal whether the requested Work/App/entity exists.

### Minimum product tracer routes

Implement the smallest HTTP surface that proves the durable vertical:

- `GET /v1/workspaces/:workspaceId`
- `POST /v1/workspaces/:workspaceId/work`
- `GET /v1/workspaces/:workspaceId/work/:workInstanceId`
- `POST /v1/workspaces/:workspaceId/work/:workInstanceId/episodes`
- `POST /v1/workspaces/:workspaceId/applications/install`
- `GET /v1/workspaces/:workspaceId/applications/:applicationInstanceId`

Update/rollback ApplicationInstance may remain package-port-only if the live tracer already proves install/read durability; if exposed in this ticket, use the same access gate and do not widen file ownership.

### Sessions / bootstrap

Session self-revocation must be reachable without manufacturing a WorkspaceContext for a non-workspace security operation:

- authenticate the active session;
- require target session ID to equal the authenticating session for the P1 self-revoke tracer;
- append revocation through DSA-002;
- future admin revocation is an authority feature, not inferred here.

For fresh self-host bootstrap, adapt the existing static environment credential behind DSA-002 `CredentialVerifierPort`. It may be used only for an explicit bootstrap/session-exchange boundary; it must not be accepted by normal governed routes.

If a fresh-install bootstrap endpoint is implemented, it must be one-time and atomic through the DSA-001 Workspace service: register the configured first human Principal + Account/Personal Workspace only when the durable directory has no existing human account, then issue a session. Once durable human state exists, bootstrap provisioning fails closed. Do not build passwords/SSO.

If the repository baseline lacks enough accepted authority policy to safely allow that first human to mutate product state, the bootstrap may provision identity/session only and the governed product routes remain default-deny until an explicit `AuthorizationPolicyPort` is supplied. Do not solve this by reintroducing allow-all.

## Handler port contract

Refactor `PlatformApiPorts` so handlers receive a non-secret `AuthorizedWorkspaceContext` or equivalent authorization reference produced by `AccessContextResolverPort`, not a caller-asserted Principal.

For existing handlers:

- `ingest` receives authorized context and must verify body workspace matches it;
- `state` / `reconstruct` resolve context before entity lookup;
- `control` receives authorized context that the execution lane can re-check at a consequential-effect boundary;
- `subscribe` receives authorized context that realtime can validate on resume/subscription boundaries.

The API may keep domain handler interfaces transport-neutral. Execution/realtime implementations plug into those ports in their own files; DSA-005 must not import their private modules or encode websocket/execution semantics.

Authentication/authorization I/O is asynchronous because it consults durable session/workspace state. Update API control flow accordingly.

## HTTP failure semantics

- malformed/missing bearer -> 401;
- expired/revoked/unknown session -> 401;
- valid session but wrong Workspace or policy deny -> 403;
- Workspace/body scope mismatch -> 403 or 400 according to one documented rule, before domain mutation;
- stale domain/durable compare-and-append -> 409;
- invalid public payload -> 400;
- unavailable policy provider -> fail closed (403/503 by documented distinction), never allow;
- internal storage/provider failure -> 5xx without leaking secrets or cross-workspace data.

## Non-goals

- No OAuth/OIDC/password UI.
- No durable capability administration.
- No websocket/SSE transport implementation.
- No execution engine changes or external provider actions.
- No UI/shell work.
- No API compatibility promise for the previous static-token governed-route behavior; that behavior is a security gap to remove.

## Falsifiers / tests

Write failing API behavior tests first.

### F1 static environment bearer is not a governed-session bypass

Configure the legacy/bootstrap secret and call a governed Workspace/state/Work/App route directly with it.

Required: 401/deny. Use it only through the explicit bootstrap/exchange path, obtain a session, then test the session separately.

### F2 live restart tracer

With a narrowly allowing policy fixture:

1. obtain/provision durable Principal + session;
2. create/read Work and install/read App through HTTP;
3. restart API/service objects while keeping PostgreSQL;
4. use the same active session to read the same Work/App.

Required: same durable state after restart; API has no hidden in-memory source of truth.

### F3 cross-workspace path/body/resource attacks

Use Principal/session authorized for Workspace A. Attack with:

- B in path;
- A path + B body workspace;
- B Work ID under A path;
- B App ID under A path;
- legacy generic endpoint with B workspace header;
- aliased/shared semantic ID from B.

Required: denial before resource payload lookup/handler mutation; no B-specific existence/detail leak.

### F4 revoked/expired session

Call a governed route successfully, revoke session, call again immediately, restart, call again. Separately cross expiry boundary.

Required: all post-revoke/expired calls are 401 and no handler was invoked.

### F5 authentication is not authorization

Use valid session + valid Workspace membership with a policy provider that denies the exact operation/resource.

Required: 403 and handler call count zero. Repeat with absent/unavailable policy provider; never allow.

### F6 legacy governed endpoints carry WorkspaceContext

Exercise at least ingest, state, reconstruct, control and subscribe with missing workspace scope, wrong workspace scope, and allowed scope.

Required: missing/wrong scope fails before handler; allowed calls deliver the expected non-secret `AuthorizedWorkspaceContext` to their injected handler.

### F7 ingest body mismatch

Authorized Workspace A header/path, body claims Workspace B.

Required: reject before durable ingest append. This preserves ADR 0006 public workspace envelope semantics.

### F8 secret/error leakage

Force auth, provider and validation failures. Assert raw bootstrap/session bearers are absent from JSON responses, errors and captured logs.

### F9 stale conflict mapping

Force DSA-003/004 compare-and-append conflict through two requests.

Required: loser receives stable 409/typed response and no duplicate mutation.

## Cross-lane integration contract

### Execution

DSA-005 owns the API `control` auth edge. The execution lane implements the downstream control/effect port elsewhere and receives only `AuthorizedWorkspaceContext` + requested action payload. It must re-authorize before a consequential external effect if the request is long-lived. It does not edit API auth files.

### Realtime

DSA-005 owns HTTP/subscription authorization at the API edge. The realtime lane implements connection/presence/transport elsewhere and consumes the authorized context plus `AccessContextResolverPort.validateSession`/`authorize` for resume and durable-mutation checks. It does not own session issuance or API auth files.

## Verification ladder

1. targeted security/access unit tests;
2. `node --test services/platform-api/test/platform-api.test.ts services/platform-api/test/security.test.ts services/platform-api/test/durable-access.test.ts` with real PostgreSQL DSA providers for durable cases;
3. DSA-002 session/access tests;
4. DSA-003/004 durable domain tests;
5. existing platform API tests for ingest/state/reconstruct/control/subscribe behavior;
6. `pnpm typecheck`;
7. `pnpm boundaries`;
8. `pnpm test:all`;
9. applicable architecture/security/production gates.

A test composition using an explicit narrow allow-policy fixture is valid verification of API enforcement. It must not be confused with a production capability-administration implementation.

## Evidence to preserve

- route/status matrix for 401/403/409/allowed cases;
- handler call-count proof on denied requests;
- restart trace with non-sensitive session/work/app IDs;
- cross-workspace attack results;
- proof legacy static bearer no longer governs routes directly;
- exact test/security commands.

Redact all bearer/bootstrap secrets.

## Authority / external effects

HTTP product state mutations are governed durable effects. API authentication does not create capability authority. `control` may represent consequential external actions; DSA-005 only gates/forwards the request and does not execute the effect.

## Rollback / replay

- Reverting application code must not resurrect revoked sessions or remove durable journal history.
- Previous static allow-all behavior is not a supported rollback target.
- If old binary cannot safely operate with the new auth/session state, deployment rollback must keep governed routes disabled rather than restore insecure access.

## Completion gate

Done only when the static-token bypass is removed, all governed endpoints have independent Workspace scope + session/policy enforcement, the live restart tracer passes, cross-workspace/revocation/default-deny/legacy-endpoint/conflict/leakage falsifiers pass, and execution/realtime can consume the stabilized ports without parallel edits to these API files.
