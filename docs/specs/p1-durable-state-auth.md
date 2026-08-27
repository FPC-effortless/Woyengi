# P1 durable state + auth/session principals

Status: PLANNING ONLY — implementation is blocked until P0 OperationalSystemSpec/WorldBundle alignment is verified and explicitly human-accepted.

Issue: #14  
Parent: #6  
Planning branch: `plan/p1-durable-state-auth`  
Work mode: product engineering

## 1. Problem and outcome contract

Woyengi already has deterministic product-domain models for Account/Workspace/Membership/Principal, WorkInstance/WorkEpisode, ApplicationInstance, capabilities, and a runnable HTTP API. The production path is not yet a durable multi-process product path: Workspace and Work registries are in memory, ApplicationInstaller state is in memory, capabilities/revocations are in memory, and the deployed API authenticates one static bearer principal then uses an unconditional allow-all authorizer.

P1 succeeds only when a fresh implementation agent can make the following tracer behavior true without changing constitutional kernel semantics:

> A human principal can be durably provisioned into a workspace, obtain a revocable session, create/reopen workspace-scoped Work and Application state, restart the server, and continue from the same causal history; a stale, revoked, unauthenticated, or cross-workspace request fails closed before reading or mutating governed state.

The durable provider owns publication order and transaction boundaries. Domain registries remain deterministic domain logic and projections; PostgreSQL/filesystem details do not enter `packages/core` or the domain types.

## 2. Hard dependency / authority gate

No coding ticket in this plan may start until all of the following are true:

1. P0 OperationalSystemSpec/WorldBundle alignment is merged or otherwise accepted on the implementation baseline.
2. P0 executable verification is GREEN rather than static-review-only.
3. Human acceptance explicitly confirms the P0 authority/evaluation boundaries.

Evidence at planning time says this gate is OPEN: `.agents/handoffs/20260827-1057-p0-operational-alignment.md` records P0-001 as verification-blocked, its PR as draft, and human acceptance as still required.

If P0 changes workspace, authority, projection, or WorldBundle contracts in a way that invalidates the interfaces below, stop and re-run `wayfinder -> to-spec -> to-tickets`; do not silently adapt implementation semantics.

## 3. Reconstructed current implementation and exact gaps

| Area | Current implementation | Gap that P1 must close |
| --- | --- | --- |
| Account / Workspace / Membership / Principal | `packages/workspace/src/index.ts` has immutable namespace IDs, deterministic `WorkspaceRegistry`, typed causal `WorkspaceOperation`s, `history()`, and `replay()`. Account ownership and membership access are validated. | Registry and operation sequence are process memory. No durable directory/provider, no production session integration, no multi-process compare-and-append. |
| WorkInstance / WorkEpisode | `packages/work/src/index.ts` has workspace-scoped Work state, optimistic `expectedVersion`, typed `WorkOperation`s, causal history, replay, episode/activity/assignment/outcome semantics. | Registry is in memory; `authorizationReference` is recorded but not evaluated; no durable server service/API. |
| ApplicationInstance | `packages/apps/src/index.ts` has portable packages, workspace-bound install, semantic binding isolation, compatibility migrations, update and rollback. | `ApplicationInstaller` keeps packages/instances in Maps and has no instance operation journal/replay seam. |
| Local durability | `packages/storage/src/index.ts` has atomic JSON local ledger/idempotency/object stores and storage-owned per-workspace ledger sequence. `services/personal-runtime` persists one offline Personal Workspace snapshot/artifact and reconstructs it. | Local JSON is single-process/single-writer. Personal runtime persists a bounded snapshot, not a concurrent team/server domain journal. |
| Database topology | `deploy/docker/compose.yaml` already declares PostgreSQL and `WOYENGI_POSTGRES_URL`. | Runtime has no PostgreSQL client/provider or schema/migration path for workspace/work/app/session state. |
| Capability policy | `packages/permissions/src/index.ts` has default-deny workspace-scoped, expiring, revocable, strictly narrowed capabilities. | Engine storage is in memory and the production API does not compose it. This lane must consume policy through a port; it must not redefine capability semantics. |
| Authentication | `services/platform-api/src/security.ts` maps one configured bearer token to one principal. | No session ID, expiry-backed persisted session, one-time issuance, durable revocation, or principal provisioning/exchange flow. |
| API authorization | `PlatformApiPorts.authorize` is synchronous and lacks WorkspaceContext; `main.ts` wires `localAuthorize = allowed`. | Every governed route needs an authenticated session + independently resolved WorkspaceContext + default-deny policy decision before handler execution. |
| Existing public API | State/ingest/reconstruct/control/subscribe endpoints exist. | Product APIs/ports do not yet expose durable Account/Workspace/Work/App/session behavior for a live vertical. |

