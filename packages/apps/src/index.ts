import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ApplicationPackageDependency {
  readonly id: string;
  readonly versionRange: string;
}

export interface ApplicationPackageMigration {
  readonly id: string;
  readonly fromVersion: string;
  readonly toVersion: string;
}

export interface ApplicationPackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly blueprintRef: string;
  readonly dependencies: readonly ApplicationPackageDependency[];
  readonly surfaces: readonly string[];
  readonly activities: readonly string[];
  readonly capabilityRequirements: readonly string[];
  readonly automations: readonly string[];
  readonly procedures: readonly string[];
  readonly optionalAgents: readonly string[];
  readonly authorityRequirements: readonly string[];
  readonly verificationContracts: readonly string[];
  readonly integrationRequirements: readonly string[];
  readonly runtimeRequirements: readonly string[];
  readonly migrations: readonly ApplicationPackageMigration[];
  readonly compatibility: {
    readonly platformApi: { readonly minInclusive: string; readonly maxExclusive: string };
    readonly compatibleFromVersions: readonly string[];
  };
  readonly provenance: readonly string[];
  readonly signature: { readonly algorithm: string; readonly keyId: string; readonly value: string };
}

export interface OrganizationOverlay {
  readonly id: string;
  readonly basePackageId: string;
  readonly changes: Readonly<Record<string, JsonValue>>;
}

export interface ApplicationInstance {
  readonly id: string;
  readonly workspaceId: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly blueprintRef: string;
  readonly semanticObjectBindings: Readonly<Record<string, string>>;
  readonly roleBindings: Readonly<Record<string, string>>;
  readonly participantBindings: Readonly<Record<string, string>>;
  readonly integrationBindings: Readonly<Record<string, string>>;
  readonly surfaceConfiguration: Readonly<Record<string, JsonValue>>;
  readonly configuration: Readonly<Record<string, JsonValue>>;
  readonly organizationOverlay?: OrganizationOverlay;
  readonly runtimeRequirements: readonly string[];
  readonly installState: "active";
  readonly packageHistory: readonly { readonly version: string; readonly blueprintRef: string }[];
  readonly provenance: readonly string[];
}

export interface InstallApplicationInput {
  readonly instanceId: string;
  readonly workspaceId: string;
  readonly semanticObjectBindings: Readonly<Record<string, string>>;
  readonly roleBindings: Readonly<Record<string, string>>;
  readonly participantBindings: Readonly<Record<string, string>>;
  readonly integrationBindings: Readonly<Record<string, string>>;
  readonly surfaceConfiguration: Readonly<Record<string, JsonValue>>;
  readonly configuration: Readonly<Record<string, JsonValue>>;
  readonly organizationOverlay?: OrganizationOverlay;
}

