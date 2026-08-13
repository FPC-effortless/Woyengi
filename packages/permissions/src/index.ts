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

export interface Capability {
  readonly id: string;
  readonly principal: string;
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
  const capability: Capability = {
    id: namespaced("capability id", input.id, "capability:"),
    principal: namespaced("principal", input.principal),
    issuer: namespaced("issuer", input.issuer),
    resourcePrefixes: uniqueRequired("resourcePrefixes", input.resourcePrefixes),
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
    },
  };
  return deepFreeze(capability);
}

export class CapabilityEngine {
  readonly #capabilities = new Map<string, Capability>();

  register(capability: Capability): void {
    if (this.#capabilities.has(capability.id)) {
      throw new Error(`capability already exists: ${capability.id}`);
    }
    if (capability.delegation.parentCapabilityId !== undefined) {
      this.#validateDelegation(capability);
    }
    this.#capabilities.set(capability.id, capability);
  }

  authorize(request: AuthorizationRequest): AuthorizationDecision {
    const at = normalizeInstant(request.at);
    const evaluations = [...this.#capabilities.values()]
      .filter((capability) => capability.principal === request.principal)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((capability) => evaluate(capability, request, at));
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
  }
}

function evaluate(
  capability: Capability,
  request: AuthorizationRequest,
  at: string,
): CapabilityEvaluation {
  const failures: string[] = [];
  if (at < capability.validFrom || at >= capability.expiresAt) failures.push("outside-time-bound");
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

function inBoundary(value: string, root: string): boolean {
  return value === root || value.startsWith(`${root}/`);
}

function sensitivityRank(value: Sensitivity): number {
  return { public: 0, internal: 1, confidential: 2, restricted: 3 }[value];
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
      .map(([name, item]) => [requiredText("condition name", name), requiredText("condition value", item)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function namespaced(name: string, value: string, prefix?: string): string {
  const normalized = requiredText(name, value);
  if (prefix === undefined ? !normalized.includes(":") : !normalized.startsWith(prefix)) {
    throw new TypeError(`${name} must be namespace-qualified`);
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
