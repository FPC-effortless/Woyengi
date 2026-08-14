# Woyengi Platform release-candidate QA

This checklist is the human acceptance gate for PLAT-040. Automated success does not substitute for the acknowledgement at the end.

## Candidate scope

The candidate includes the domain-neutral kernel, historical ledgers and projections, identity, provenance, evidence, authority, permissions, verification, graphs/bindings, procedures, ingestion and semantic compilation, reconstruction, SDKs, local/hybrid storage policies, synchronization, eventing, API/worker runtime, CLI, Explorer, admin diagnostics, observability, benchmarks, and the local Compose topology.

It does not include Woyengi Memory, Software, Regulation, Audience, Hospitality, or Forge domain models. Those remain product-owned Domain Packages.

## Automated evidence

From a clean checkout, run:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm boundaries
pnpm test:all
pnpm benchmark
pnpm prod:release --run-id final-release
```

Expected: every command exits zero and the final decision is `GO`. The release gate must fail closed if a prerequisite ticket, security check, browser evidence item, benchmark threshold, or architectural invariant is missing.

## Human scenarios

### Historical state and explanation

- Ingest two temporally overlapping claims from different authorities.
- Confirm the projected value is selected by temporal/lifecycle/authority rules rather than confidence alone.
- Confirm the losing claim remains visible as a conflict.
- Confirm the reconstruction trace identifies filtering, selection, evidence, and provenance steps without leaking denied record identifiers.

### Identity and deletion

- Create two identities, merge them, inspect the merge history, then split them.
- Invalidate or delete a source and confirm dependent claims, projections, and reconstructions become unsupported or invalidated according to policy.
- Confirm canonical history remains append-oriented throughout.

### Permissions and agents

- Confirm an authorized principal can reconstruct permitted records.
- Confirm an unauthorized record is filtered before workspace assembly and cannot be inferred from the trace.
- Confirm read access does not grant write or execute access.
- Confirm an agent write enters as a validated proposal/provisional record rather than silently replacing governing state.

### Operations

- Start the Compose stack and verify API, worker, PostgreSQL, object storage, and search are healthy.
- Perform authenticated ingest → durable state query → reconstruction.
- Stop and restart the stack and confirm durable state remains available.
- Exercise migration, backup, integrity verification, restore into an empty workspace, and deterministic replay.
- Send SIGTERM/stop and confirm the API and worker shut down cleanly.

### Explorer and diagnostics

- Inspect an entity across claims, events, relationships, history, evidence, provenance, authority, lifecycle, conflicts, graph neighborhood, and reconstruction trace.
- Repeat at desktop and mobile widths in light and dark modes.
- Confirm no horizontal overflow, broken controls, console errors, secret-bearing diagnostics, or unauthorized admin access.

## Release limitations to acknowledge

- The supported deployment is private/local, single-operator, and loopback-bound. Internet-facing or multi-tenant use requires deployment-specific identity, capability issuance, TLS/edge controls, storage encryption, tenant isolation, and a fresh threat-model review.
- PostgreSQL, MinIO, and Meilisearch are composed as operational dependencies; the reference vertical slice keeps its canonical local ledger behind storage ports. Managed adapters and production object/search integrations require deployment-specific validation.
- Image tags are pinned to versions but not immutable registry digests.
- MinIO in this Compose file is for local evaluation; production operators must choose a supported object-store deployment.
- Adversarial benchmarks run an independent reference evaluator over temporal, identity, authority, evidence, lifecycle, agent-origin, permission, chronology, and provenance-invalidity signals. Deployment-specific accuracy baselines must still be measured against installed Domain Packages and real data distributions.

## Human acknowledgement

Reply with the exact sentence below only after the automated and human scenarios are acceptable:

`I acknowledge the Woyengi Platform release candidate.`

Until that acknowledgement and a successful Compose exercise are recorded, PLAT-040 remains open and the platform is **NO-GO for release**.