export function defineApplicationPackage(input: ApplicationPackage): ApplicationPackage {
  assertPortable(input);
  const minimum = semanticVersion(input.compatibility.platformApi.minInclusive);
  const maximum = semanticVersion(input.compatibility.platformApi.maxExclusive);
  if (compareVersions(minimum, maximum) >= 0) throw new RangeError("Platform API compatibility range must increase");
  const migrations = input.migrations.map((migration) => {
    const normalized = {
      id: namespaced("migration id", migration.id, "migration:"),
      fromVersion: semanticVersion(migration.fromVersion).value,
      toVersion: semanticVersion(migration.toVersion).value,
    };
    if (compareVersions(semanticVersion(normalized.fromVersion), semanticVersion(normalized.toVersion)) >= 0) {
      throw new RangeError(`migration ${normalized.id} must increase package version`);
    }
    return normalized;
  }).sort((left, right) => left.fromVersion.localeCompare(right.fromVersion) || left.toVersion.localeCompare(right.toVersion) || left.id.localeCompare(right.id));
  if (new Set(migrations.map((migration) => migration.id)).size !== migrations.length) throw new Error("migration ids must be unique");
  return deepFreeze({
    id: namespaced("application package id", input.id, "application-package:"),
    name: requiredText("application package name", input.name),
    version: semanticVersion(input.version).value,
    blueprintRef: namespaced("AppBlueprint reference", input.blueprintRef, "app-blueprint:"),
    dependencies: input.dependencies.map((dependency) => ({
      id: namespaced("package dependency id", dependency.id),
      versionRange: requiredText("package dependency version range", dependency.versionRange),
    })).sort((left, right) => left.id.localeCompare(right.id) || left.versionRange.localeCompare(right.versionRange)),
    surfaces: normalizedList(input.surfaces),
    activities: normalizedList(input.activities),
    capabilityRequirements: normalizedList(input.capabilityRequirements),
    automations: normalizedList(input.automations),
    procedures: normalizedList(input.procedures),
    optionalAgents: normalizedList(input.optionalAgents),
    authorityRequirements: normalizedList(input.authorityRequirements),
    verificationContracts: normalizedList(input.verificationContracts),
    integrationRequirements: normalizedList(input.integrationRequirements),
    runtimeRequirements: normalizedList(input.runtimeRequirements),
    migrations,
    compatibility: {
      platformApi: { minInclusive: minimum.value, maxExclusive: maximum.value },
      compatibleFromVersions: normalizedVersions(input.compatibility.compatibleFromVersions),
    },
    provenance: normalizedNamespacedList("package provenance", input.provenance),
    signature: {
      algorithm: requiredText("signature algorithm", input.signature.algorithm),
      keyId: namespaced("signature key id", input.signature.keyId),
      value: requiredText("package signature", input.signature.value),
    },
  });
}

export function serializeApplicationPackage(value: ApplicationPackage): string {
  assertPortable(value);
  return `${stableJson(defineApplicationPackage(value))}\n`;
}

export async function writeApplicationPackage(path: string, value: ApplicationPackage): Promise<void> {
  const target = requiredText("package export path", path);
  const serialized = serializeApplicationPackage(value);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, serialized, "utf8");
}

export async function readApplicationPackage(path: string): Promise<ApplicationPackage> {
  const target = requiredText("package import path", path);
  const parsed: unknown = JSON.parse(await readFile(target, "utf8"));
  assertPortable(parsed);
  return defineApplicationPackage(asApplicationPackage(parsed));
}

export class ApplicationInstaller {
  readonly #platformApiVersion: Version;
  readonly #packages = new Map<string, Map<string, ApplicationPackage>>();
  readonly #instances = new Map<string, ApplicationInstance>();

  constructor(input: { readonly platformApiVersion: string }) {
    this.#platformApiVersion = semanticVersion(input.platformApiVersion);
  }

