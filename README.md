# Woyengi Platform

Woyengi Platform is a persistent-state infrastructure layer for humans, organizations, applications, and AI agents. It ingests observations, preserves typed historical records, reconstructs task-specific state, controls access and modification, and exposes verified state to applications and agents.

Its central abstraction is **persistent reconstructable state**.

## Architecture

```text
Ingestion -> Semantic compilation -> Persistent state fabric
          -> State projection -> Reconstruction -> Verification/control
          -> Application and agent APIs
```

The repository starts as a modular monolith. Package boundaries preserve the eventual service architecture without introducing distributed-system failure modes before the state semantics are proven.

## Current vertical slice

The first executable slice proves the hardest foundation:

```text
Observation -> Claim + Evidence -> Append-only ledger
            -> Bitemporal projection -> Selected state + conflicts + trace
```

## Commands

```powershell
pnpm test
```

Node.js 24.12 or newer is required while TypeScript source is executed with native type stripping.

## Governing documents

- `CONSTITUTION.md` defines non-negotiable architecture invariants.
- `docs/architecture.md` preserves the full target system and delivery order.
- `prd.json` is the ordered executable contract.
- `research.md` records external constraints and decisions.
- `progress.txt` is the append-only delivery log.
- `QA.md` defines the current milestone's human acceptance checks.
