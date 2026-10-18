# Loopback self-host Work HTTP adapter (WYG-019 incremental P1 slice)

This service makes the existing append-only `DurableWorkspaceJournal` and
`DurableWorkJournal` accessible over a **loopback-only** HTTP interface with
operator-provisioned bearer credentials for verified principals. It is not the
complete Woyengi self-host deployment, a login service, or a Postgres-backed
multi-host API.

## Deployment / composition

Trusted bootstrap code first registers principals and establishes legitimate
Workspace membership using the durable Workspace journal. It opens the Work
journal with a **live authority resolver**, never a one-time snapshot:

```ts
import { DurableWorkspaceJournal, DurableWorkJournal } from "../durable-work/index.ts";
import { BoundPrincipalSessions, SelfHostWorkApi } from "./index.ts";

const workspaces = await DurableWorkspaceJournal.open({
  ledgerPath: "./data/workspace.json",
});
const work = await DurableWorkJournal.open({
  ledgerPath: "./data/work.json",
  workspaces: () => workspaces.snapshot(),
});
const sessions = new BoundPrincipalSessions([
  { principalId: "principal:owner", token: process.env.WOYENGI_OWNER_TOKEN ?? "" },
  { principalId: "principal:reviewer", token: process.env.WOYENGI_REVIEWER_TOKEN ?? "" },
]);
const server = await new SelfHostWorkApi({ workspaces, work, sessions }).listen({
  hostname: "127.0.0.1",
  port: 8181,
});
try {
  // Keep the owning process alive while serving local clients.
} finally {
  await server.close();
  await work.close();
  await workspaces.close();
}
```

The tokens above are **examples of configuration inputs only** and must be
random secrets at least 32 characters long, provisioned through a trusted
channel. Never commit tokens, accept tokens via public registration, or log
them. No demo credential is enabled by default. The token provisioner must
verify the claimed principal *outside* this API; simply knowing a principal ID
is not authentication. Secrets are held in process memory, not stored in the
canonical Workspace ledger. Session expiration and local `revokePrincipal`
are available, but full durable session lifecycle, account recovery, refresh
and cross-restart revocation require a real session provider.

## HTTP contract

All requests require exactly one `Authorization: Bearer <token>` header.
The authenticated principal is the actor: clients **must not** supply
`createdByPrincipalId` or `actorPrincipalId` in mutation payloads.
Mutation calls require a distinct `Idempotency-Key` with 1–128 safe chars.
Retries return a conflict, **not** a stored replayed result. Body fields
outside the documented schema are rejected. Request JSON limit: 64 KiB.

| Method | Path | Payload / result |
| --- | --- | --- |
| GET | `/v1/workspaces/:workspaceId` | Current authorized Workspace |
| POST | `/v1/workspaces/:workspaceId/work` | `{ id, intent, participants: PrincipalId[], roles: { workOwners, decisionAuthorities, reviewers, approvers }, context }` -> Work |
| GET | `/v1/workspaces/:workspaceId/work/:workInstanceId` | Current Work projection for participant |
| GET | `/v1/workspaces/:workspaceId/work/:workInstanceId/history` | Authorized Work operation history |
| POST | `/v1/workspaces/:workspaceId/work/:workInstanceId/episodes` | `{ id, objective, expectedVersion, context }` -> episode |
| GET | `/v1/workspaces/:workspaceId/work/:workInstanceId/events` | Authorized append-only Work operations as SSE. Resume with `Last-Event-ID` or `?after=<ledgerSequence>` |

Success: `{ ok: true, data: ... }`; failure:
`{ ok: false, error: { code } }`. Errors do not expose tokens or
internal exception messages. `Cache-Control: no-store` is set.
Identity, Work participation and **fresh** workspace membership are checked
before reads and every mutation. Non-human Work enrollment still fails closed
until explicit delegated capabilities are implemented. No arbitrary Work
actions, external side effects, or administrative mutation routes are exposed.

## Boundaries / non-goals

- **Loopback HTTP only.** Never bind to a public interface or expose over an
  insecure HTTP proxy. Real self-host deployments require a reviewed TLS,
  reverse-proxy/session-trust, CSRF/CORS, request/abuse protection and transport
  security design.
- The `BoundPrincipalSessions` credentials are intentionally provisioned
  in-memory by the operator; these are *not* user password authentication,
  persistently revocable sessions, OAuth/OIDC, or an identity provider.
