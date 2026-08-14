# Woyengi Platform release guide

## Supported deployment

The supported v1 reference deployment is a private, local, single-operator modular monolith. The API binds to loopback and uses a required bearer credential. Docker Compose starts the API, worker, PostgreSQL, MinIO, and Meilisearch. Canonical history remains behind storage interfaces and disposable indexes are never the only copy of state.

This repository does not certify an internet-facing, multi-tenant, or regulated-data deployment. Such deployments must add an external identity provider, per-principal capability issuance, tenant isolation, TLS and edge protections, managed encrypted persistence, immutable image digests, key rotation, centralized audit retention, and a deployment-specific threat model.

## Release procedure

1. Use a clean checkout of the candidate commit.
2. Install with `pnpm install --frozen-lockfile`.
3. Run `pnpm prod:release --run-id <candidate-id>`.
4. Start the Compose topology with externally supplied secrets and run the operations scenarios in `QA.md`.
5. Record the image identifiers, schema version, backup integrity result, candidate commit, and gate artifact.
6. Obtain the exact human QA acknowledgement required by `QA.md`.
7. Mark PLAT-038, PLAT-039, and PLAT-040 complete only when their evidence is present.

## Known limitations

- The reference runtime demonstrates durable canonical local storage; the composed PostgreSQL, object storage, and search services establish the operational topology but require production adapters and environment-specific performance validation before managed deployment.
- The local bearer token represents one operator. It is not a substitute for multi-user identity and capability provisioning.
- Local storage encryption at rest is delegated to the host/deployment.
- Container versions are pinned by tag, not registry digest.
- Synchronization policies exist at the platform layer; a production cloud transport and tenant control plane are outside this repository's supported v1 profile.
- Domain-specific correctness, retention, verification, and benchmark thresholds belong to installed Domain Packages.

## Rollback

1. Stop ingress, API writes, and worker consumption while preserving volumes.
2. Capture the current schema version, last canonical record ID, event cursor, audit correlation IDs, and a verified backup.
3. Restore the previous application image by its recorded immutable identifier. Never downgrade a workspace schema in place.
4. If data restoration is required, restore into a new empty workspace, run `woyengi integrity`, and replay to the chosen transaction-time boundary.
5. Run readiness, permission-leakage benchmarks, and representative state/reconstruction checks before reopening traffic.

## Incident response

1. Contain: revoke capabilities or rotate affected credentials and stop the relevant write/execution path.
2. Preserve: retain canonical ledgers, audit events, reconstruction trace IDs, event cursors, and deployment metadata without copying secrets into tickets.
3. Assess: use provenance traversal to find dependent claims, projections, reconstructions, and consumers.
4. Correct: append retraction, invalidation, supersession, or repair records; do not rewrite canonical history.
5. Recover: restore into an empty target when necessary, verify hashes, replay deterministically, and rebuild indexes/projections.
6. Validate: rerun security, benchmark, readiness, and affected-domain verification gates before service restoration.
7. Review: document root cause, affected time range, authority/permission impact, and preventive controls.
