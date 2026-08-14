# Woyengi Platform

Woyengi Platform is a domain-neutral persistent-state substrate for humans, organizations, applications, and AI agents. It preserves typed history, reconstructs task-specific state under identity, temporal, provenance, evidence, authority, lifecycle, and permission constraints, and exposes that state through APIs and SDKs.

Its central abstraction is **persistent reconstructable state**. Documents, generated text, graph edges, embeddings, indexes, and model inferences are never treated as authoritative state by themselves.

## What is implemented

- append-only canonical records, bitemporal state projection, conflicts, lifecycle, deterministic replay, and reversible identity merge/split;
- provenance DAGs, evidence, authority, verification, capability permissions, deletion propagation, procedures, graph federation, and cross-graph bindings;
- ingestion, semantic compilation, multimodal retrieval orchestration, state-requirement planning, structured reconstruction workspaces, and guarded agent actions;
- local storage, storage policies, synchronization, event delivery, TypeScript/Python SDKs, HTTP API, CLI, Explorer, admin diagnostics, traces, metrics, and adversarial benchmarks;
- a modular API/worker runtime plus a local Compose topology for PostgreSQL, object storage, and search dependencies.

Product concepts such as rooms, licences, requirements, projects, or audiences belong in independently versioned Domain Packages. They do not enter the platform kernel.

## Requirements

- Node.js 24.12 or newer
- pnpm 11
- Docker Engine or Docker Desktop with Compose v2 for the containerized local topology

## Verify the repository

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm boundaries
pnpm test:all
pnpm benchmark
pnpm prod:check
```

`pnpm prod:release` is the fail-closed release gate. It is expected to remain blocked until all prerequisite tickets and human QA are complete.

## Run the local API without containers

Set a private token of at least 16 characters and choose a durable data directory:

```powershell
$env:WOYENGI_API_TOKEN = Read-Host 'Private API token (16+ characters)'
$env:WOYENGI_DATA_DIR = 'C:\woyengi\data'
node services/platform-api/src/main.ts
```

The API listens on `127.0.0.1:8080` by default. Use `Authorization: Bearer <token>` for state operations. Health routes are `/healthz` and `/readyz`.

## Run the local Compose topology

Copy the variable names from `.env.example` into your shell or secret manager and supply unique values. No working credentials ship in the repository.

```powershell
docker compose -f deploy/docker/compose.yaml config
docker compose -f deploy/docker/compose.yaml up --build --wait
Invoke-RestMethod http://127.0.0.1:8080/readyz
```

The stack starts the Platform API, Platform Worker, PostgreSQL, MinIO, and Meilisearch. See [the operations runbook](docs/operations-runbook.md) before using backup, restore, migration, replay, rollback, or incident procedures.

## Inspect state

```powershell
pnpm explorer
pnpm woyengi inspect --workspace C:\woyengi\workspace --view claims
pnpm woyengi replay --workspace C:\woyengi\workspace --until 2026-08-13T00:00:00Z --output C:\woyengi\replay.json
```

Explorer provides entity, claim, event, relationship, state-history, evidence, provenance, authority, lifecycle, conflict, graph-neighborhood, and reconstruction-trace views.

## Repository map

| Path | Purpose |
| --- | --- |
| `packages/` | Domain-neutral state, control, reconstruction, storage, and SDK modules |
| `services/` | Modular-monolith API and worker composition roots |
| `apps/` | Explorer and admin diagnostics |
| `deploy/` | Local container topology and deployment tests |
| `benchmarks/` | Adversarial state/reconstruction evaluation |
| `production/` | Fail-closed readiness gates and evidence contracts |
| `docs/` | Architecture, operations, release, and SDK versioning |

## Governing documents

- `CONSTITUTION.md` defines non-negotiable architecture invariants.
- `docs/architecture.md` describes the full logical architecture and Platform/Compute boundary.
- `prd.json` is the ordered delivery contract.
- `QA.md` is the final human release-candidate checklist.
- `docs/release.md` states supported deployment, limitations, rollback, and incident procedures.
