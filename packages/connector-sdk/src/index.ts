import type { StateValue } from "../../core/src/index.ts";
import type { IngestionSourceKind } from "../../ingestion/src/index.ts";

export const CONNECTOR_SDK_VERSION = "1.0.0";
export const PLATFORM_API_VERSION = "1.0.0";

export interface ConnectorItem {
  readonly externalId: string;
  readonly content: StateValue;
}

export interface ConnectorDefinition {
  readonly id: string;
  readonly version: string;
  readonly platformApi: { readonly minInclusive: string; readonly maxExclusive: string };
  readonly sourceKinds: readonly IngestionSourceKind[];
  readonly deprecated: boolean;
  readonly replacement?: string;
  readonly pull: (
    cursor: string | undefined,
  ) => Promise<{ readonly items: readonly ConnectorItem[]; readonly nextCursor: string }>;
}

export interface ConnectorDelivery {
  readonly connectorId: string;
  readonly idempotencyKey: string;
  readonly externalId: string;
  readonly content: StateValue;
}

export function defineConnector(input: ConnectorDefinition): ConnectorDefinition {
  parseVersion(input.version);
  const minimum = parseVersion(input.platformApi.minInclusive);
  const maximum = parseVersion(input.platformApi.maxExclusive);
  const platform = parseVersion(PLATFORM_API_VERSION);
  if (compareVersions(minimum, maximum) >= 0) throw new RangeError("connector Platform API range must increase");
  if (compareVersions(platform, minimum) < 0 || compareVersions(platform, maximum) >= 0) {
    throw new Error(`${input.id}@${input.version} is incompatible with Platform API ${PLATFORM_API_VERSION}`);
  }
  if (input.deprecated && input.replacement === undefined) {
    throw new Error("deprecated connector must declare a replacement or migration target");
  }
  return deepFreeze({
    id: prefixed("connector id", input.id, "connector:"),
    version: input.version,
    platformApi: { ...input.platformApi },
    sourceKinds: uniqueRequired("connector source kinds", input.sourceKinds),
    deprecated: input.deprecated,
    ...(input.replacement === undefined
      ? {}
      : { replacement: prefixed("connector replacement", input.replacement, "connector:") }),
    pull: input.pull,
  });
}

export class ConnectorRunner {
  readonly #platformApiVersion: Version;
  readonly #deliver: (item: ConnectorDelivery) => Promise<void>;
  readonly #cursors = new Map<string, string>();
  readonly #delivered = new Set<string>();

  constructor(
    platformApiVersion: string,
    deliver: (item: ConnectorDelivery) => Promise<void>,
  ) {
    this.#platformApiVersion = parseVersion(platformApiVersion);
    this.#deliver = deliver;
  }

  async poll(connector: ConnectorDefinition): Promise<void> {
    const minimum = parseVersion(connector.platformApi.minInclusive);
    const maximum = parseVersion(connector.platformApi.maxExclusive);
    if (
      compareVersions(this.#platformApiVersion, minimum) < 0 ||
      compareVersions(this.#platformApiVersion, maximum) >= 0
    ) {
      throw new Error(`connector ${connector.id} is incompatible with this runner`);
    }
    const result = await connector.pull(this.#cursors.get(connector.id));
    for (const item of result.items) {
      const externalId = namespaced("connector external ID", item.externalId);
      const idempotencyKey = `${connector.id}:${externalId}`;
      if (this.#delivered.has(idempotencyKey)) continue;
      await this.#deliver({ connectorId: connector.id, idempotencyKey, externalId, content: item.content });
      this.#delivered.add(idempotencyKey);
    }
    this.#cursors.set(connector.id, requiredText("connector cursor", result.nextCursor));
  }

  cursor(connectorId: string): string | undefined {
    return this.#cursors.get(connectorId);
  }
}

interface Version { readonly major: number; readonly minor: number; readonly patch: number }
function parseVersion(value: string): Version {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (match === null) throw new TypeError(`version must use major.minor.patch: ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}
function compareVersions(left: Version, right: Version): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}
function uniqueRequired<Value extends string>(name: string, values: readonly Value[]): Value[] {
  const result = values.map((value) => requiredText(name, value) as Value);
  if (result.length === 0) throw new TypeError(`${name} must not be empty`);
  if (new Set(result).size !== result.length) throw new Error(`${name} must not contain duplicates`);
  return result.sort();
}
function prefixed(name: string, value: string, prefix: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${name} must start with ${prefix}`);
  return normalized;
}
function namespaced(name: string, value: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.includes(":")) throw new TypeError(`${name} must be namespace-qualified`);
  return normalized;
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
