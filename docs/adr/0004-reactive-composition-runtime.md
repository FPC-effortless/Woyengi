# ADR 0004: Reactive Composition Runtime

Status: Accepted for implementation

## Decision

Woyengi implements a provider-neutral Composition Runtime with Cordis-inspired reactive dependency semantics but no constitutional dependency on Cordis.

A runtime component declares identity, interface, provider, requirements, effects, lifecycle, scope, authority, provenance, version, and observability. Lifecycle states are `PENDING`, `LOADING`, `ACTIVE`, `SUSPENDED`, `DEGRADED`, `UNLOADING`, `DISPOSED`, and `FAILED`.

Missing requirements keep a component `PENDING`; null and stale provider injection are forbidden. Provider loss suspends or unloads dependents, disposes their owned runtime effects, and records the transition reason. A compatible returning provider is re-evaluated for applicability, authority, policy, and state reconciliation before activation.

Runtime scopes form explicit capability contexts. Providers and effect leases cannot escape their declared workspace, episode, component, or request scope.
