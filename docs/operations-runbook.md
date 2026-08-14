# Woyengi Platform operations runbook

## Supported local deployment

The supported local topology is the Compose stack in `deploy/docker/compose.yaml`: Platform API, Platform Worker, PostgreSQL 18, MinIO object storage, and Meilisearch. Container tags are pinned and the application image runs as the unprivileged `woyengi` user. Docker Desktop or Docker Engine with Compose v2 is required.

Set the five variables listed in `.env.example` through your shell or secret manager. Use unique random values; the API token and object-store secret must be at least 16 characters. The repository contains no working credentials and startup fails when a required variable is absent.

```powershell
docker compose -f deploy/docker/compose.yaml config
docker compose -f deploy/docker/compose.yaml up --build --wait
Invoke-RestMethod http://127.0.0.1:8080/healthz
Invoke-RestMethod http://127.0.0.1:8080/readyz
```

## Health and shutdown

`/healthz` proves the API process can serve traffic. `/readyz` proves required runtime checks are available. Compose waits for PostgreSQL, object storage, and search before starting API and worker health supervision. `docker compose ... stop` sends SIGTERM; API stops accepting new connections before exit and the worker stops polling before exit.

## Migration, backup, restore, and replay

Stop writes or take a consistent storage snapshot before backup. The workspace CLI refuses non-empty restore targets and verifies every entry hash.

```powershell
pnpm woyengi migrate --workspace C:\woyengi\workspace --to 2
pnpm woyengi backup --workspace C:\woyengi\workspace --output C:\backups\workspace.woyengi-backup.json
pnpm woyengi integrity --archive C:\backups\workspace.woyengi-backup.json
pnpm woyengi restore --archive C:\backups\workspace.woyengi-backup.json --workspace C:\woyengi\restored
pnpm woyengi replay --workspace C:\woyengi\restored --until 2026-08-13T00:00:00Z --output C:\woyengi\replay.json
```

## Incident and rollback

1. Revoke the exposed capability or rotate the affected secret first.
2. Preserve API, worker, audit, and reconstruction trace IDs; do not copy sensitive payloads into tickets.
3. Stop API and worker while leaving durable volumes intact.
4. Roll the application image back to the previously recorded digest. Never downgrade a workspace schema in place.
5. Restore into a new empty workspace, run `integrity`, then replay to the incident boundary.
6. Validate `/readyz`, permission-leakage benchmarks, and a representative reconstruction before reopening traffic.

PostgreSQL major upgrades require a documented `pg_upgrade`/dump-and-restore procedure; PostgreSQL 18 persists at `/var/lib/postgresql` as required by the official image. MinIO community container deployment is intended here for local development/evaluation; choose a supported managed object store or supported MinIO deployment for production.
