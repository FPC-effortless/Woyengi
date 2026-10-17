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
- No realtime WebSocket/SSE, PostgreSQL provider, cross-ledger transaction,
  process-distributed lock, durable token/session store, agent grants, or
  independently hosted compute is implemented here.
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
