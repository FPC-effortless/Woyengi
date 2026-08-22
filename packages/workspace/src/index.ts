type OpaqueId<Kind extends string> = string & { readonly __kind: Kind };

export type AccountId = OpaqueId<"AccountId">;
export type OrganizationId = OpaqueId<"OrganizationId">;
export type WorkspaceId = OpaqueId<"WorkspaceId">;
export type MembershipId = OpaqueId<"MembershipId">;
export type PrincipalId = OpaqueId<"PrincipalId">;
export type WorkspaceOperationId = OpaqueId<"WorkspaceOperationId">;

export type PrincipalKind = "human" | "agent" | "service" | "automation";

export interface Principal {
  readonly id: PrincipalId;
  readonly kind: PrincipalKind;
}

export interface Account {
  readonly id: AccountId;
  readonly ownerPrincipalId: PrincipalId;
  readonly personalWorkspaceId: WorkspaceId;
}

export interface Organization {
  readonly id: OrganizationId;
  readonly workspaceId: WorkspaceId;
}

export type Workspace =
  | {
      readonly id: WorkspaceId;
      readonly kind: "personal";
      readonly accountId: AccountId;
    }
  | {
      readonly id: WorkspaceId;
      readonly kind: "organization";
      readonly organizationId: OrganizationId;
    };

export interface Membership {
  readonly id: MembershipId;
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly principalId: PrincipalId;
  readonly status: "invited" | "active";
  readonly invitedByPrincipalId: PrincipalId;
  readonly invitedAt: string;
  readonly activatedAt?: string;
}

export interface WorkspaceContext {
  readonly principalId: PrincipalId;
  readonly workspaceId: WorkspaceId;
  readonly accountId?: AccountId;
  readonly organizationId?: OrganizationId;
}

interface WorkspaceOperationBase {
  readonly id: WorkspaceOperationId;
  readonly ledgerSequence: number;
  readonly transactionTime: { readonly from: string };
}

export interface PrincipalRegisteredOperation extends WorkspaceOperationBase {
  readonly kind: "principal.registered";
  readonly principal: Principal;
}

export interface AccountCreatedOperation extends WorkspaceOperationBase {
  readonly kind: "account.created";
  readonly account: Account;
  readonly workspace: Extract<Workspace, { readonly kind: "personal" }>;
}

export interface OrganizationCreatedOperation extends WorkspaceOperationBase {
  readonly kind: "organization.created";
  readonly organization: Organization;
  readonly workspace: Extract<Workspace, { readonly kind: "organization" }>;
  readonly membership: Membership & { readonly status: "active" };
}

export interface MembershipInvitedOperation extends WorkspaceOperationBase {
  readonly kind: "membership.invited";
  readonly membership: Membership & { readonly status: "invited" };
}

export interface MembershipAcceptedOperation extends WorkspaceOperationBase {
  readonly kind: "membership.accepted";
  readonly membershipId: MembershipId;
  readonly principalId: PrincipalId;
}

export type WorkspaceOperation =
  | PrincipalRegisteredOperation
  | AccountCreatedOperation
  | OrganizationCreatedOperation
  | MembershipInvitedOperation
  | MembershipAcceptedOperation;

export class WorkspaceRegistry {
  readonly #principals = new Map<string, Principal>();
  readonly #accounts = new Map<string, Account>();
  readonly #organizations = new Map<string, Organization>();
  readonly #workspaces = new Map<string, Workspace>();
  readonly #memberships = new Map<string, Membership>();
  readonly #operationIds = new Set<string>();
  readonly #ledgerSequences = new Set<number>();
  readonly #operations: WorkspaceOperation[] = [];
  #lastLedgerSequence = 0;

  static replay(operations: readonly WorkspaceOperation[]): WorkspaceRegistry {
    const registry = new WorkspaceRegistry();
    for (const operation of [...operations].sort(compareOperations)) {
      registry.#apply(operation);
    }
    return registry;
  }