- Resumable **in-process, journal-backed SSE** is available for Work events.
  It is not a cross-node durable realtime event bus, WebSocket transport,
  or general collaboration/presence service. Reconnect and reread the ledger
  after a server restart; no volatile notifications are persisted separately.
- No PostgreSQL provider, cross-ledger transaction, process-distributed lock,
  durable token/session store, agent grants, or independently hosted compute
  is implemented here.
- WYG-019 `passes=false` and release readiness remains `NO-GO`.

Verify through the repository CI gate. Targeted regression:

```sh
node --test services/selfhost-api/test/selfhost-work-api.test.ts
pnpm typecheck
pnpm boundaries
pnpm test:all
```

### Credential lifecycle and authority note

The server intentionally has **no public login or credential issuance route**.
A bearer token maps to exactly one operator-provisioned PrincipalId, and
revocation only takes effect in the current process. The startup code must
obtain distinct random secrets over a trusted secret-management channel. The
Workspace journal remains the source of truth for active membership, and the
Work journal remains the source of truth for explicit Work participation.
Unrecognized token, missing membership, and missing Work participation all
fail before any consequential Work operation. Unaccepted invitations provide
no access. A session token is not itself a delegated AgentPrincipal write
capability.

## Resumable Work event stream (WYG-019 incremental slice)

Use an authenticated streaming HTTP client (such as `fetch` with
`Authorization: Bearer ...`). Native browser `EventSource` cannot directly
supply this custom bearer header.

```http
GET /v1/workspaces/workspace%3Ateam/work/work-instance%3Areview/events?after=0
Authorization: Bearer <operator-provisioned-token>
Accept: text/event-stream
```

The server verifies **current** workspace membership, Work participation,
and the bearer session *before* opening the stream. It then reconstructs
authorized `work-instance.created`, `work-episode.started`, and other Work
operations from the existing durable Work ledger. On a new append, an
in-process notification wakes the stream, which rereads the ledger. The hint
itself is not canonical history. Events use a causal `ledgerSequence` cursor:

```text
id: 2
event: work-operation
data: {"operation":{"id":"work-operation:example","kind":"work-episode.started", "...":"..."}}
```

The example's fields are illustrative. Actual events contain the full
canonical Work operation (and potentially sensitive Work context), so never
publish this stream on an unauthenticated or externally reachable endpoint.

Reconnect with the previous delivered SSE `id` as `Last-Event-ID: 2` or
`?after=2`. Omitting the cursor replays the authorized Work history from
its beginning. Nonnegative safe decimal integer cursors only; conflicting
query/header cursors fail with HTTP 400. An id may skip numbers because the
ledger assigns sequences per workspace, not per Work instance. A reconnect
with a future cursor may see no events until later operations exceed it.

Heartbeat comments are emitted periodically. Sessions and current Work
authorization are checked for each new event and heartbeat; revoked or
expired sessions are closed rather than allowed to receive subsequent
operations. Slow readers are disconnected instead of accumulating an
unbounded in-process queue. Clients must reconnect with their last
**successfully processed** event id. There is no event acknowledgment or
durable subscriber offset in this slice.

The stream remains **loopback-only** and tied to the same process as the
single-writer JSON Work journal. No independent message broker, clustered
delivery, distributed lock, WebSocket, cross-process subscriber registry,
production TLS, or PostgreSQL-backed transport is implied.

Regression tests: `node --test services/selfhost-api/test/work-events-sse.test.ts`.

## Persistent local bearer sessions (next WYG-019 slice)

`DurablePrincipalSessions` is an optional **single-writer, local JSON**
credential journal. It is a compatible `SessionAuthenticator` for
`SelfHostWorkApi` and the SSE stream. Its immutable `session.issued` and
`session.revoked` records use storage-assigned causal ledger sequences.
Replaying the journal after restart reconstructs active and revoked sessions;
revocation cannot be undone by reusing the same bearer secret.

Trusted operator bootstrap can provision and revoke credentials, for example:

```ts
import { DurablePrincipalSessions } from "./index.ts";

// Open the canonical Workspace journal first. Use its already verified
// registered human principals; no agent capability is granted by a bearer.
const sessions = await DurablePrincipalSessions.open({
  ledgerPath: "./data/principal-sessions.json",
  workspaces,
});
try {
  await sessions.provision({
    operationId: "session-operation:issue-owner-1",
    sessionId: "session:owner-1",
    principalId: "principal:owner",
    token: process.env.WOYENGI_OWNER_TOKEN ?? "",
    expiresAt: "2026-10-18T20:00:00Z",
    recordedAt: "2026-10-17T20:00:00Z",
  });
  // Pass sessions into SelfHostWorkApi. These operator actions are NOT routes.
  // Later: await sessions.revoke({ operationId: ..., sessionId: ..., recordedAt: ... });
} finally {
  await sessions.close();
}
```

