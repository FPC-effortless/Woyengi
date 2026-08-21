# ADR 0001: Full-product boundaries

Status: Accepted for implementation

## Decision

Woyengi remains one product with one workspace model. The existing persistent-state implementation becomes the Semantic Plane foundation. New capabilities are added through four logical planes inside the modular monolith:

- Semantic Plane: identity, workspaces, objects, relations, history, work, authority, provenance, evidence, audit, and canonical commits.
- Composition Plane: capabilities, providers, components, requirements, scopes, lifecycle, configuration reconciliation, and runtime-effect leases.
- Execution Plane: workloads, nodes, sandboxes, models, browsers, jobs, connectors, and physical effect observation.
- Experience Plane: Home, Work, Apps, Inbox, Search, Composer, surfaces, collaboration, and public/embedded experiences.

Harness, context reconstruction, applicability, planning, authority, budgets, risk, verification, evals, and learning may coordinate across planes. Logical planes do not imply separate network services.

## Constitutional kernel

Identity meaning, workspace isolation, authority meaning, semantic-history rules, provenance, canonical commits, execution journals, audit invariants, evidence identity, and verification-result meaning cannot be replaced by packages or providers. Extension points may add policy, storage, execution, UI, and domain behavior without redefining those terms.

## Consequences

The current ledger, state, provenance, authority, permissions, evidence, and verification packages are preserved. Product-specific domain entities stay out of `packages/core`. New modules start as dependency-light packages in the modular monolith and must retain extractable public contracts.
