# Woyengi implementation status

Updated: 2026-08-21

Status vocabulary: `NOT_STARTED`, `DESIGNING`, `FOUNDATION`, `PARTIAL`, `FUNCTIONAL`, `CONFORMANT`, `PRODUCTION_READY`.

`FUNCTIONAL` means a tested public behavior exists. `CONFORMANT` additionally means the relevant full-product conformance cases pass across package boundaries. `PRODUCTION_READY` requires deployment-specific operational and human acceptance evidence. A type or interface alone is `FOUNDATION`, not complete.

| Subsystem | Status | Implemented evidence | Missing / limitation | Tests | Next dependency | Owner lane |
| --- | --- | --- | --- | --- | --- | --- |
| Constitutional state kernel | CONFORMANT | Immutable typed canonical records, bitemporal history, replay, conflict traces | Must add workspace ID to every new governed full-product boundary without introducing domain entities into core | `packages/core/test`, `packages/ledger/test`, `packages/state/test` | WYG-003 isolation | A/B |
| Account / Workspace / Organization | DESIGNING | ADR 0002 fixes the additive model | No Account, Personal Workspace, Organization, Membership, invite, or switch implementation | WYG-002/003 pending | WYG-002 | A |
| Principal identity | PARTIAL | Entity identity and capability principals exist independently | No constitutional human/agent/service/automation principal registry; deployed API still uses one bearer operator | `packages/identity/test`, `packages/permissions/test` | WYG-002 | A/D |
| Semantic objects / relations / artifacts | FUNCTIONAL | Generic claims, events, relationships, decisions, artifacts, graph registry, bindings, history, provenance | Object collaboration/version conflict semantics are not yet workspace-scoped end to end | `packages/core/test`, `packages/graph/test`, `packages/bindings/test` | WYG-003 | B |
| Provenance / evidence / verification | FUNCTIONAL | Provenance DAG, evidence support/contradiction, extensible verifiers, canonical verification decisions | Production control route does not compose observed effects, reconciliation, and independent verification | `packages/provenance/test`, `packages/evidence/test`, `packages/verification/test` | WYG-005 | D |
| Authority / capabilities / policy | FUNCTIONAL | Contextual authority and default-deny delegated capabilities | No workspace membership grants, approval chains, spend capability, or complete server-path enforcement | `packages/authority/test`, `packages/permissions/test`, API security tests | WYG-002/003/005 | D |
| WorkInstance / WorkEpisode / Activity ISA | NOT_STARTED | Existing canonical events and procedures can be reused | No durable work aggregate, episodes, queues, activity stream, assignment, handoff, takeover, or WorkFlowPath | WYG-004 pending | WYG-004 | C |
| Multiplayer / presence / realtime | NOT_STARTED | Durable event bus supports cursors and duplicate detection | No presence, two-client Work synchronization, optimistic collaboration contract, or websocket/SSE gateway | `packages/event-bus/test`; WYG-010 pending | WYG-004/010 | C/H/J |
| Governed execution spine | DESIGNING | Agent SDK records guarded proposals/actions; procedures and verification exist | No shared ActionIntent-to-Manifest-to-Journal-to-Reconciliation-to-Commit model; API success can bypass the intended spine | `packages/agent-sdk/test`, `packages/procedures/test`; WYG-005 pending | WYG-005 | D/F/G |
| Effect classification / reconciliation | DESIGNING | ADR 0003 fixes disjoint runtime, semantic, and external effects | No runtime-effect lease model, observed external effect, uncertain effect review, compensation, or reconciliation engine | WYG-005/006 pending | WYG-005 | D/F |
| Composition Runtime | DESIGNING | Modular service composition and retryable worker are functional; ADR 0004 fixes reactive semantics | Current runtime is module wiring, not capability/provider discovery, reactive dependency suspension, scopes, or effect disposal | `services/runtime/test`; WYG-006 pending | WYG-006 | F |
| Context reconstruction / search | FUNCTIONAL | Deterministic requirement planning and multimodal provenance-rich reconstruction | No AgentKnowledgeWorkspace lifecycle, bounded episode capability context, or authority-filtered memory write/retrieval loop | `packages/reconstruction/test`, `packages/search/test` | later Wave 2 | I |
| Harness / applicability / skills | PARTIAL | Procedures have guarded execution and candidate proposal | No candidate applicability engine, known-failure penalties, budgeted model/agent routing, or independent Harness | `packages/procedures/test`; Wave 2 pending | WYG-005/006 | F/I |
| Composer / IntentCompiler | DESIGNING | State-requirement planning and semantic compiler are reusable foundations; ADR 0005 fixes preference order | No WorkspaceIntent, AppIntent, SoftwareRequirementGraph, CompositionPlan, AppBlueprint, ambiguity model, preview, or install flow | WYG-007 pending | WYG-007 | E |
| Application packages / instances | NOT_STARTED | Domain Package SDK proves versioned kernel extension | DomainPackage is not ApplicationPackage; no workspace-bound App instance, overlay, app data sharing, export/import/update/rollback | WYG-008 pending | WYG-007/008 | E |
| Compute / nodes / sandboxes | NOT_STARTED | Retryable worker is an execution primitive | No WorkloadSpec, local shell/Docker provider, node registration, remote workload, model routing, or usage receipt | WYG-009 pending | WYG-005/006 | G |
| Integrations / provider gateway | PARTIAL | Connector SDK and typed ingestion envelope exist | No first provider implementations, scoped provider gateway, GitHub flow, MCP/REST binding, email/calendar connectors, or observed-effect reconciliation | `packages/connector-sdk/test`, `packages/ingestion/test` | WYG-005/006 | H |
| Unified Woyengi shell | NOT_STARTED | Explorer and admin diagnostics are functional inspection surfaces | No Home, Work, Apps, Inbox, Search, universal intent bar, Composer UX, or workspace switcher | WYG-011 pending | WYG-003/004/007 | J |
| Public / embedded surfaces | NOT_STARTED | HTTP API and local inspection UIs exist | No external participant contract, narrow public capability context, domain/TLS gateway, or embedded/OEM surface | later Wave 3 | WYG-008/010 | J/H |
| Measurement / evals / simulation | PARTIAL | Privacy-safe observability and 11 adversarial state benchmarks; fast production gate is green | No episode cost accounting, counterfactual replay, strategy comparison, failure injection, or package certification | `packages/observability/test`, `benchmarks/adversarial/test` | later Wave 2 | K |
| Local / self-host | FUNCTIONAL | Local durable adapters, CLI backup/restore/replay, Docker Compose API/worker/Postgres/MinIO/Meilisearch | Personal SQLite mode, offline `woyengi start`, two-client `woyengi serve`, real Postgres adapters, and remote compute node are absent; Node runtime is below declared minimum | deploy and CLI tests, fast production gate | WYG-012 and later | G/H |
| Security / enterprise controls | PARTIAL | Threat model, bearer hardening, redaction, rate limits, default-deny capability tests | Single-operator deployment only; no SSO, SCIM, advanced ABAC, residency, retention exports, BYOC, or air-gap certification | security production gate, permissions tests | later Wave 5 | A/D/Ops |
| Reference Apps / verticals | FOUNDATION | Personal-memory, regulatory-state, and hotel-state examples prove Domain Package extension | These are package examples, not composed Apps with Work, collaboration, surfaces, agents, and installable instances | `examples/domain-packages.test.ts` | WYG-007/008 then Wave 3/4 | L |
| Woyengi Cloud | NOT_STARTED | Core architecture keeps Cloud optional | No environments, releases, fleets, desired/reported state, deployment plans, metering, billing, backups, upgrades, domains, or managed public surfaces | none | later Wave 5 | Cloud/Ops |
| SDK / API / CLI | FUNCTIONAL | Authenticated state API, TypeScript/Python SDKs, operator CLI, Domain/Agent/Connector SDKs | Contracts expose the persistent-state platform, not yet Accounts, Work, Apps, Composer, runtime, compute, or realtime | API/SDK/CLI tests | WYG-002 onward | Cross-plane |

## Current verified gates

- `pnpm test:all`: 43 TypeScript tests and 1 Python test pass.
- `pnpm typecheck`: passes.
- `pnpm boundaries`: package graph and deep-module gates pass.
- `pnpm prod:check:fast`: `GO` across requirements, architecture, deep-module, and security gates.
- Environment warning: installed Node `24.6.0`; repository contract requires `>=24.12.0`.

## Immediate full-product slice

The first integrated slice is: create one Account, its Personal Workspace, one Organization Workspace and memberships; create and share one durable WorkInstance with a human and separately granted AgentPrincipal; execute one consequential episode through manifest, observed effect, reconciliation, evidence, verification, accepted outcome, and verified Semantic Commit; install one App package without sharing data or authority; expose the result through the unified shell and local server.
