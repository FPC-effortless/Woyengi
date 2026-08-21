# ADR 0005: App portability and shared semantic state

Status: Accepted for implementation

## Decision

Natural-language operating intent compiles through `AppIntent`, `SoftwareRequirementGraph`, and `CompositionPlan` before producing an `AppBlueprint`. Implementation selection follows: do nothing, reuse, configure, compose, adapt, extend, then generate.

An `ApplicationPackage` is a portable software definition. An `ApplicationInstance` binds a package version to one workspace's domains, roles, participants, integrations, surfaces, automations, overlays, and runtime requirements.

Software definition, workspace data, credentials, and authority are separate. Packages do not own private production databases by default. Customer, Invoice, Repository, Employee, Supplier, and other domain objects remain shared semantic objects in the workspace, so two Apps can bind the same object identity without duplicating data.

Exports never include secrets or workspace authority. Public surfaces receive explicit, narrow contracts and cannot expose an internal App or its capability context directly.