The dates above illustrate the API contract, **not a production deployment
configuration**. Generate fresh unpredictable secrets for every session and
choose current issuance/expiry times; expiry must be after issuance and within
30 days. Identical tokens and session IDs are never accepted twice, including
when the previous session is revoked. Only principals registered as humans
may be provisioned. The existing workspace membership and Work participant
checks remain mandatory for every request.

The session ledger persists **SHA-256 token digests**, principal references,
expiry, issuance and revocation history; it does not persist plaintext bearer
tokens. Bearer secrets should have at least 32 characters of high-quality
unpredictable randomness, despite minimum length alone not proving entropy.
Session ledger files are created or rewritten with Unix mode `0600`, and
existing ledger files are tightened on reopen before their contents are read.
Operators must also protect the containing directory and backups; offline
theft of a ledger containing a digest must still be treated as a security
exposure. Human operator verification, secret distribution, and
the permission to provision/revoke are **outside** this service: it must never
be exposed directly to untrusted callers.

Reopening a malformed or unknown-operation ledger fails closed instead of
resetting a session; the `.writer.lock` refuses a second concurrent writer.
After a crash, do not remove a stale writer lock until the original process
is confirmed stopped. `history()` exposes sensitive digests for **trusted
audit tooling only**, never through HTTP. Current HTTP and SSE authorization
uses the active session journal, so durable revocations apply immediately to
new requests and before subsequent streamed Work events.

This is **not PostgreSQL**, multi-server session coordination, an OIDC/login
provider, credential refresh, interactive user enrollment, multi-factor auth,
TLS, or release-ready self-hosting. A real multi-process deployment needs
Postgres-compatible transactional session storage and online credential and
revocation propagation. Full WYG-019 remains unaccepted.

Additional falsifiers: `node --test services/selfhost-api/test/durable-sessions.test.ts`.

## PostgreSQL-backed authenticated Work HTTP (WYG-019 incremental slice)

The existing `SelfHostWorkApi` now accepts **asynchronous** Workspace and
Work repository ports. Both the single-writer local journals and the
PostgreSQL-backed `PostgresWorkspaceJournal` and `PostgresWorkJournal`
implement these ports. HTTP routes, strict body validation, bearer-derived
actor identity, idempotency key conflict behavior, participation checks, and
response formats remain the same.

A trusted bootstrap may supply PostgreSQL journals **after** privileged
schema migration and independently provisioned bearer credentials:

```ts
import {
  PostgresWorkspaceJournal,
  PostgresWorkJournal,
} from "../postgres-storage/index.ts";
import { SelfHostWorkApi, BoundPrincipalSessions } from "./index.ts";

// `pool` is a trusted, separately configured PostgreSQL driver pool.
// `migratePostgresCanonicalLedger(pool)` must already have run.
const workspaces = PostgresWorkspaceJournal.open({ pool });
const work = PostgresWorkJournal.open({ pool, workspaces });
const sessions = new BoundPrincipalSessions([
  { principalId: "principal:owner", token: process.env.WOYENGI_OWNER_TOKEN ?? "" },
]);
const api = new SelfHostWorkApi({ workspaces, work, sessions });
const server = await api.listen({ hostname: "127.0.0.1", port: 8181 });
// The trusted process must close `server` and its owned `pool` on shutdown.
```

The driver remains deployment-managed rather than bundled into the offline
CLI. No HTTP route provisions principals, sessions, memberships or tokens.
**This is a loopback-only integration slice**, not a public HTTPS deployment.
Bearer credentials in the example are unverified operator bootstrap inputs;
their issuance/revocation is not currently coordinated through PostgreSQL.

### PostgreSQL stream boundary

The JSON Work routes use PostgreSQL and are readable by another server
instance using an independent database connection. The existing
`GET .../events` SSE endpoint deliberately returns HTTP
`501 STREAM_UNAVAILABLE` for PostgreSQL-backed Work, **after** checking
Work authorization. The prior local SSE implementation observes only its
own process's journal notifications. Pretending it works cross-process would
lose events silently. PostgreSQL clients can use the authorized
`GET .../history` route to recover durable changes until a separate,
authenticated, cross-process event transport is added.

