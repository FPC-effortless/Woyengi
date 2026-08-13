# Foundation Milestone QA Handoff

## Scope

This checklist covers PLAT-001 through PLAT-004: repository bootstrap, canonical records, append-only claim history, bitemporal projection, authority ranking, conflict retention, lifecycle transitions, and projection traces.

PLAT-005 and later tickets remain backlog.

## Human scenarios

### 1. Canonical records

- Inspect `packages/core/src/index.ts` and confirm there are no product-domain entities or predicates.
- Confirm Claim keeps `validTime` and `transactionTime` separate.
- Confirm `authority` and `confidence` are separate fields.
- Confirm Observation, Claim, Evidence, Provenance, Authority, and Lifecycle are explicit types.

### 2. Bitemporal knowledge

- Run the test suite.
- Confirm the February 5 query, when limited to records known on February 5, selects Daniel.
- Confirm the same valid-time query, using records known on February 15, selects Priya.

### 3. Authority and conflict

- Confirm Priya's authority level 80 beats Daniel's level 30 even though Priya's confidence is lower.
- Confirm Daniel remains in `conflicts` instead of being deleted or hidden.
- Confirm the trace lists candidate discovery, transaction-time filtering, valid-time filtering, lifecycle filtering, and selection.

### 4. Lifecycle history

- Confirm retracting Priya is an appended `LifecycleTransitionRecord`.
- Confirm Daniel governs after Priya's retraction.
- Confirm superseding Daniel later produces no governing selection for the queried state.
- Confirm both original claims remain returned by ledger history.

## Automated commands

```powershell
pnpm test
pnpm test:coverage
git status --short
```

Expected: 4 tests pass. Current coverage baseline is 88.59% lines, 70.33% branches, and 90.70% functions.

## Known limitations

- Storage is in-memory; durable ledger ports and deterministic replay are PLAT-005.
- Runtime TypeScript execution does not type-check; a compiler gate is still required before package publication.
- Numeric authority ranking is a kernel mechanism, not a finished organization/domain authority policy.
- Permissions, evidence verification, identity merge/split, reconstruction workspaces, event delivery, and APIs are not implemented yet.
- No production deployment, migration, retention, deletion propagation, synchronization, or backup path exists yet.

## Bug report and restart protocol

Record the exact command, Node/pnpm versions, failing test name, expected state, actual state, and the smallest relevant ledger record sequence. Do not rewrite history to repair a failure. Add a failing regression test, append the diagnosis to `progress.txt`, and resume at the earliest failing PRD ticket.

## Human acknowledgement

The foundation milestone remains awaiting human QA acknowledgement before it is treated as accepted for the next milestone.