  install(applicationPackage: ApplicationPackage, input: InstallApplicationInput): ApplicationInstance {
    const portable = defineApplicationPackage(applicationPackage);
    this.#assertPlatformCompatible(portable);
    assertPortable(input);
    const id = namespaced("ApplicationInstance id", input.instanceId, "application-instance:");
    if (this.#instances.has(id)) throw new Error(`ApplicationInstance already exists: ${id}`);
    const workspaceId = namespaced("workspace id", input.workspaceId, "workspace:");
    const semanticObjectBindings = normalizedBindings("semantic object bindings", input.semanticObjectBindings);
    for (const [name, objectId] of Object.entries(semanticObjectBindings)) {
      if (!inBoundary(objectId, workspaceId)) {
        throw new Error(`cross-workspace semantic object binding is forbidden: ${name} -> ${objectId}`);
      }
    }
    const overlay = input.organizationOverlay === undefined ? undefined : normalizeOverlay(input.organizationOverlay, portable.id);
    this.#registerPackage(portable);
    const instance = deepFreeze({
      id,
      workspaceId,
      packageId: portable.id,
      packageVersion: portable.version,
      blueprintRef: portable.blueprintRef,
      semanticObjectBindings,
      roleBindings: normalizedBindings("role bindings", input.roleBindings),
      participantBindings: normalizedBindings("participant bindings", input.participantBindings),
      integrationBindings: normalizedBindings("integration bindings", input.integrationBindings),
      surfaceConfiguration: normalizedJsonRecord("surface configuration", input.surfaceConfiguration),
      configuration: normalizedJsonRecord("application configuration", input.configuration),
      ...(overlay === undefined ? {} : { organizationOverlay: overlay }),
      runtimeRequirements: [...portable.runtimeRequirements],
      installState: "active" as const,
      packageHistory: [],
      provenance: [...portable.provenance, portable.id, portable.blueprintRef],
    });
    this.#instances.set(id, instance);
    return instance;
  }

  get(instanceId: string): ApplicationInstance | undefined {
    return this.#instances.get(namespaced("ApplicationInstance id", instanceId, "application-instance:"));
  }

  update(input: {
    readonly instanceId: string;
    readonly nextPackage: ApplicationPackage;
    readonly completedMigrationIds: readonly string[];
  }): ApplicationInstance {
    const id = namespaced("ApplicationInstance id", input.instanceId, "application-instance:");
    const current = this.#instances.get(id);
    if (current === undefined) throw new Error(`ApplicationInstance does not exist: ${id}`);
    const next = defineApplicationPackage(input.nextPackage);
    if (next.id !== current.packageId) throw new Error("package update cannot change ApplicationPackage identity");
    if (compareVersions(semanticVersion(next.version), semanticVersion(current.packageVersion)) <= 0) {
      throw new Error("package update version must be newer than the installed version");
    }
    this.#assertPlatformCompatible(next);
    if (!next.compatibility.compatibleFromVersions.includes(current.packageVersion)) {
      throw new Error(`${next.id}@${next.version} is incompatible with installed version ${current.packageVersion}`);
    }
    const requiredMigrations = next.migrations.filter((migration) => migration.fromVersion === current.packageVersion && migration.toVersion === next.version);
    const completed = new Set(input.completedMigrationIds.map((idValue) => namespaced("completed migration id", idValue, "migration:")));
    for (const migration of requiredMigrations) {
      if (!completed.has(migration.id)) throw new Error(`required migration has not completed: ${migration.id}`);
    }
    this.#registerPackage(next);
    const updated = deepFreeze({
      ...current,
      packageVersion: next.version,
      blueprintRef: next.blueprintRef,
      runtimeRequirements: [...next.runtimeRequirements],
      packageHistory: [...current.packageHistory, { version: current.packageVersion, blueprintRef: current.blueprintRef }],
      provenance: [...current.provenance, next.id, next.blueprintRef, ...completed],
    });
    this.#instances.set(id, updated);
    return updated;
  }

  rollback(instanceId: string): ApplicationInstance {
    const id = namespaced("ApplicationInstance id", instanceId, "application-instance:");
    const current = this.#instances.get(id);
    if (current === undefined) throw new Error(`ApplicationInstance does not exist: ${id}`);
    const previous = current.packageHistory.at(-1);
    if (previous === undefined) throw new Error(`ApplicationInstance has no package version to roll back: ${id}`);
    const registered = this.#packages.get(current.packageId)?.get(previous.version);
    if (registered === undefined || registered.blueprintRef !== previous.blueprintRef) {
      throw new Error(`rollback package is unavailable: ${current.packageId}@${previous.version}`);
    }
    const rolledBack = deepFreeze({
      ...current,
      packageVersion: registered.version,
      blueprintRef: registered.blueprintRef,
      runtimeRequirements: [...registered.runtimeRequirements],
      packageHistory: current.packageHistory.slice(0, -1),
      provenance: [...current.provenance, `rollback:${registered.id}@${registered.version}`],
    });
    this.#instances.set(id, rolledBack);
    return rolledBack;
  }

  #assertPlatformCompatible(applicationPackage: ApplicationPackage): void {
    const minimum = semanticVersion(applicationPackage.compatibility.platformApi.minInclusive);
    const maximum = semanticVersion(applicationPackage.compatibility.platformApi.maxExclusive);
    if (compareVersions(this.#platformApiVersion, minimum) < 0 || compareVersions(this.#platformApiVersion, maximum) >= 0) {
      throw new Error(`${applicationPackage.id}@${applicationPackage.version} is incompatible with Platform API ${this.#platformApiVersion.value}`);
    }
  }

  #registerPackage(applicationPackage: ApplicationPackage): void {
    const versions = this.#packages.get(applicationPackage.id) ?? new Map<string, ApplicationPackage>();
    const existing = versions.get(applicationPackage.version);
    if (existing !== undefined && stableJson(existing) !== stableJson(applicationPackage)) {
      throw new Error(`ApplicationPackage version has conflicting content: ${applicationPackage.id}@${applicationPackage.version}`);
    }
    versions.set(applicationPackage.version, applicationPackage);
    this.#packages.set(applicationPackage.id, versions);
  }
}

