export type CapabilityOperation =
  | "READ"
  | "SEARCH"
  | "RECONSTRUCT"
  | "CREATE"
  | "PROPOSE_WRITE"
  | "AMEND"
  | "VERIFY"
  | "SUPERSEDE"
  | "RETRACT"
  | "EXPORT"
  | "SHARE"
  | "EXECUTE"
  | "SUBSCRIBE";

export type Sensitivity = "public" | "internal" | "confidential" | "restricted";
export type CapabilityPrincipalKind = "human" | "agent" | "service" | "automation";

export interface Capability {
  readonly id: string;
  readonly workspaceId: string;
  readonly principal: string;
  readonly principalKind: CapabilityPrincipalKind;
  readonly issuer: string;
  readonly resourcePrefixes: readonly string[];
  readonly graphTypes: readonly string[];
  readonly entityIds: readonly string[];
  readonly operations: readonly CapabilityOperation[];
  readonly purposes: readonly string[];
  readonly maxSensitivity: Sensitivity;
  readonly conditions: Readonly<Record<string, string>>;
  readonly validFrom: string;
  readonly expiresAt: string;
  readonly delegation: {
    readonly canDelegate: boolean;
    readonly parentCapabilityId?: string;
    readonly depth: number;
    readonly maxDepth: number;
  };
}

export interface AuthorizationRequest {
  readonly principal: string;
  readonly resourceId: string;
  readonly graphType: string;
  readonly entityId: string;
  readonly operation: CapabilityOperation;
  readonly purpose: string;
  readonly sensitivity: Sensitivity;
  readonly context: Readonly<Record<string, string>>;
  readonly workspaceContext: {
    readonly workspaceId: string;
    readonly principalId: string;
  };
  readonly at: string;
}

export interface CapabilityEvaluation {
  readonly capabilityId: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly capabilityId?: string;
  readonly reason: "capability-granted" | "default-deny";
  readonly evaluations: readonly CapabilityEvaluation[];
}

export function defineCapability(input: Capability): Capability {
  const validFrom = normalizeInstant(input.validFrom);
  const expiresAt = normalizeInstant(input.expiresAt);
  if (expiresAt <= validFrom) {
    throw new RangeError("capability expiry must be after validFrom");
  }
  const workspaceId = namespaced("workspace id", input.workspaceId, "workspace:");
  const depth = nonNegativeInteger("delegation depth", input.delegation.depth);
  const maxDepth = nonNegativeInteger("maximum delegation depth", input.delegation.maxDepth);
  if (depth > maxDepth) throw new RangeError("delegation depth exceeds maximum delegation depth");
  if (input.delegation.parentCapabilityId === undefined && depth !== 0) {
    throw new RangeError("root capability delegation depth must be zero");
  }
  if (input.delegation.parentCapabilityId !== undefined && depth === 0) {
    throw new RangeError("delegated capability depth must be greater than zero");
  }
  const resourcePrefixes = uniqueRequired("resourcePrefixes", input.resourcePrefixes);
  if (!resourcePrefixes.every((prefix) => inBoundary(prefix, workspaceId))) {
    throw new Error("capability resources must remain inside its workspace scope");
  }
  const capability: Capability = {
    id: namespaced("capability id", input.id, "capability:"),
    workspaceId,
    principal: namespaced("principal", input.principal, "principal:"),
    principalKind: principalKind(input.principalKind),
    issuer: namespaced("issuer", input.issuer),
    resourcePrefixes,
    graphTypes: unique("graphTypes", input.graphTypes),
    entityIds: unique("entityIds", input.entityIds),
    operations: uniqueRequired("operations", input.operations),
    purposes: uniqueRequired("purposes", input.purposes),
    maxSensitivity: input.maxSensitivity,
    conditions: sortedRecord(input.conditions),
    validFrom,
    expiresAt,
    delegation: {
      canDelegate: input.delegation.canDelegate,
      ...(input.delegation.parentCapabilityId === undefined
        ? {}
        : {
            parentCapabilityId: namespaced(
              "parent capability id",
              input.delegation.parentCapabilityId,
              "capability:",
            ),
          }),
      depth,
      maxDepth,
    },
  };
  return deepFreeze(capability);
}

export class CapabilityEngine {
  readonly #capabilities = new Map<string, Capability>();
  readonly #revocations = new Map<string, string>();