## 4. Scope

### In scope

- Durable Principal, Account, Personal/Organization Workspace, and Membership operation history.
- Durable session issuance, lookup/authentication, expiration, revocation, and restart semantics.
- Durable WorkInstance/WorkEpisode operation history and optimistic concurrency.
- Durable ApplicationInstance install/update/rollback history and reconstruction.
- PostgreSQL transaction provider suitable for at least two server processes.
- A local/offline migration path from the existing personal-runtime persisted state into the durable provider without destroying the source.
- Workspace isolation at storage lookup, domain reconstruction, authentication context, authorization, and API handler boundaries.
- Public ports and the minimum HTTP composition required for a live product vertical.
- Replay, migration, rollback, idempotency, causal order, partial-write, and concurrent-writer falsifiers.
- Stable access-context ports consumed by later execution and realtime lanes.

### Non-goals

- No changes to `packages/core` constitutional record semantics.
- No new shared ADR or changes to P0 OperationalSystemSpec/WorldBundle contracts.
- No SSO, SCIM, password database, MFA, enterprise directory sync, residency, or advanced organization role policy.
- No redesign of capability/authority semantics. Dynamic durable capability administration is a separate authority/execution concern; this lane calls it through a default-deny port.
- No websocket/SSE transport implementation and no governed execution implementation. This lane supplies their access contract.
- No durable memory/search/vector/graph/composer/evaluation stores.
- No silent import, destructive migration, automatic deletion of the existing personal-runtime state, or readiness claim from package tests alone.

## 5. Wayfinder decisions

### D1 — Persist product-plane operations behind ports; do not make the database the domain model

**Question:** Should Account/Work/App state become database-shaped records or kernel records?  
**Decision:** No. Keep existing domain operations and deterministic replay semantics; add append/compare-and-append persistence adapters outside the kernel. Mutable read models are projections and may be rebuilt.  
**Why:** This preserves the Constitution, existing replay tests, and ADR 0006's storage-owned causal ordering while allowing a PostgreSQL implementation.  
**Rejected:** Adding PostgreSQL concepts to `packages/core`; treating mutable SQL rows as sole history; serializing arbitrary object snapshots as governing truth.  
**Reversibility:** High at the provider layer; low if kernel pollution is allowed, therefore prohibited.

### D2 — PostgreSQL is the team/server durability provider; local JSON remains an offline source/adapter

`deploy/docker/compose.yaml` already declares PostgreSQL and explicitly documents the missing runtime connection. The existing JSON adapter is correct for a single writer but cannot establish multi-process compare-and-append. P1 therefore uses a PostgreSQL provider for the self-host/team tracer and preserves local JSON for offline Personal Workspace and migration input.

No agent may hand-roll the PostgreSQL wire protocol. Adding a maintained PostgreSQL client is an ordinary dependency change but must pass the repository dependency/security gates.

### D3 — Provider assigns immutable publication sequence

The durable journal interface accepts an expected partition sequence but not a client-chosen committed sequence. On successful commit it returns the assigned sequence. Equal transaction timestamps never determine replay order. Domain ordinals such as Work episode/activity sequence remain separate from durable publication sequence.

Concurrent writers use compare-and-append. A stale expected partition sequence fails with a typed conflict; the caller reloads/revalidates rather than overwriting.

### D4 — Sessions authenticate a Principal; they never grant Workspace authority by themselves

A session is a revocable credential binding to one durable Principal. It does not imply membership, capability, authority, or accepted semantic state.

A governed request follows:

`credential -> active session -> Principal -> WorkspaceContext -> authorization policy -> domain handler`

Missing/expired/revoked session, missing workspace access, missing policy provider, or denied policy decision all fail closed.

### D5 — Persist only a digest of bearer session secrets

Session issuance creates a cryptographically random bearer secret, persists only its one-way digest and metadata, commits durable state, then returns the raw secret once. Raw bearer material must not appear in journals, logs, traces, errors, backups, handoffs, or migration artifacts.

If commit fails, the generated token is invalid because no digest was published. If the response is lost after commit, an idempotent retry must not reconstruct or re-disclose the raw token; the caller rotates/mints a new session through an explicitly authorized flow.

### D6 — Local bootstrap credential is exchange-only after P1

