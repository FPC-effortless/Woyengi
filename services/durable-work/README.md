# Durable Work journal (WYG-019 incremental slice)

This service composes the existing `WorkRegistry`, `WorkspaceRegistry` and `LocalCanonicalLedger` into an offline/self-hosted **single-process** Work persistence seam.

## Contract

- `DurableWorkJournal.open({ ledgerPath, workspaces })` takes an **already reconstructed** authoritative `WorkspaceRegistry`. The caller must replay its canonical workspace operations; the journal does not invent accounts, principals, memberships, or credentials.
- `createWorkInstance` and `startEpisode` accept typed Work operations and append exactly one durable operation before exposing the result. Failed validation/version checks leave the journal unchanged.
- `workInstance` and `history` require current workspace membership **and** Work participation. Initial Work creation accepts human participants with valid workspace memberships only. Other principal kinds fail closed pending explicit delegated-capability integration.
- Each Work record receives a storage-assigned causal `ledgerSequence`. Projected Work is reconstructed via `WorkRegistry.replay`, including after process restart and when event timestamps and lexical IDs are tied.
- The journal uses an exclusive local `.writer.lock` file. A second writer refuses to start, including in another process. Shutdown through `close()` releases the lock. If a process crashes and leaves a stale lock, operators must establish the first process is stopped before manually clearing the lock. Never delete a live writer lock.
- Stored operations are not mutable snapshots. The file is written through the existing atomic-rename ledger adapter.

## Boundaries and limitations

This is a development stepping stone, **not a production server**. No HTTP endpoints, multi-host writer coordination, PostgreSQL transaction provider, user sessions, trusted agent delegation, executable sandbox, or durable governed effects are supplied by this slice. Do not place the journal directly on a network-accessible API without real per-principal session and capability enforcement. Local JSON is not a substitute for the production Postgres-compatible adapter required for WYG-019.

The `WorkspaceRegistry` supplied to the journal is itself caller-managed; it must be reconstructed from trusted workspace operation history before opening the Work journal. Local storage corruption produces an error rather than silently resetting history. This layer is intentionally a persistence adapter, not a second authority or truth model.

## Verify

```shell
pnpm typecheck
pnpm boundaries
node --test services/durable-work/test/journal.test.ts
pnpm test:all
pnpm benchmark
```

Full WYG-019 acceptance, self-hosted multiplayer transport, agent capability grants, service/API composition, human QA and release gates remain open.
