# Woyengi Platform Architecture

## Definition

Woyengi Platform is a persistent-state infrastructure layer for humans, organizations, applications, and AI agents. It ingests observations, maintains typed historical state with identity, time, provenance, authority, and evidence, reconstructs task-specific state on demand, controls access and modification, and provides verified state to applications and agents.

The central abstraction is **persistent reconstructable state**. RGM/REGM is an architectural mechanism for implementing that abstraction, not the platform boundary itself.

## System flow

```text
Documents · Events · Apps · APIs · Agents · Human Actions
                              │
                              ▼
                      Ingestion Fabric
                              │
                              ▼
                     Semantic Compiler
                              │
                              ▼
                  Persistent State Fabric
                              │
                              ▼
                        State Engine
                              │
                              ▼
                  Reconstruction Engine
                              │
                              ▼
               Verification + Authority Layer
                              │
                              ▼
                  Application / Agent API
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
          Products          Agents        Integrations
```

## Canonical state model

The persistent model is the composition:

```text
M = (I, O, C, E, R, P, V, A, L, G, B, D)
```

| Symbol | Fabric |
| --- | --- |
| I | Identity registry |
| O | Observations |
| C | Claims |
| E | Events |
| R | Relationships |
| P | Provenance |
| V | Evidence and verification |
| A | Authority and permissions |
| L | Lifecycle |
| G | Domain graph federation |
| B | Cross-graph bindings |
| D | Residual detail and original artifacts |

No member alone is “the facts database.” State is projected from their interaction under a query context.

## Non-negotiable separations

- Observations preserve what arrived; claims express propositions; state is a contextual projection.
- Valid time records when a proposition held in the world; transaction time records when Woyengi knew it.
- Canonical records are append-oriented; mutable projections are disposable.
- Confidence estimates likelihood; authority determines whether a claim may govern a context.
- Evidence supports or contradicts; provenance explains derivation.
- Agents may propose writes independently of their read capabilities.
- Documents, graphs, embeddings, and caches are inputs or indexes, never state by themselves.
- Platform defines extension protocols; products own domain entities and predicates.

## Graph federation

The platform maintains a graph registry rather than a single universal graph. Entity, episode, temporal, evidence, decision, procedure, and product-owned domain graphs define their own node/edge types, invariants, temporal behavior, retention, permissions, and verification. A binding graph connects shared identities and cross-graph causal or dependency relationships without duplicating every object.

Canonical graph-affecting operations are ledger records. Materialized graph stores must be rebuildable.

## Projection and reconstruction

State projection computes the best-supported state for an entity, time, and context:

```text
S(entity, valid_time, transaction_time, context)
```

Projection retains candidates and conflicts, applies lifecycle and temporal constraints, and ranks verified authority separately from confidence.

Reconstruction is a planner:

```text
Request
  -> intent and subjects
  -> required state and constraints
  -> graph/index activation
  -> temporal and authority filtering
  -> evidence evaluation
  -> structured reconstructive workspace + trace
```

The workspace is structured data first. Rendered LLM context is one consumer, not the only output.

## Extension boundary

A versioned Domain Package may contribute:

- entity, claim, event, and relationship types;
- graph definitions and invariants;
- lifecycle and authority policies;
- reducers, verifiers, and reconstruction policies;
- permissions, procedures, and connectors.

Memory, Software, Regulation, Audience, Hospitality, and Forge packages live with their products. The kernel contains none of their domain models.

## Deployment evolution

The initial deployment is a modular monolith:

```text
Platform API + Platform Worker + Database + Object Storage + Search
```

Internal package boundaries preserve later extraction of ingestion, identity, state, reconstruction, verification, policy, synchronization, and event-gateway services. Extraction is driven by operational evidence, not by the logical architecture diagram alone.

## Platform / Compute boundary

Platform answers what state exists, what happened, what is authoritative, what is relevant, and what a principal may access or change.

Woyengi Compute answers which model or execution path to use, how much compute to spend, which cache applies, and whether execution should be verified or escalated.

```text
Request -> Platform reconstructs state -> Compute executes intelligence
        -> Platform verifies and records proposed state change
```

## Delivery order

1. Foundation: identity, canonical schemas, immutable ledger, bitemporal model, provenance, lifecycle.
2. State: claims, events, relationships, graph federation, bindings, projections, conflicts.
3. Intelligence: semantic compilation, entity resolution, reconstruction planning, multimodal retrieval, evidence evaluation.
4. Control: authority, capabilities, verification, agent guards, audit.
5. Learning: procedures, replay, repair, consolidation.
6. Distribution: local-first storage, synchronization, cloud/hybrid policy, SDKs.
7. Operations: Explorer, traces, metrics, adversarial benchmarks, backups, migrations, managed deployment.

The order stabilizes semantics; it does not reduce the target architecture.