The existing environment bearer may be retained only as a self-host bootstrap/credential-verifier adapter. It must not authorize governed workspace routes directly.

Fresh-install bootstrap is one-time and transactional: when no human Account exists, an explicitly configured bootstrap identity may register the first human Principal, create its Account/Personal Workspace, and issue the first session. Once durable human state exists, bootstrap provisioning fails closed. General password/SSO identity proof is out of scope and remains behind `CredentialVerifierPort`.

### D7 — ApplicationInstance receives a durable integration journal, not package-owned production data

Application package definition, workspace semantic data, credentials, and authority remain separate per ADR 0005. Durable ApplicationInstance operations reference immutable package content/version plus workspace bindings/configuration. Package bytes/manifests may be content-addressed before the journal commit; an unreferenced object after a failed commit is garbage, not authoritative state.

Application replay must reproduce install/update/rollback behavior after restart. Missing or hash-mismatched package material fails closed.

### D8 — Migration uses copy/verify/cutover; rollback is compatibility-first

Database schema migration uses expand/contract semantics where possible. P1 import from `services/personal-runtime` is explicit: dry-run -> copy -> replay/verify -> human-authorized cutover. The source state is not deleted by the importer.

Rollback of an application release means the prior binary remains able to read the expanded schema during the supported rollback window. A destructive schema down-migration is not the default rollback mechanism. Any irreversible contraction requires a separate human authority gate and backup evidence.

## 6. State and effect model

### Authoritative durable state owned by this lane

1. **Workspace directory journal** — typed Principal/Account/Organization/Workspace/Membership operations needed to replay `WorkspaceRegistry`.
2. **Session journal/index** — `session.issued`, `session.revoked` (and explicit rotation as revoke + issue), with token digest, principal, issuer/actor, issue/expiry/revocation times and idempotency identity.
3. **Work journal** — typed `WorkOperation`s partitioned by Workspace, preserving Work optimistic version semantics.
4. **ApplicationInstance journal** — typed install/update/rollback operations referencing immutable package material and workspace-bound installation inputs.

PostgreSQL indexes/current-state rows are disposable/rebuildable projections unless a ticket explicitly proves they are part of an atomic uniqueness constraint. They are not a replacement for the journal.

### Effects

| Effect | Classification | Rule |
| --- | --- | --- |
| Append durable domain operation | Internal durable-state effect | One DB transaction; commit or no authoritative publication. |
| Update derived current-state/index row | Internal projection effect | Same transaction when needed for uniqueness/CAS; rebuildable from journal. |
| Generate raw session token | Sensitive runtime effect | Never journal plaintext. Return only after commit. Never replay it. |
| Revoke session | Governed durable-state effect | Actor/session authority required; persists before subsequent auth can succeed. |
| Read governed state | Observable product effect | Requires active session + WorkspaceContext + allow decision first. |
| Import/cut over local state | Operator migration effect | Dry-run and evidence first; explicit human authority before cutover. |
| Execute external business action | Out of lane | Execution lane re-authorizes at the effect boundary; DSA does not replay it. |

## 7. Public interfaces to stabilize

Exact names may be adjusted during TDD only if behavior is unchanged; semantic responsibilities may not be collapsed.

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

export interface DurableEnvelope<Payload> {
  readonly journal: string;
  readonly partition: string;
  readonly ledgerSequence: number;
  readonly operationId: string;
  readonly transactionTime: string;
  readonly payload: Payload;
}
```

`compareAndAppend` must be atomic across duplicate-operation detection, sequence assignment, and any required projection/idempotency rows.

```ts
export interface WorkspaceStatePort {
  getWorkspaceContext(input: { principalId: string; workspaceId: string }): Promise<WorkspaceContext>;
  listOperations(): Promise<readonly WorkspaceOperation[]>;
  // Command methods mirror the existing WorkspaceRegistry behavior and return committed operations/state.
}

export interface SessionPort {
  issue(input: SessionIssueRequest): Promise<IssuedSessionCredential>; // raw bearer returned once
  authenticate(input: { bearer: string; at: string }): Promise<AuthenticatedSession | undefined>;
  revoke(input: SessionRevocationRequest): Promise<void>;
}

export interface AuthorizationPolicyPort {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}

