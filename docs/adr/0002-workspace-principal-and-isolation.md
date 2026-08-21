# ADR 0002: Workspace, principal, and isolation semantics

Status: Accepted for implementation

## Decision

An Account owns exactly one Personal Workspace and may participate in any number of Organization Workspaces through explicit memberships. A one-person organization and a large enterprise use the same Organization model; teams, groups, policies, SSO, SCIM, residency, and deployment controls are additive.

Every governed read, proposal, execution, commit, export, and share operation carries a `WorkspaceContext`. Cross-workspace access defaults to denied and cannot be granted by object aliases or shared package identity.

`HumanPrincipal`, `AgentPrincipal`, `ServicePrincipal`, and `AutomationPrincipal` are distinct principal kinds. Delegation creates a narrower grant for the target principal; it never copies a user's full authority.

## Identifier contract

Opaque identifiers are namespace-qualified (`account:`, `workspace:`, `organization:`, `principal:`, `membership:`), immutable, and validated at public boundaries. Shared objects have one identity within a workspace and cannot be joined across workspace boundaries without an explicit, authorized external reference.
