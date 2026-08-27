# ADR 0007: OperationalSystemSpec is canonical above software projections

Status: Accepted for implementation
Date: 2026-08-27

## Context

ADR 0005 established `AppIntent -> SoftwareRequirementGraph -> CompositionPlan -> AppBlueprint` as the initial intent-to-software path. That path proved the Composer architecture but leaves operational meaning coupled to an App-centric compiled object. Woyengi now needs one persistent operational definition that can produce Apps, Work configuration, agent/tool surfaces, APIs, and evaluation worlds without treating any one projection as canonical.

## Decision

Introduce a versioned `OperationalSystemSpec` as the canonical persistent operational definition above projection-specific software artifacts.

The compilation path becomes:

```text
persistent reconstructed state + intent
-> ComprehensionModel
-> OperationalSystemSpec
-> Operational IR
-> capability/procedure/binding composition
-> projection compilation
   -> AppBlueprint
   -> Work configuration
   -> agent/tool projection
   -> portable WorldBundle
```

`AppBlueprint` remains a portable application-definition contract, but becomes an explicit projection whose provenance includes its source `OperationalSystemSpec` and relevant IR/composition references.

The `OperationalSystemSpec` contains provider-neutral operational meaning: goals, requirements, invariants, actors/roles, capabilities, authority requirements, procedures, OutcomeContracts, epistemic unknown/conflict state, external-system binding requirements, resources, attention/trigger rules, lifecycle, and projection requirements.

A `ComprehensionModel` is an intermediate evidence-bearing interpretation and does not become authoritative solely because a model generated it. Operational IR and projections are rebuildable products of the source spec and compiler version.

## Compatibility with ADR 0005

ADR 0005 remains valid for App portability, workspace-bound ApplicationInstances, shared semantic objects, overlays, credential separation, and composition preference ordering. Its direct `AppIntent -> ... -> AppBlueprint` compilation statement is amended by this ADR: legacy App intent is now one input into comprehension and operational specification rather than the canonical top-level object.

## Consequences

- Add a dependency-light operational-contract package outside `packages/core`.
- Preserve the constitutional kernel; no product/domain entity enters core.
- Composer migration must preserve existing App package/install compatibility while adding source-spec traceability.
- Operational IR and projections must be deterministic/rebuildable and must not execute semantic or external effects.
- Future Forge/Operational World Compiler work targets `OperationalSystemSpec`, not directly generated Apps.
