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