function normalizeOverlay(value: OrganizationOverlay, packageId: string): OrganizationOverlay {
  assertPortable(value);
  const basePackageId = namespaced("overlay base package", value.basePackageId, "application-package:");
  if (basePackageId !== packageId) throw new Error("organization overlay must preserve its base package link");
  return deepFreeze({
    id: namespaced("organization overlay id", value.id, "organization-overlay:"),
    basePackageId,
    changes: normalizedJsonRecord("organization overlay changes", value.changes),
  });
}

function normalizedBindings(name: string, value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return deepFreeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [
    requiredText(`${name} name`, key),
    namespaced(`${name} value`, item),
  ] as const).sort(([left], [right]) => left.localeCompare(right))));
}

function normalizedJsonRecord(name: string, value: Readonly<Record<string, JsonValue>>): Readonly<Record<string, JsonValue>> {
  assertPortable(value);
  const entries = Object.entries(value).map(([key, item]) => [requiredText(`${name} key`, key), cloneJson(item)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return deepFreeze(Object.fromEntries(entries));
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, cloneJson(item)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
  return value;
}

const FORBIDDEN_PORTABLE_KEYS = new Set([
  "secret", "secrets", "credential", "credentials", "password", "token", "apikey", "api_key",
  "accesskey", "privatekey", "grant", "grants", "capabilitygrant", "capabilitygrants", "workspacedata",
  "workspaceauthority", "authoritybinding", "authoritybindings",
]);

function assertPortable(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertPortable(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PORTABLE_KEYS.has(key.toLocaleLowerCase("en-US"))) {
      throw new Error(`portable package cannot contain ${key}`);
    }
    assertPortable(nested);
  }
}

function asApplicationPackage(value: unknown): ApplicationPackage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("ApplicationPackage JSON must be an object");
  return value as ApplicationPackage;
}

interface Version { readonly value: string; readonly major: number; readonly minor: number; readonly patch: number }

function semanticVersion(value: string): Version {
  const normalized = requiredText("semantic version", value);
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  if (match === null) throw new TypeError(`version must use major.minor.patch: ${normalized}`);
  return { value: normalized, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareVersions(left: Version, right: Version): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function normalizedVersions(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => semanticVersion(value).value))].sort((left, right) => compareVersions(semanticVersion(left), semanticVersion(right)));
}

function normalizedList(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => requiredText("package list item", value)))].sort();
}

function normalizedNamespacedList(name: string, values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => namespaced(name, value)))].sort();
}

function inBoundary(value: string, root: string): boolean {
  return value === root || value.startsWith(`${root}/`);
}

function namespaced(name: string, value: string, prefix?: string): string {
  const normalized = requiredText(name, value);
  if (prefix === undefined ? !normalized.includes(":") : !normalized.startsWith(prefix)) {
    throw new TypeError(`${name} must be namespace-qualified`);
  }
  return normalized;
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