  register(capability: Capability): void {
    if (this.#capabilities.has(capability.id)) {
      throw new Error(`capability already exists: ${capability.id}`);
    }
    if (capability.delegation.parentCapabilityId !== undefined) {
      this.#validateDelegation(capability);
    }
    this.#capabilities.set(capability.id, capability);
  }

  revoke(input: { readonly capabilityId: string; readonly revokedAt: string }): void {
    const capabilityId = namespaced("capability id", input.capabilityId, "capability:");
    if (!this.#capabilities.has(capabilityId)) throw new Error(`capability does not exist: ${capabilityId}`);
    if (this.#revocations.has(capabilityId)) throw new Error(`capability is already revoked: ${capabilityId}`);
    this.#revocations.set(capabilityId, normalizeInstant(input.revokedAt));
  }

  authorize(request: AuthorizationRequest): AuthorizationDecision {
    const at = normalizeInstant(request.at);
    const principal = namespaced("authorization principal", request.principal, "principal:");
    const workspaceId = namespaced("authorization workspace", request.workspaceContext.workspaceId, "workspace:");
    const contextPrincipal = namespaced("workspace context principal", request.workspaceContext.principalId, "principal:");
    const normalizedRequest: AuthorizationRequest = {
      ...request,
      principal,
      workspaceContext: { workspaceId, principalId: contextPrincipal },
    };
    const evaluations = [...this.#capabilities.values()]
      .filter((capability) => capability.principal === principal)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((capability) => evaluate(capability, normalizedRequest, at, this.#revocations.get(capability.id)));
    const granted = evaluations.find((evaluation) => evaluation.passed);
    return deepFreeze({
      allowed: granted !== undefined,
      ...(granted === undefined ? {} : { capabilityId: granted.capabilityId }),
      reason: granted === undefined ? ("default-deny" as const) : ("capability-granted" as const),
      evaluations,
    });
  }

  #validateDelegation(child: Capability): void {
    const parentId = child.delegation.parentCapabilityId as string;
    const parent = this.#capabilities.get(parentId);
    if (parent === undefined) {
      throw new Error(`parent capability does not exist: ${parentId}`);
    }
    if (!parent.delegation.canDelegate) {
      throw new Error(`parent capability cannot delegate: ${parentId}`);
    }
    if (child.issuer !== parent.principal) {
      throw new Error("delegated capability issuer must be the parent principal");
    }
    if (child.workspaceId !== parent.workspaceId) {
      throw new Error("delegated capability workspace scope must match its parent");
    }
    if (parent.delegation.depth >= parent.delegation.maxDepth) {
      throw new Error("parent capability has reached its maximum delegation depth");
    }
    if (child.delegation.depth !== parent.delegation.depth + 1) {
      throw new Error("delegated capability must increment delegation depth by one");
    }
    if (child.delegation.maxDepth > parent.delegation.maxDepth) {
      throw new Error("delegated capability cannot increase maximum delegation depth");
    }
    if (child.validFrom < parent.validFrom || child.expiresAt > parent.expiresAt) {
      throw new Error("delegated capability time range exceeds its parent");
    }
    assertSubset("operations", child.operations, parent.operations);
    assertSubset("purposes", child.purposes, parent.purposes);
    assertOptionalSubset("graphTypes", child.graphTypes, parent.graphTypes);
    assertOptionalSubset("entityIds", child.entityIds, parent.entityIds);
    if (!child.resourcePrefixes.every((prefix) => parent.resourcePrefixes.some((root) => inBoundary(prefix, root)))) {
      throw new Error("delegated capability resource scope exceeds its parent");
    }
    if (sensitivityRank(child.maxSensitivity) > sensitivityRank(parent.maxSensitivity)) {
      throw new Error("delegated capability sensitivity exceeds its parent");
    }
    for (const [name, value] of Object.entries(parent.conditions)) {
      if (child.conditions[name] !== value) {
        throw new Error(`delegated capability weakens parent condition: ${name}`);
      }
    }
    if (!strictlyNarrows(child, parent)) {
      const subject = child.principalKind === "agent" && parent.principalKind === "human"
        ? "AgentPrincipal cannot inherit an entire human grant"
        : "delegated capability";
      throw new Error(`${subject}; delegation must strictly narrow authority`);
    }
  }
}

function evaluate(
  capability: Capability,
  request: AuthorizationRequest,
  at: string,
  revokedAt: string | undefined,
): CapabilityEvaluation {
  const failures: string[] = [];
  if (revokedAt !== undefined && at >= revokedAt) failures.push("revoked");
  if (at < capability.validFrom || at >= capability.expiresAt) failures.push("outside-time-bound");
  if (capability.workspaceId !== request.workspaceContext.workspaceId) failures.push("workspace-out-of-scope");
  if (request.workspaceContext.principalId !== request.principal) failures.push("principal-context-mismatch");
  if (!inBoundary(request.resourceId, request.workspaceContext.workspaceId)) failures.push("workspace-resource-mismatch");
  if (!capability.operations.includes(request.operation)) failures.push("operation-not-granted");
  if (!capability.purposes.includes(request.purpose)) failures.push("purpose-not-granted");
  if (!capability.resourcePrefixes.some((prefix) => inBoundary(request.resourceId, prefix))) {
    failures.push("resource-out-of-scope");
  }
  if (capability.graphTypes.length > 0 && !capability.graphTypes.includes(request.graphType)) {
    failures.push("graph-out-of-scope");
  }
  if (capability.entityIds.length > 0 && !capability.entityIds.includes(request.entityId)) {
    failures.push("entity-out-of-scope");
  }
  if (sensitivityRank(request.sensitivity) > sensitivityRank(capability.maxSensitivity)) {
    failures.push("sensitivity-exceeds-grant");
  }
  for (const [name, value] of Object.entries(capability.conditions)) {
    if (request.context[name] !== value) failures.push(`condition-failed:${name}`);
  }
  return {
    capabilityId: capability.id,
    passed: failures.length === 0,
    failures: Object.freeze(failures),
  };
}

function strictlyNarrows(child: Capability, parent: Capability): boolean {
  return child.validFrom > parent.validFrom
    || child.expiresAt < parent.expiresAt
    || sensitivityRank(child.maxSensitivity) < sensitivityRank(parent.maxSensitivity)
    || !sameValues(child.operations, parent.operations)
    || !sameValues(child.purposes, parent.purposes)
    || !sameValues(child.resourcePrefixes, parent.resourcePrefixes)
    || !sameValues(child.graphTypes, parent.graphTypes)
    || !sameValues(child.entityIds, parent.entityIds)
    || Object.keys(child.conditions).length > Object.keys(parent.conditions).length;
}

function sameValues<Value>(left: readonly Value[], right: readonly Value[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function inBoundary(value: string, root: string): boolean {
  return value === root || value.startsWith(`${root}/`);
}

function sensitivityRank(value: Sensitivity): number {
  return { public: 0, internal: 1, confidential: 2, restricted: 3 }[value];
}

function principalKind(value: CapabilityPrincipalKind): CapabilityPrincipalKind {
  if (!["human", "agent", "service", "automation"].includes(value)) {
    throw new TypeError(`unsupported capability principal kind: ${value}`);
  }
  return value;
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return value;
}

function assertSubset<Value>(name: string, child: readonly Value[], parent: readonly Value[]): void {
  if (!child.every((item) => parent.includes(item))) {
    throw new Error(`delegated capability ${name} exceed its parent`);
  }
}

function assertOptionalSubset<Value>(
  name: string,
  child: readonly Value[],
  parent: readonly Value[],
): void {
  if (parent.length > 0 && (child.length === 0 || !child.every((item) => parent.includes(item)))) {
    throw new Error(`delegated capability ${name} exceed its parent`);
  }
}

function unique<Value extends string>(name: string, values: readonly Value[]): Value[] {
  const normalized = values.map((value) => requiredText(name, value) as Value);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${name} must not contain duplicates`);
  }
  return normalized.sort();
}

function uniqueRequired<Value extends string>(name: string, values: readonly Value[]): Value[] {
  const normalized = unique(name, values);
  if (normalized.length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
  return normalized;
}

function sortedRecord(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([name, item]): [string, string] => [requiredText("condition name", name), requiredText("condition value", item)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function namespaced(name: string, value: string, prefix?: string): string {
  const normalized = requiredText(name, value);
  if (prefix === undefined && !normalized.includes(":")) {
    throw new TypeError(`${name} must be namespace-qualified`);
  }
  if (prefix !== undefined && !normalized.startsWith(prefix)) {
    throw new TypeError(`${name} must start with ${prefix}`);
  }
  return normalized;
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`timestamp must include an explicit UTC offset: ${value}`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return date.toISOString();
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
