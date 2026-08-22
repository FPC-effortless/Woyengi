# Woyengi Platform Research

## Decision summary

Start with a dependency-light TypeScript pnpm monorepo targeting Node.js 24.12 or newer. Run source and tests directly with Node's stable TypeScript type stripping, use explicit `.ts` ESM imports, and keep every platform port storage-agnostic. Introduce TypeScript project references and compiled package artifacts when a second independently published package requires them.

## Official sources reviewed

### Node.js TypeScript support

- Source: https://nodejs.org/api/typescript.html
- Node 24.12 made type stripping stable.
- Native execution supports erasable TypeScript syntax and ignores `tsconfig.json` at runtime.
- ESM imports require explicit file extensions and type-only imports must use `import type`.
- Node does not execute TypeScript found under `node_modules`; published packages will therefore need compiled JavaScript later.

### Node.js test runner

- Source: https://nodejs.org/download/release/v24.15.0/docs/api/test.html
- `node --test` discovers `.test.ts` files when type stripping is enabled.
- Test files run in isolated child processes by default.
- Decision: use `node:test` for the kernel to avoid coupling state semantics to a test framework.

### pnpm workspaces

- Source: https://pnpm.io/workspaces
- A workspace is declared by `pnpm-workspace.yaml`.
- The `workspace:` protocol guarantees that internal dependencies resolve locally.
- Cyclic workspace dependencies can break topological script ordering.
- Decision: disallow package cycles and use explicit dependency direction.

### TypeScript project references

- Source: https://www.typescriptlang.org/docs/handbook/project-references.html
- Project references enforce logical package boundaries and speed incremental builds.
- Referenced projects require `composite` and declarations, and build mode orders dependencies.
- Decision: defer references until compiled package output is introduced; do not create empty package scaffolds merely to mirror the eventual logical architecture.

## Constraints and edge cases

- Node's runtime strips types but does not type-check them. A compiler-based `typecheck` gate is a follow-on bootstrap ticket.
- Native type stripping excludes syntax requiring JavaScript generation. Avoid enums, namespaces, parameter properties, and path aliases in executable source.
- All canonical timestamps must be normalized ISO-8601 instants. Domain packages may later add uncertain or interval-valued temporal interpretation without weakening the kernel contract.
- In-memory repositories are test adapters only. Canonical interfaces must not assume Postgres, a graph database, an object store, or a vector index.
- Embeddings and materialized graphs are rebuildable indexes, never canonical history.

## Deferred research

- PostgreSQL bitemporal/event-ledger schema and migration strategy.
- Durable event delivery and outbox semantics.
- Local/cloud synchronization and object-specific merge policies.
- Cryptographic deletion, retention, and jurisdictional storage requirements.
- Search, graph, and vector index implementations.

## PostgreSQL self-hosted composition (2026-08-22)

### Official sources reviewed

- node-postgres transactions: https://node-postgres.com/features/transactions
- node-postgres parameterized queries: https://node-postgres.com/features/queries
- node-postgres pooling and shutdown: https://node-postgres.com/features/pooling
- node-postgres connection configuration: https://node-postgres.com/features/connecting
- PostgreSQL transaction isolation: https://www.postgresql.org/docs/current/transaction-iso.html
- PostgreSQL JSON types: https://www.postgresql.org/docs/current/datatype-json.html

### Decision

- Use the pure-JavaScript `pg` driver with one bounded application pool and `WOYENGI_POSTGRES_URL`; keep credentials external to packages and deployment images.
- Execute every multi-record canonical commit on one checked-out client with explicit `BEGIN`, `COMMIT`, `ROLLBACK`, and guaranteed client release. Never use `pool.query` for a transaction.
- Store immutable payloads as `jsonb`, while keeping workspace ID, record ID, kind, causal sequence, transaction time, and idempotency fingerprint/result in indexed relational columns.
- Serialize each workspace append by locking its sequence row inside the transaction. Do not use a PostgreSQL sequence for causal ledger ordering because sequence increments are not rolled back with failed transactions.
- Use parameterized values exclusively. Table and column names remain static migration-owned identifiers.
- Keep the current JSON adapter only for explicit offline personal mode. Team/server mode must fail startup when the configured PostgreSQL store cannot migrate or become ready.

### Failure modes and edge cases

- Network loss or server failure during a transaction must roll back and must never return an accepted idempotency result.
- Duplicate record IDs, idempotency-key fingerprint conflicts, and non-contiguous per-workspace sequences must fail the whole transaction.
- Concurrent appends in one workspace must receive unique increasing causal sequences; independent workspaces may proceed concurrently.
- Pool clients must always be released, and process shutdown must drain the pool.
- Serializable transactions can fail and require whole-transaction retry; the initial adapter instead uses a locked per-workspace sequence row plus uniqueness constraints so retries stay bounded and explicit.
