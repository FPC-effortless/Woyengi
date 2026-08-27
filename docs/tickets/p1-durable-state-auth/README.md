# P1 durable state/auth implementation tickets

Parent planning issue: #14  
Specification: `docs/specs/p1-durable-state-auth.md`  
Status: implementation BLOCKED until the P0 verification + human-acceptance gate in the specification is closed.

These are tracer-bullet coding tickets, not planning work to execute on `plan/p1-durable-state-auth`.

## Dependency order

| Ticket | Tracer outcome | Depends on | May run in parallel with |
| --- | --- | --- | --- |
| DSA-001 | PostgreSQL durable journal + durable Workspace directory | P0 accepted | none |
| DSA-002 | Principal session issuance/revocation + access context | DSA-001 | DSA-003, DSA-004 after DSA-001 |
| DSA-003 | Durable WorkInstance/WorkEpisode | DSA-001 | DSA-002, DSA-004 |
| DSA-004 | Durable ApplicationInstance install/update/rollback | DSA-001 | DSA-002, DSA-003 |
| DSA-005 | Live API auth enforcement and product ports | DSA-002, DSA-003, DSA-004 | none |
| DSA-006 | Local migration + end-to-end restart/isolation conformance | DSA-005 | none |

Every coding ticket additionally depends on explicit evidence that P0 is verified and human-accepted. A dependency arrow never overrides that gate.

## Exclusive future file reservations

Reservations apply when implementation starts. No two tickets below intentionally own the same path. Later execution/realtime lanes consume DSA public ports and must not edit these files in parallel.

| Ticket | Exclusive future write ownership |
| --- | --- |
| DSA-001 | `packages/persistence/src/index.ts`; `packages/persistence/test/postgres-journal.test.ts`; `packages/workspace-persistence/src/index.ts`; `packages/workspace-persistence/test/workspace-directory.test.ts`; `migrations/p1-durable-state-auth/001_durable_journals.sql`; `migrations/p1-durable-state-auth/README.md`; `migrations/manifest.json`; `package.json`; `pnpm-lock.yaml` |
| DSA-002 | `packages/access-context/src/index.ts`; `packages/access-context/test/access-context.test.ts`; `packages/session-persistence/src/index.ts`; `packages/session-persistence/test/session-persistence.test.ts` |
| DSA-003 | `packages/work-persistence/src/index.ts`; `packages/work-persistence/test/durable-work.test.ts` |
| DSA-004 | `packages/app-persistence/src/index.ts`; `packages/app-persistence/test/durable-app.test.ts` |
| DSA-005 | `services/platform-api/src/index.ts`; `services/platform-api/src/main.ts`; `services/platform-api/src/security.ts`; `services/platform-api/src/access.ts`; `services/platform-api/test/platform-api.test.ts`; `services/platform-api/test/security.test.ts`; `services/platform-api/test/durable-access.test.ts` |
| DSA-006 | `services/personal-runtime/src/durable-migration.ts`; `services/personal-runtime/test/durable-migration.test.ts`; `benchmarks/conformance/test/p1-durable-state-auth.test.ts`; `.agents/handoffs/<implementation-agent-unique>-p1-durable-state-auth.md` |

If an implementation agent discovers that a required change falls outside its reservation, it must stop that edit and report the minimum interface/file-ownership change needed. It must not absorb another ticket/lane's file.

## Stable cross-lane seams

After DSA-002 lands, later lanes may import but do not modify:

- `AccessContextResolverPort`
- `AuthorizedWorkspaceContext`
- `AuthorizationPolicyPort`
- `SessionPort`

After DSA-003/004 land, later lanes may import but do not modify:

- durable Work state service/port from `packages/work-persistence/src/index.ts`
- durable ApplicationInstance state service/port from `packages/app-persistence/src/index.ts`

The execution lane re-authorizes consequential effects through `AccessContextResolverPort` rather than trusting a stale caller-supplied principal. The realtime lane validates session/workspace context on subscribe/resume and before durable mutation. Neither lane needs to change the session persistence implementation or the API access gate.

## Required future implementation workflow

For each coding ticket after its blockers close:

`ask-matt -> implement -> tdd -> verification -> code-review -> handoff`

Tests named in a ticket are falsifiers, not optional coverage suggestions. Verification evidence must record commands actually executed; no skipped PostgreSQL integration run may be represented as proof of server durability.