  registerPrincipal(input: {
    readonly operationId: string;
    readonly id: string;
    readonly kind: PrincipalKind;
    readonly recordedAt: string;
  }): Principal {
    const principal = deepFreeze({
      id: principalId(input.id),
      kind: principalKind(input.kind),
    });
    const operation = deepFreeze({
      id: operationId(input.operationId),
      kind: "principal.registered" as const,
      ledgerSequence: this.#nextLedgerSequence(),
      principal,
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    this.#apply(operation);
    return principal;
  }

  createAccount(input: {
    readonly operationId: string;
    readonly id: string;
    readonly ownerPrincipalId: string;
    readonly personalWorkspaceId: string;
    readonly recordedAt: string;
  }): { readonly account: Account; readonly workspace: Workspace } {
    const account: Account = deepFreeze({
      id: accountId(input.id),
      ownerPrincipalId: principalId(input.ownerPrincipalId),
      personalWorkspaceId: workspaceId(input.personalWorkspaceId),
    });
    const workspace: Extract<Workspace, { readonly kind: "personal" }> = deepFreeze({
      id: account.personalWorkspaceId,
      kind: "personal" as const,
      accountId: account.id,
    });
    const operation = deepFreeze({
      id: operationId(input.operationId),
      kind: "account.created" as const,
      ledgerSequence: this.#nextLedgerSequence(),
      account,
      workspace,
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    this.#apply(operation);
    return deepFreeze({ account, workspace });
  }

  createOrganization(input: {
    readonly operationId: string;
    readonly id: string;
    readonly workspaceId: string;
    readonly ownerMembershipId: string;
    readonly ownerPrincipalId: string;
    readonly recordedAt: string;
  }): {
    readonly organization: Organization;
    readonly workspace: Workspace;
    readonly membership: Membership;
  } {
    const recordedAt = normalizeInstant(input.recordedAt);
    const organization: Organization = deepFreeze({
      id: organizationId(input.id),
      workspaceId: workspaceId(input.workspaceId),
    });
    const workspace: Extract<Workspace, { readonly kind: "organization" }> = deepFreeze({
      id: organization.workspaceId,
      kind: "organization" as const,
      organizationId: organization.id,
    });
    const membership: Membership & { readonly status: "active" } = deepFreeze({
      id: membershipId(input.ownerMembershipId),
      organizationId: organization.id,
      workspaceId: workspace.id,
      principalId: principalId(input.ownerPrincipalId),
      status: "active" as const,
      invitedByPrincipalId: principalId(input.ownerPrincipalId),
      invitedAt: recordedAt,
      activatedAt: recordedAt,
    });
    const operation = deepFreeze({
      id: operationId(input.operationId),
      kind: "organization.created" as const,
      ledgerSequence: this.#nextLedgerSequence(),
      organization,
      workspace,
      membership,
      transactionTime: { from: recordedAt },
    });
    this.#apply(operation);
    return deepFreeze({ organization, workspace, membership });
  }

  inviteMember(input: {
    readonly operationId: string;
    readonly id: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly invitedByPrincipalId: string;
    readonly recordedAt: string;
  }): Membership {
    const organizationIdValue = organizationId(input.organizationId);
    const organization = this.#organizations.get(organizationIdValue);
    if (organization === undefined) {
      throw new Error(`organization does not exist: ${organizationIdValue}`);
    }
    const membership: Membership & { readonly status: "invited" } = deepFreeze({
      id: membershipId(input.id),
      organizationId: organizationIdValue,
      workspaceId: organization.workspaceId,
      principalId: principalId(input.principalId),
      status: "invited" as const,
      invitedByPrincipalId: principalId(input.invitedByPrincipalId),
      invitedAt: normalizeInstant(input.recordedAt),
    });
    const operation = deepFreeze({
      id: operationId(input.operationId),
      kind: "membership.invited" as const,
      ledgerSequence: this.#nextLedgerSequence(),
      membership,
      transactionTime: { from: membership.invitedAt },
    });
    this.#apply(operation);
    return membership;
  }

  acceptInvitation(input: {
    readonly operationId: string;
    readonly membershipId: string;
    readonly principalId: string;
    readonly recordedAt: string;
  }): Membership {
    const operation = deepFreeze({
      id: operationId(input.operationId),
      kind: "membership.accepted" as const,
      ledgerSequence: this.#nextLedgerSequence(),
      membershipId: membershipId(input.membershipId),
      principalId: principalId(input.principalId),
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    this.#apply(operation);
    return this.#memberships.get(operation.membershipId) as Membership;
  }

  switchWorkspace(input: { readonly principalId: string; readonly workspaceId: string }): WorkspaceContext {
    const principalIdValue = principalId(input.principalId);
    const workspaceIdValue = workspaceId(input.workspaceId);
    const workspace = this.#workspaces.get(workspaceIdValue);
    if (workspace === undefined) throw new Error(`workspace does not exist: ${workspaceIdValue}`);
    if (workspace.kind === "organization" && !this.#isActiveMember(principalIdValue, workspace.organizationId)) {
      throw new Error(`${principalIdValue} is not an active member of ${workspace.organizationId}`);
    }
    return this.#contextFor(principalIdValue, workspace);
  }

  workspaceFor(input: { readonly principalId: string; readonly workspaceId: string }): Workspace {
    const principalIdValue = principalId(input.principalId);
    const workspaceIdValue = workspaceId(input.workspaceId);
    const workspace = this.#workspaces.get(workspaceIdValue);
    if (workspace === undefined || !this.#canAccess(principalIdValue, workspace)) {
      throw new Error(`workspace access denied: ${principalIdValue} -> ${workspaceIdValue}`);
    }
    return workspace;
  }

  membershipsFor(principal: string): readonly Membership[] {
    const principalIdValue = principalId(principal);
    return deepFreeze(
      [...this.#memberships.values()]
        .filter((membership) => membership.principalId === principalIdValue)
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
  }

  history(): readonly WorkspaceOperation[] {
    return Object.freeze([...this.#operations].sort(compareOperations));
  }

  #apply(operation: WorkspaceOperation): void {
    validateOperation(operation);
    if (this.#operationIds.has(operation.id)) {
      throw new Error(`workspace operation already exists: ${operation.id}`);
    }
    if (this.#ledgerSequences.has(operation.ledgerSequence)) throw new Error(`workspace ledger sequence already exists: ${operation.ledgerSequence}`);
    switch (operation.kind) {
      case "principal.registered":
        if (this.#principals.has(operation.principal.id)) {
          throw new Error(`principal already exists: ${operation.principal.id}`);
        }
        this.#principals.set(operation.principal.id, operation.principal);
        break;
      case "account.created":
        this.#applyAccountCreated(operation);
        break;
      case "organization.created":
        this.#applyOrganizationCreated(operation);
        break;
      case "membership.invited":
        this.#applyMembershipInvited(operation);
        break;
      case "membership.accepted":
        this.#applyMembershipAccepted(operation);
        break;
    }
    this.#operationIds.add(operation.id);
    this.#ledgerSequences.add(operation.ledgerSequence);
    this.#lastLedgerSequence = Math.max(this.#lastLedgerSequence, operation.ledgerSequence);
    this.#operations.push(deepFreeze(structuredClone(operation)));
  }

  #nextLedgerSequence(): number {
    return this.#lastLedgerSequence + 1;
  }

  #applyAccountCreated(operation: AccountCreatedOperation): void {
    if (this.#accounts.has(operation.account.id)) {
      throw new Error(`account already exists: ${operation.account.id}`);
    }
    if (
      [...this.#accounts.values()].some(
        (account) => account.ownerPrincipalId === operation.account.ownerPrincipalId,
      )
    ) {
      throw new Error(`principal already owns an account: ${operation.account.ownerPrincipalId}`);
    }
    this.#assertHumanPrincipal(operation.account.ownerPrincipalId);
    this.#assertNewWorkspace(operation.workspace.id);
    if (operation.account.personalWorkspaceId !== operation.workspace.id) {
      throw new Error("account personal workspace reference does not match the created workspace");
    }
    this.#accounts.set(operation.account.id, operation.account);
    this.#workspaces.set(operation.workspace.id, operation.workspace);
  }

  #applyOrganizationCreated(operation: OrganizationCreatedOperation): void {
    if (this.#organizations.has(operation.organization.id)) {
      throw new Error(`organization already exists: ${operation.organization.id}`);
    }
    this.#assertHumanPrincipal(operation.membership.principalId);
    this.#assertNewWorkspace(operation.workspace.id);
    this.#assertNewMembership(operation.membership);
    if (
      operation.organization.workspaceId !== operation.workspace.id ||
      operation.membership.organizationId !== operation.organization.id ||
      operation.membership.workspaceId !== operation.workspace.id
    ) {
      throw new Error("organization, workspace, and owner membership references must match");
    }
    this.#organizations.set(operation.organization.id, operation.organization);
    this.#workspaces.set(operation.workspace.id, operation.workspace);
    this.#memberships.set(operation.membership.id, operation.membership);
  }

  #applyMembershipInvited(operation: MembershipInvitedOperation): void {
    this.#assertPrincipal(operation.membership.principalId);
    this.#assertPrincipal(operation.membership.invitedByPrincipalId);
    const organization = this.#organizations.get(operation.membership.organizationId);
    if (organization === undefined || organization.workspaceId !== operation.membership.workspaceId) {
      throw new Error(`organization membership scope is invalid: ${operation.membership.organizationId}`);
    }
    if (!this.#isActiveMember(operation.membership.invitedByPrincipalId, organization.id)) {
      throw new Error("membership invitation requires an active organization member");
    }
    this.#assertNewMembership(operation.membership);
    this.#memberships.set(operation.membership.id, operation.membership);
  }

  #applyMembershipAccepted(operation: MembershipAcceptedOperation): void {
    this.#assertPrincipal(operation.principalId);
    const membership = this.#memberships.get(operation.membershipId);
    if (membership === undefined) throw new Error(`membership does not exist: ${operation.membershipId}`);
    if (membership.principalId !== operation.principalId) {
      throw new Error("only the invited principal can accept a membership");
    }
    if (membership.status !== "invited") {
      throw new Error(`membership is not awaiting acceptance: ${operation.membershipId}`);
    }
    this.#memberships.set(
      membership.id,
      deepFreeze({ ...membership, status: "active" as const, activatedAt: operation.transactionTime.from }),
    );
  }

  #assertHumanPrincipal(id: PrincipalId): void {
    const principal = this.#assertPrincipal(id);
    if (principal.kind !== "human") throw new Error(`${id} must be a human principal`);
  }

  #assertPrincipal(id: PrincipalId): Principal {
    const principal = this.#principals.get(id);
    if (principal === undefined) throw new Error(`principal does not exist: ${id}`);
    return principal;
  }

  #assertNewWorkspace(id: WorkspaceId): void {
    if (this.#workspaces.has(id)) throw new Error(`workspace already exists: ${id}`);
  }

  #assertNewMembership(membership: Membership): void {
    if (this.#memberships.has(membership.id)) {
      throw new Error(`membership already exists: ${membership.id}`);
    }
    const duplicate = [...this.#memberships.values()].some(
      (candidate) =>
        candidate.organizationId === membership.organizationId &&
        candidate.principalId === membership.principalId,
    );
    if (duplicate) {
      throw new Error(
        `principal already has a membership in organization: ${membership.principalId}`,
      );
    }
  }

  #canAccess(principal: PrincipalId, workspace: Workspace): boolean {
    if (workspace.kind === "personal") {
      return this.#accounts.get(workspace.accountId)?.ownerPrincipalId === principal;
    }
    return this.#isActiveMember(principal, workspace.organizationId);
  }

