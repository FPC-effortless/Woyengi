export interface ExtensionDefinition {
  readonly id: string;
  readonly description?: string;
}

export interface PlatformApiRange {
  readonly minInclusive: string;
  readonly maxExclusive: string;
}

export interface DomainPackage {
  readonly name: string;
  readonly version: string;
  readonly platformApi: PlatformApiRange;
  readonly entityTypes: readonly ExtensionDefinition[];
  readonly claimPredicates: readonly ExtensionDefinition[];
  readonly eventTypes: readonly ExtensionDefinition[];
  readonly relationshipTypes: readonly ExtensionDefinition[];
  readonly graphDefinitions: readonly ExtensionDefinition[];
  readonly lifecycleRules: readonly ExtensionDefinition[];
  readonly authorityPolicies: readonly ExtensionDefinition[];
  readonly stateReducers: readonly ExtensionDefinition[];
  readonly verificationRules: readonly ExtensionDefinition[];
  readonly reconstructionPolicies: readonly ExtensionDefinition[];
  readonly permissionPolicies: readonly ExtensionDefinition[];
  readonly procedures: readonly ExtensionDefinition[];
  readonly connectors: readonly ExtensionDefinition[];
}

export function defineDomainPackage(input: DomainPackage): DomainPackage {
  requiredText("domain package name", input.name);
  parseVersion(input.version);
  const minimum = parseVersion(input.platformApi.minInclusive);
  const maximum = parseVersion(input.platformApi.maxExclusive);
  if (compareVersions(minimum, maximum) >= 0) {
    throw new RangeError("platform API range must have an increasing boundary");
  }

  const result: DomainPackage = {
    name: input.name,
    version: input.version,
    platformApi: { ...input.platformApi },
    entityTypes: definitions("entityTypes", input.entityTypes),
    claimPredicates: definitions("claimPredicates", input.claimPredicates),
    eventTypes: definitions("eventTypes", input.eventTypes),
    relationshipTypes: definitions("relationshipTypes", input.relationshipTypes),
    graphDefinitions: definitions("graphDefinitions", input.graphDefinitions),
    lifecycleRules: definitions("lifecycleRules", input.lifecycleRules),
    authorityPolicies: definitions("authorityPolicies", input.authorityPolicies),
    stateReducers: definitions("stateReducers", input.stateReducers),
    verificationRules: definitions("verificationRules", input.verificationRules),
    reconstructionPolicies: definitions("reconstructionPolicies", input.reconstructionPolicies),
    permissionPolicies: definitions("permissionPolicies", input.permissionPolicies),
    procedures: definitions("procedures", input.procedures),
    connectors: definitions("connectors", input.connectors),
  };
  return deepFreeze(result);
}

export class DomainPackageRegistry {
  readonly #platformApiVersion: Version;
  readonly #packages = new Map<string, DomainPackage>();

  constructor(platformApiVersion: string) {
    this.#platformApiVersion = parseVersion(platformApiVersion);
  }

  install(domainPackage: DomainPackage): void {
    const minimum = parseVersion(domainPackage.platformApi.minInclusive);
    const maximum = parseVersion(domainPackage.platformApi.maxExclusive);
    if (
      compareVersions(this.#platformApiVersion, minimum) < 0 ||
      compareVersions(this.#platformApiVersion, maximum) >= 0
    ) {
      throw new Error(
        `${domainPackage.name}@${domainPackage.version} is incompatible with platform API ${formatVersion(this.#platformApiVersion)}`,
      );
    }
    if (this.#packages.has(domainPackage.name)) {
      throw new Error(`domain package already installed: ${domainPackage.name}`);
    }
    this.#packages.set(domainPackage.name, domainPackage);
  }

  get(name: string): DomainPackage | undefined {
    return this.#packages.get(name);
  }

  installed(): readonly DomainPackage[] {
    return Object.freeze(
      [...this.#packages.values()].sort((left, right) => left.name.localeCompare(right.name)),
    );
  }
}

interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function definitions(name: string, values: readonly ExtensionDefinition[]): ExtensionDefinition[] {
  const seen = new Set<string>();
  return values.map((value) => {
    const id = requiredText(`${name} id`, value.id);
    if (!id.includes(":")) {
      throw new TypeError(`${name} id must be namespace-qualified: ${id}`);
    }
    if (seen.has(id)) {
      throw new Error(`duplicate ${name} id: ${id}`);
    }
    seen.add(id);
    return {
      id,
      ...(value.description === undefined
        ? {}
        : { description: requiredText(`${name} description`, value.description) }),
    };
  });
}

function parseVersion(value: string): Version {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (match === null) {
    throw new TypeError(`version must use major.minor.patch: ${value}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(left: Version, right: Version): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function formatVersion(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
  return normalized;
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