export interface AccessContextResolverPort {
  authorize(input: {
    bearer: string;
    workspaceId: string;
    operation: CapabilityOperation;
    resourceId: string;
    graphType: string;
    entityId: string;
    purpose: string;
    sensitivity: Sensitivity;
    context: Readonly<Record<string, string>>;
    at: string;
  }): Promise<AuthorizedWorkspaceContext>;
}
```

`AuthorizedWorkspaceContext` contains only the stable session/principal/workspace decision references needed downstream: `sessionId`, `principalId`, `workspaceId`, `evaluatedAt`, and policy decision/capability reference. It contains no bearer secret.

Equivalent public state ports are required for Work and ApplicationInstance so the live API/shell never reaches directly into registry Maps or PostgreSQL tables.

## 8. Auth enforcement points

1. **Credential edge:** parse bearer -> session lookup. No handler runs on failure.
2. **Workspace resolution:** Workspace ID comes from an independent request scope (path or required workspace header), never only from the request body. Body/resource Workspace IDs must match the resolved scope.
3. **Membership/access resolution:** durable `WorkspaceRegistry` semantics prove the Principal can switch into the Workspace.
4. **Policy decision:** invoke `AuthorizationPolicyPort`; absent provider means deny.
5. **Domain command:** handler receives `AuthorizedWorkspaceContext`, not a caller-asserted Principal/Workspace pair.
6. **Consequential effect boundary:** later execution lane re-evaluates authority before an external effect when the request can outlive the original authorization instant.
7. **Realtime:** session/workspace authorization is required on connect/resume/subscribe and before any durable mutation; revocation must be observable on the next validation boundary.

Cross-workspace resource aliases, shared semantic identities, package bindings, or subscription IDs never bypass WorkspaceContext.

## 9. Falsifier-first verification matrix

| Falsifier | Setup / attack | Required observation |
| --- | --- | --- |
| Restart/replay | Create Principal + Account + org Membership, issue session, create Work + episode, install/update App; stop process and construct fresh services from durable provider. | Same IDs, versions, statuses and operation order reconstruct. No in-memory-only state is required. |
| Cross-workspace leakage | Principal is allowed in Workspace A but not B. Send A session with B path/header, B body/resource ID, aliased semantic object, Work ID, App ID and subscription ID. | 403/default deny before handler data is returned or mutation is committed; response contains no B payload. |
| Session revocation | Authenticate successfully, durably revoke, reuse token immediately and after restart. Also test expiry boundary. | Reuse is denied; restart never resurrects the session; plaintext token is absent from persisted rows/log/evidence. |
| Causal ordering | Append equal-time operations and race two writers from the same expected sequence. | Storage assigns strictly increasing sequence; exactly one stale competing append commits; replay follows sequence, not ID/time tie-break. |
| Partial write | Inject failure after an attempted journal/projection/idempotency mutation but before transaction commit. | Zero partial authoritative state is visible after reconnect. Retry with same operation ID is deterministic. |
| Stale Work version | Two processes load same Work version and submit incompatible mutations. | One commits; loser receives typed conflict/reloads. No last-writer overwrite. |
| App restart/rollback | Install v1, update v2, restart, rollback to v1; remove/corrupt required package artifact in negative fixture. | Valid chain reconstructs/rolls back; missing/hash-invalid package fails closed; no cross-workspace binding appears. |
| Lost session response | Commit session issuance then simulate lost HTTP response and retry same idempotency key. | Raw secret is not replayed from persistence. Caller must rotate/mint explicitly; no second hidden active credential is created by an automatic retry. |
| Migration | Dry-run existing personal-runtime state, inject malformed/ambiguous references, then perform valid copy/verify. | Invalid import makes no durable mutation; valid import replay-equivalent; original source remains intact until explicit cutover. |

## 10. Integration contracts with other P1 lanes

### Execution lane

- Imports `AccessContextResolverPort` / `AuthorizedWorkspaceContext`; it does not edit DSA persistence/session files.
- Existing API control handler receives an authorized context/reference from the DSA-owned edge.
- Long-running/consequential execution calls the access/policy port again immediately before an external effect; a stale initial decision is not a capability lease.
- Execution owns effect planning/reconciliation/verification/semantic-commit logic. DSA owns only durable access and product-domain state.

### Realtime lane

- Imports the same access port and durable Work state port.
- It owns transport/presence/session-connection mechanics, not credential issuance or Workspace membership state.
- Subscription/resume and durable mutation paths validate session + WorkspaceContext. Presence remains ephemeral unless separately specified.
- Revocation handling may poll/validate at a transport boundary initially; no requirement here to build a push revocation bus.

### API composition

The DSA implementation ticket owns the API auth composition files it changes. Execution/realtime agents integrate through handler ports already exposed by the service/runtime boundary rather than concurrently editing those files. If a later lane discovers the port is insufficient, it opens a minimal interface-change ticket rather than editing DSA-owned files in parallel.

## 11. Migration and rollback contract

- PostgreSQL migrations are versioned, transactional where PostgreSQL permits, and recorded in the repository migration manifest by the persistence-provider ticket.
- Initial schema is additive: journals, session lookup projection, idempotency/uniqueness constraints and optional rebuildable current-state projections.
- Deployment startup fails closed on unknown/newer schema version; it does not opportunistically mutate schema in request handling.
- Existing local Personal Runtime migration is an explicit operator action. Dry-run produces counts, IDs, package hashes, replay result and collision report without writes.
- Copy is idempotent by immutable operation IDs/content hashes. Conflicting same-ID/different-payload input aborts.
- Cutover requires human authority after replay equivalence evidence.
- Source local state is retained for rollback. The P1 importer never deletes it.
- Schema contraction or source deletion is a later separately authorized operation.

## 12. Acceptance criteria

P1 #14 planning is implementation-ready when the ticket set below is accepted as the execution contract. P1 implementation is complete only when, after the P0 gate opens:

1. PostgreSQL durable journal tests prove provider-owned sequence, compare-and-append and atomic failure behavior.
2. Workspace/Principal/Account/Membership reconstruct across a fresh process and remain isolated.
3. Session issuance/revocation/expiry survives restart and no raw bearer is persisted.
4. WorkInstance/WorkEpisode operations survive restart with optimistic concurrency intact.
5. ApplicationInstance install/update/rollback survives restart and preserves package/workspace separation.
6. The production API no longer uses `localAuthorize = allowed` for governed routes and a static environment bearer cannot directly authorize them.
7. Existing state/ingest/reconstruct/control/subscribe paths carry independently resolved WorkspaceContext into authorization.
8. The restart, cross-workspace, revocation, causal-order, partial-write and concurrency falsifiers pass on a clean PostgreSQL-backed test surface.
9. Local personal-runtime migration dry-run/copy/replay evidence passes and source rollback remains possible.
10. `pnpm typecheck`, `pnpm boundaries`, targeted tests, relevant integration/conformance tests, `pnpm test:all`, and the repository security/production gates required by the implementation scope execute and pass.
11. No readiness/production claim is made solely from package tests; human acceptance is recorded for the migration/cutover evidence where applicable.

## 13. Ticket dependency graph

```text
P0 accepted
   |
   v
