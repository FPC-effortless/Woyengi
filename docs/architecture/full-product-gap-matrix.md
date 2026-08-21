# Full-product gap matrix

This matrix maps the 2026-08-21 Woyengi master brief to repository evidence. It groups related numbered sections while retaining their architectural obligations.

| Brief sections | Required outcome | Repository evidence | Gap disposition |
| --- | --- | --- | --- |
| 0, 118-125, 148-150 | Principal implementation system, contract-first lanes, gates, reporting | PRD/TDD workflow, package boundaries, production gates, integration branch, ADRs, status matrix | Wave coordination established; full ecosystem remains incremental |
| 1-6, 147 | One Woyengi product, one workspace model, shell, Work and software loops | Persistent-state Platform exists; Explorer/Admin only | Account/workspace, Work loop, Composer loop, and shell are WYG-002 through WYG-012 |
| 7-8, 146 | Four planes and small constitutional kernel | Strong semantic substrate and ADR 0001 | Composition, execution, and experience planes require new public contracts; do not split into premature services |
| 9-12, 127 | Reactive capability/provider runtime and disjoint effects | Modular runtime/worker only | WYG-005/006 add lifecycle, requirements, scopes, leases, disposal, provider replacement, no effect replay |
| 13, 88-101, 130-131 | Canonical governed execution, observation, reconciliation, evidence, verification, learning | Agent/procedure/evidence/verification packages are individually functional | WYG-005 creates one traceable spine; later Wave 2 adds Harness/applicability/learning |
| 14-22, 134 | Workspace/App intents, requirement graph, Composer, blueprint, collaboration contract | Semantic and state requirement compilers are reusable but not app composition | WYG-007, followed by Composer UX and conformance |
| 23-29, 133 | Application package/instance, portability, sharing, hierarchy, collections | Versioned Domain Packages only | WYG-008 introduces portable Apps; suites/industry solutions build over the same primitives later |
| 30-42, 126, 132 | Semantic history, objects, Work/Activity, multiplayer, conflicts | Bitemporal records/relations/history are functional; Work and multiplayer absent | Preserve semantic substrate; WYG-004/010 add durable work, participants, handoffs, presence, concurrency |
| 43-55, 128 | Principal kinds, capability grants, policy, approvals, budgets | Capability and authority evaluation functional at package level | WYG-002/003 establish principals/workspace isolation; WYG-005 integrates authorization and budgets; enterprise policy later |
| 56-66, 91, 129 | Skills, procedures, applicability, Harness, context, memory | Procedures and reconstructive workspace functional; search is provenance-rich | Wave 2 adds applicability, Harness, AgentKnowledgeWorkspace, scoped episode context, learning |
| 67-78, 135-140 | Capabilities, execution manifest/journal, compute/nodes, local/self-host | Worker, local storage, Compose topology, CLI are functional | WYG-005/006/009 establish contracts; personal SQLite/offline, two-client server, Docker/node providers follow |
| 79-87, 136 | Integrations, events, realtime, model/provider neutrality | Event bus, ingestion, Connector SDK, HTTP API exist | Add scoped provider gateway, WebSocket/SSE collaboration, BYOK/model providers, first connectors |
| 102-117 | Surface runtime, public surfaces, shell, Inspect, product/cloud planes, traceability | Explorer/Admin inspection apps exist | WYG-011 builds shell foundation; public/embedded surface runtime and Cloud remain later waves |
| 124 waves 3-5, 141 | Coding vertical, business/industry collections, managed/enterprise depth, Cloud | Three Domain Package examples only | Build only after shared Work/App/runtime substrate is conformant |
| 126-135 | Mandatory semantic/runtime/authority/applicability/effect/verification/multiplayer/App/Composer/local conformance | Existing state/adversarial conformance is green | New conformance suites are acceptance criteria of WYG-003 through WYG-012 |
| 137 | Phases 0-19 | Original persistent-state phases mostly functional | New executable tickets begin with phases 1, 3-5, 8-13 while retaining later phases as planned dependencies |
| 142-145 | Progressive disclosure, anti-pattern rejection, docs, full-power definition | Architecture avoids generic memory table, universal CRDT, and mandatory Cloud | Full-power claim is prohibited until every row in `docs/implementation-status.md` reaches at least conformant where required |

## Preserved implementations

- Immutable bitemporal canonical history and deterministic replay.
- Identity merge/split history, typed records, relations, artifacts, provenance, evidence, authority, permissions, verification, graph federation, and reconstruction.
- Durable local adapters, transactional events, ingestion, search orchestration, SDKs, API, CLI, synchronization, deletion/invalidation, observability, benchmarks, and modular-monolith operations.

## Contract hazards to repair

- The runnable API authorizer is a local unconditional callback rather than composed workspace membership and capability evaluation.
- The current control `verify` path records a hard-coded lifecycle transition rather than a reconciled, evidence-backed, independently verified outcome.
- The current `services/runtime` module composition is not the requested reactive capability/provider Composition Runtime.
- Existing “workspace” terminology in reconstruction means a reconstructed context bundle, not the constitutional Account/Workspace ownership boundary.
- Domain Packages must not be mislabeled as user-facing ApplicationPackages.