  #isActiveMember(principal: PrincipalId, organization: OrganizationId): boolean {
    return [...this.#memberships.values()].some(
      (membership) =>
        membership.organizationId === organization &&
        membership.principalId === principal &&
        membership.status === "active",
    );
  }

  #contextFor(principal: PrincipalId, workspace: Workspace): WorkspaceContext {
    if (!this.#canAccess(principal, workspace)) {
      throw new Error(`workspace access denied: ${principal} -> ${workspace.id}`);
    }
    return deepFreeze({
      principalId: principal,
      workspaceId: workspace.id,
      ...(workspace.kind === "personal"
        ? { accountId: workspace.accountId }
        : { organizationId: workspace.organizationId }),
    });
  }
}

function validateOperation(operation: WorkspaceOperation): void {
  operationId(operation.id);
  if (!Number.isSafeInteger(operation.ledgerSequence) || operation.ledgerSequence < 1) throw new TypeError("workspace ledgerSequence must be a positive safe integer");
  normalizeInstant(operation.transactionTime.from);
  switch (operation.kind) {
    case "principal.registered":
      principalId(operation.principal.id);
      principalKind(operation.principal.kind);
      break;
    case "account.created":
      accountId(operation.account.id);
      principalId(operation.account.ownerPrincipalId);
      workspaceId(operation.account.personalWorkspaceId);
      workspaceId(operation.workspace.id);
      accountId(operation.workspace.accountId);
      break;
    case "organization.created":
      organizationId(operation.organization.id);
      workspaceId(operation.organization.workspaceId);
      workspaceId(operation.workspace.id);
      organizationId(operation.workspace.organizationId);
      validateMembership(operation.membership);
      break;
    case "membership.invited":
      validateMembership(operation.membership);
      break;
    case "membership.accepted":
      membershipId(operation.membershipId);
      principalId(operation.principalId);
      break;
  }
}