### Verification

The live PostgreSQL GitHub Actions job now also runs
`services/selfhost-api/test/postgres-work-http-live.test.ts`. It creates
two separately connected loopback API servers sharing one PostgreSQL database,
verifies two-human Work creation/replay, outsider and nonparticipant read
denial, forged actor rejection, optimistic-version conflict across two HTTP
process-side adapters, duplicate idempotency rejection, restart/recovery,
and explicit SSE unavailability. This tests independent server instances
in one Node test process, **not** separate operating-system processes or
full distributed deployment.

Remaining work includes PostgreSQL-backed session issuance and revocation,
cross-process subscription/presence transport, DB authorization/Work atomicity
for future membership removals, real proxy/TLS/abuse controls, independently
hosted compute and human acceptance. WYG-019 stays `passes=false`.

## PostgreSQL-backed principal sessions (WYG-019 incremental slice)

`PostgresPrincipalSessions` (from `services/postgres-storage/index.ts`)
implements the API's asynchronous `SessionAuthenticator` port. The same
authenticated Work HTTP routes accept either the original single-writer local
session providers or this multi-client PostgreSQL session journal.

A trusted operator configures separate, TLS-protected PostgreSQL credentials
and performs the schema migration, then provisions tokens from a trusted
administrative channel. **Neither issue nor revoke is exposed by HTTP.**
For example, after migration:

```ts
import {
  PostgresPrincipalSessions,
  PostgresWorkspaceJournal,
  PostgresWorkJournal,
} from "../postgres-storage/index.ts";
import { SelfHostWorkApi } from "./index.ts";

const workspaces = PostgresWorkspaceJournal.open({ pool });
const work = PostgresWorkJournal.open({ pool, workspaces });
const sessions = PostgresPrincipalSessions.open({ pool, workspaces });
await sessions.provision({
  operationId: "session-operation:owner-20261018",
  sessionId: "session:owner-20261018",
  principalId: "principal:owner", // Already registered human
  token: process.env.WOYENGI_OWNER_TOKEN ?? "",
  recordedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
});
const api = new SelfHostWorkApi({ workspaces, work, sessions });
const server = await api.listen({ hostname: "127.0.0.1", port: 8181 });
```

`provision` and `revoke` are **trusted operator** methods only, not
public client API operations. Provisioning enforces registered human
principals, strong token formatting and up to 30-day expiry. Canonical
records store **SHA-256 digests, never raw tokens**, with append-only
`session.issued` and `session.revoked` operations in a global SQL scope.
The SQL transaction lock serializes competing grants and revocations;
duplicate/revoked tokens and session identifiers cannot be reused.
Every authenticated HTTP request rereads committed PostgreSQL history
and recomputes active sessions. A revocation committed through one database
pool is denied to subsequent requests through another pool, including after
new API instances start. An already in-flight request is **not** retroactively
cancelled by revocation. Missing, malformed or corrupted session history
fails closed without granting authority.

Protect SQL credentials, connection transport and the session journal
tables. The database rows include sensitive hashed bearer tokens and
principal associations. Token-length requirements **do not prove entropy**:
operators must use a cryptographically secure generator and deliver tokens
through a trusted channel. SHA-256 digests are not a substitute for
defensive database roles, network isolation, rate limiting, TLS and audit.
Do not grant ordinary API clients direct journal mutation privileges.

**Realtime limitation:** the PostgreSQL Work SSE route remains
`501 STREAM_UNAVAILABLE` until reliable cross-process event delivery and
async authorization rechecks exist. Local SSE with an asynchronous
PostgreSQL session backend also returns 501, rather than silently delivering
a stream that cannot keep credentials revalidated.

The PostgreSQL CI integration test
`services/selfhost-api/test/postgres-sessions-live.test.ts` verifies
authentication on independently connected HTTP instances, cross-instance
revocation, restart recovery, concurrent token collision, expired tokens,
agent/unknown principal refusal, digest-only persistence and fail-closed
corrupt history. **Two independent HTTP instances in one test process are
not proof of an externally deployed multi-process service.**

PostgreSQL session distribution does not provide public login, MFA,
credential refresh/rotation, cross-ledger revocation transactionality,
distributed realtime, agent capability grants, internet-facing TLS/proxy
hardening, or remotely hosted compute. WYG-019 remains unaccepted.
