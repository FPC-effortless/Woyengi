# SDK versioning and compatibility

The Domain, Agent, and Connector SDK contracts follow semantic versioning independently from product-domain packages.

- Platform API compatibility is an explicit half-open range: `minInclusive <= version < maxExclusive`.
- Additive changes use minor versions. Breaking contract changes require a major version.
- Deprecated connectors must identify a replacement or migration target.
- Idempotency keys belong to the external record identity, not a poll attempt. Retries must reuse them.
- SDK packages expose public data contracts and ports only. Service implementations, databases, workers, and transport internals are not part of the SDK surface.
- TypeScript source is currently consumed inside this workspace. Compiled publish artifacts are gated by PLAT-009 and must be present before external registry publication.
