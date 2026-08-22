# ADR 0006: Atomic ingestion and causal ledger order

Status: Accepted  
Date: 2026-08-22

## Context

The deployed HTTP ingestion path accepted arbitrary client JSON, wrote a record before its event, and persisted the idempotency result in a separate file. Replay sorted equal-time records by identifier, which can place a child before its parent and loses append causality after restart.

## Decision

- Public canonical ingestion requires an explicit `workspaceId` and a non-empty `records` array.
- Supported public record kinds are rebuilt through constitutional constructors before any durable mutation. Unsupported kinds and invalid kind-specific fields fail with HTTP 400.
- One local durable batch contains the rebuilt records, generated platform events, and the idempotency-result record. One atomic file replacement publishes the whole batch.
- Durable storage, not clients, assigns an immutable positive `ledgerSequence` per workspace. Legacy arrays are deterministically backfilled in their persisted order when opened and are rewritten with sequence metadata on the next append.
- Transaction time remains the bitemporal eligibility/cutoff dimension. Ledger sequence governs replay, pagination, and delivery order only.
- Workspace and Work operation journals carry immutable causal sequence. Work episode and activity-stream sequence numbers remain distinct domain ordinals.
- State and subscription cursors mean "strictly after ledger sequence". Event identifiers remain identities, not order.

## Consequences

- Repeating an accepted request after restart returns the atomic ledger receipt without replaying effects.
- Equal-time parent/child records and operations replay in append order.
- Older clients that send a bare canonical record must adopt the workspace-scoped ingestion envelope.
- The JSON adapter is single-process/single-writer. Multi-process server deployments still require a database transaction or file-locking provider.
- Historical append order that an older adapter already replaced with timestamp/ID order cannot be recovered; deterministic backfill preserves the stored order only.