DSA-001 durable journal + Workspace directory tracer
   |\
   | +-------------------+
   v                     v
DSA-002 sessions/access  DSA-003 durable Work
   |                     |
   |              +------+
   |              |
   |              v
   |         DSA-004 durable App
   |              |
   +-------+------+ 
           v
      DSA-005 live API enforcement
           |
           v
      DSA-006 migration + full falsifier conformance
```

DSA-003 and DSA-004 may run in parallel after DSA-001 because their future file ownership is disjoint. DSA-005 is serialized after their public ports are stable.

## 14. Human authority gates and unresolved risks

### Human authority gates

- P0 acceptance before any implementation.
- Approval of any irreversible/destructive database migration.
- Migration cutover from existing local state after dry-run/replay evidence.
- Any production-readiness claim after operational evidence, not merely unit tests.

### Unresolved but bounded

1. **PostgreSQL client selection/version:** no client dependency exists today. The implementation agent may select a maintained ESM/TypeScript-compatible client after dependency/security review; it must not hand-roll the protocol. This does not change the port contract.
2. **External identity proof:** P1 defines `CredentialVerifierPort` and a one-time self-host bootstrap adapter, not passwords/SSO. Enterprise identity providers are later integrations.
3. **Durable capability administration:** existing capability semantics are consumed through `AuthorizationPolicyPort`. If the execution/authority lane requires dynamic durable capability grant/revoke state, that work needs its own exclusive ticket; #14 must not redefine capability semantics to absorb it.
4. **Large replay cost:** P1 correctness may replay journals at process start. Snapshots/checkpoints are optimizations and remain non-authoritative until measured need justifies a later ticket.
5. **P0 contract drift:** any accepted P0 change affecting authority/projection boundaries triggers re-planning rather than silent compatibility code.

## 15. Ticket artifacts

Implementation-ready tickets live under `docs/tickets/p1-durable-state-auth/`. Their explicit future file reservations are authoritative for parallel implementation coordination once P0 is accepted.
