# P1 durable state/auth planning handoff

Date: 2026-08-27  
Work mode: Product engineering — PLANNING ONLY  
Program: Woyengi #6  
Planning issue: #14  
Branch: `plan/p1-durable-state-auth`

## Outcome and current state

Planning lane #14 is complete through the required lifecycle:

`wayfinder -> to-spec -> to-tickets -> handoff`

No source code, `prd.json`, `progress.txt`, shared ADR, P0 file, or another lane's planning file was edited.

The implementation contract is now durable in:

- `docs/specs/p1-durable-state-auth.md`
- `docs/tickets/p1-durable-state-auth/README.md`
- `docs/tickets/p1-durable-state-auth/001-postgres-journal-workspace-tracer.md`
- `docs/tickets/p1-durable-state-auth/002-session-access-context-tracer.md`
- `docs/tickets/p1-durable-state-auth/003-durable-work-tracer.md`
- `docs/tickets/p1-durable-state-auth/004-durable-app-instance-tracer.md`
- `docs/tickets/p1-durable-state-auth/005-live-api-auth-enforcement.md`
- `docs/tickets/p1-durable-state-auth/006-migration-conformance.md`

The plan is implementation-ready but **implementation-blocked**. P0 is not yet verified/human-accepted; every coding ticket carries that hard dependency.

## Current implementation reconstructed during planning

Read-only inspection established:

- `packages/workspace/src/index.ts`: Account/Workspace/Membership/Principal are deterministic in-memory registry state with typed operation history/replay; no durable provider.
- `packages/work/src/index.ts`: WorkInstance/WorkEpisode and related activities/assignments/outcomes have typed operation history/replay and optimistic expectedVersion; registry is in memory and authorization references are not evaluated there.
- `packages/apps/src/index.ts`: ApplicationPackage/ApplicationInstance install/update/rollback behavior exists, but ApplicationInstaller package/instance state is Map-backed and has no operation journal/replay seam.
- `packages/storage/src/index.ts`: local JSON ledger/idempotency/object adapters are atomic for a single writer and already establish storage-owned causal sequence; not a multi-process server provider.
- `services/personal-runtime/src/index.ts`: offline Personal Workspace state is persisted as `artifact:personal-runtime-state-v1` + content-addressed object and reconstructed, but this is a bounded v1 snapshot format, not team/server journaling.
- `packages/permissions/src/index.ts`: default-deny workspace-scoped capability semantics exist, including revocation/narrowed delegation, but engine state is in memory.
- `services/platform-api/src/security.ts`: one static bearer maps to one Principal.
- `services/platform-api/src/index.ts`: current authorize port is synchronous and lacks WorkspaceContext.
- `services/platform-api/src/main.ts`: current runtime wires an unconditional local allow authorizer.
- `deploy/docker/compose.yaml`: PostgreSQL is already in deployment topology and `WOYENGI_POSTGRES_URL` is already supplied, but no PostgreSQL client/provider is present in package dependencies/runtime.

## Decisions already made

Canonical source: `docs/specs/p1-durable-state-auth.md`.

Key decisions:

1. **No kernel/database pollution.** Durable Account/Workspace/Work/App state is append-oriented product-plane operation history behind ports. Mutable SQL/current-state rows are projections, not a second domain model.
2. **PostgreSQL for team/server durability.** Existing JSON remains valid for offline/single-writer Personal mode and as migration source.
3. **Provider-owned causal publication.** Compare-and-append uses expected partition sequence; provider assigns immutable committed sequence. Equal timestamps do not order replay.
4. **Session != authority.** Credential -> active session -> Principal -> WorkspaceContext -> explicit authorization policy -> handler. Missing policy fails closed.
5. **Session secrets are one-time effects.** Persist only cryptographic digest/metadata. Never replay/re-disclose raw bearer after a lost response.
6. **Existing static bearer becomes bootstrap/exchange-only.** It cannot directly govern Workspace routes after DSA-005.
7. **App durability stays outside portable package semantics.** Adapter operation journal replays install/update/rollback without moving Workspace data/credentials/authority into ApplicationPackage.
8. **Migration is copy/verify/cutover.** Existing Personal Runtime source remains byte-intact for rollback; no silent/destructive import.
9. **Execution/realtime integration is via ports.** Later lanes import `AccessContextResolverPort` / `AuthorizedWorkspaceContext` and durable domain ports; they do not edit DSA persistence/session/API files in parallel.

Governing sources read during planning:

- `CONSTITUTION.md`
- `docs/architecture.md`
- `docs/agents/modes.md`
- `docs/adr/0002-workspace-principal-and-isolation.md`
- `docs/adr/0005-app-portability-and-shared-state.md`
- `docs/adr/0006-atomic-ingestion-and-causal-ledger-order.md`
- `docs/specs/p0-ecosystem-alignment.md`
- `.agents/handoffs/20260827-1057-p0-operational-alignment.md`
- issue #14 and parent #6

## Ticket dependency route

After P0 acceptance:

1. DSA-001 — PostgreSQL journal + durable Workspace directory.
2. DSA-002 / DSA-003 / DSA-004 — session/access, durable Work, durable App can proceed with disjoint file ownership after DSA-001 (002/003/004 are mutually parallel subject to P0/P0-App contract status).
3. DSA-005 — serialized API access integration after 002/003/004.
4. DSA-006 — migration + full falsifier conformance.

`docs/tickets/p1-durable-state-auth/README.md` is the ownership/dependency index. If a coding agent needs a file outside its reservation, it must stop that edit and report the minimum ownership/interface change.

## Falsifier model captured

The plan requires failing tests before implementation for at least:

- restart/replay with fresh service objects;
- cross-workspace path/header/body/resource/alias attacks;
- session revocation immediate + after restart;
- expiry boundary;
- provider-owned causal order under equal timestamps;
- concurrent stale-head and stale Work-version writers;
- injected transaction partial-write rollback;
- duplicate operation identity/idempotency conflict;
- App install/update/restart/rollback and corrupt package replay;
- raw credential leakage;
- lost session response without secret replay;
- migration dry-run purity, conflict/idempotency, replay equivalence and byte-intact source rollback.

Real PostgreSQL evidence is mandatory for the durability/concurrency falsifiers. Mock-only or skipped DB tests cannot close the implementation tickets.

## Branch / commits

Planning branch began from inspected HEAD:

- `8c4b8dcba124aeb8dfa68515fb3d76f5f875c584`

Planning artifact commits through the pre-handoff head:

- `7747fdc77e159ab79cb2716f5f4d039bd85c3996` — P1 durable state/auth specification.
- `0a7848f121f12b65487efcb2c1001633fe1c9ba0` — ticket index/ownership matrix.
- `540b721329a9aae6f6af0625e02e8fab6e28cb38` — DSA-001.
- `4cc58af6c91c169ebd7f0bcade3d0288f1c5491b` — DSA-002.
- `b459ff3f4d6bebc506ba475aaefd4b69339531dd` — DSA-003.
- `a35c70aa45a14c1660e25a69ccfc01d50a1e392e` — DSA-004.
- `7eaaf04210a16100bbf79cd1b08ca5bca0d21145` — DSA-005.
- `607ac3f79ac1c4c4d6250a54c36518ff845bb8c1` — DSA-006.

The GitHub commit that creates this handoff follows the above pre-handoff head and should be used as the branch tip when continuing.

## Tests / commands actually run

No implementation tests, typecheck, boundaries, benchmark or production gates were run in this planning lane because source code was intentionally not changed and implementation is hard-blocked by P0.

Planning verification performed:

- read issue #14 and parent/P0 planning sources;
- read repository agent/workflow instructions (`wayfinder`, `to-spec`, `to-tickets`, `handoff`);
- read the listed architecture/ADR/current implementation files;
- created only the issue-authorized planning artifacts listed above;
- each coding ticket contains its own executable future verification ladder.

Do not report any runtime/code gate as passed from this handoff.

## Evidence and failures

The decisive upstream failure/gate is documented in `.agents/handoffs/20260827-1057-p0-operational-alignment.md`:

- P0-001 is implementation-present/static-review-remediated but verification-blocked;
- GitHub Actions had not instantiated workflow steps;
- P0 PR remains draft;
- human acceptance is still required.

Therefore P1 implementation must not start merely because this plan exists.

## Authority / external-effect status

This lane performed repository planning writes only. It did not:

- alter user/domain/runtime state;
- issue or revoke real credentials;
- execute external provider effects;
- create semantic commits;
- migrate a database;
- edit production/source code;
- claim product readiness.

The only requested effects were the planning commits on `plan/p1-durable-state-auth`.

## Unresolved risks / gates

1. **P0 gate:** still open; absolute blocker.
2. **PostgreSQL client selection:** package currently has no client dependency. DSA-001 chooses a maintained TypeScript/ESM-compatible client after dependency/security review; no hand-rolled protocol.
3. **Capability persistence:** #14 does not own a redesign/durable administration of capabilities. DSA consumes `AuthorizationPolicyPort` and fails closed when unavailable. If another lane needs durable dynamic grants, create a separate exclusive ticket.
4. **External identity provider:** P1 defines bootstrap/credential-verifier boundary, not password/SSO/SCIM.
5. **P0 App contract:** DSA-004 must consume the accepted post-#8 public App projection contract. If insufficient, report the minimum interface change rather than editing P0/App-owned files.
6. **Replay scale:** startup replay correctness comes before snapshot/checkpoint optimization. Add checkpoints later only from measured need; never make them authoritative.

## Exact recommended next action

Do **not** implement now.

After P0 executable verification and explicit human acceptance are durably recorded, a fresh implementation agent should:

1. read issue #14;
2. read `docs/specs/p1-durable-state-auth.md`;
3. read `docs/tickets/p1-durable-state-auth/README.md`;
4. take DSA-001 only and respect its exact file reservation;
5. run `ask-matt -> implement -> tdd -> verification -> code-review -> handoff`;
6. do not start DSA-002/003/004 until DSA-001's real-PostgreSQL falsifiers and public port are stable.