function validateMembership(membership: Membership): void {
  membershipId(membership.id);
  organizationId(membership.organizationId);
  workspaceId(membership.workspaceId);
  principalId(membership.principalId);
  principalId(membership.invitedByPrincipalId);
  normalizeInstant(membership.invitedAt);
  if (membership.activatedAt !== undefined) normalizeInstant(membership.activatedAt);
}

function compareOperations(left: WorkspaceOperation, right: WorkspaceOperation): number {
  return left.ledgerSequence - right.ledgerSequence;
}

function accountId(value: string): AccountId {
  return prefixedId("account id", value, "account:") as AccountId;
}

function organizationId(value: string): OrganizationId {
  return prefixedId("organization id", value, "organization:") as OrganizationId;
}

function workspaceId(value: string): WorkspaceId {
  return prefixedId("workspace id", value, "workspace:") as WorkspaceId;
}

function membershipId(value: string): MembershipId {
  return prefixedId("membership id", value, "membership:") as MembershipId;
}

function principalId(value: string): PrincipalId {
  return prefixedId("principal id", value, "principal:") as PrincipalId;
}

function operationId(value: string): WorkspaceOperationId {
  return prefixedId("workspace operation id", value, "workspace-operation:") as WorkspaceOperationId;
}

function prefixedId(name: string, value: string, prefix: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${name} must start with ${prefix}`);
  const opaque = normalized.slice(prefix.length);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(opaque)) {
    throw new TypeError(`${name} must contain an opaque namespace-qualified identifier`);
  }
  return normalized;
}

function principalKind(value: PrincipalKind): PrincipalKind {
  const kinds: readonly PrincipalKind[] = ["human", "agent", "service", "automation"];
  if (!kinds.includes(value)) throw new TypeError(`unsupported principal kind: ${String(value)}`);
  return value;
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`timestamp must include an explicit UTC offset: ${value}`);
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return instant.toISOString();
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
