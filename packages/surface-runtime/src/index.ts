export type SurfaceAudience = "internal" | "public" | "embedded";

export type SurfaceValue =
  | null
  | boolean
  | number
  | string
  | readonly SurfaceValue[]
  | { readonly [key: string]: SurfaceValue };

export interface SurfaceApplicationReference {
  readonly id: string;
  readonly workspaceId: string;
  readonly semanticObjectBindings: Readonly<Record<string, string>>;
}

export interface SurfaceWorkReference {
  readonly id: string;
  readonly workspaceId: string;
  readonly version: number;
}

export interface SurfaceViewDefinition {
  readonly binding: string;
  readonly fields: readonly string[];
  readonly readResource: string;
}

interface SurfaceDefinitionBase {
  readonly id: string;
  readonly revision: number;
  readonly view: SurfaceViewDefinition;
  readonly actionResources: readonly string[];
}

export interface InternalSurfaceDefinition extends SurfaceDefinitionBase {
  readonly audience: "internal";
  readonly inspectMode: boolean;
}

export interface ExternalSurfaceDefinition extends SurfaceDefinitionBase {
  readonly audience: "public" | "embedded";
}

export type SurfaceDefinition = InternalSurfaceDefinition | ExternalSurfaceDefinition;

export interface SurfaceInstance {
  readonly id: string;
  readonly definition: SurfaceDefinition;
  readonly workspaceId: string;
  readonly applicationInstanceId: string;
  readonly workInstanceId: string;
  readonly semanticObjectBindings: Readonly<Record<string, string>>;
}

export interface InternalSurfaceAuthorityContext {
  readonly kind: "internal";
  readonly workspaceId: string;
  readonly principalId: string;
  readonly readResources: readonly string[];
  readonly actionResources: readonly string[];
  readonly inspectModeAllowed: boolean;
  readonly internalGrantIds: readonly string[];
  readonly credentialReferences: readonly string[];
}

export interface PublicSurfaceCapabilityContext {
  readonly kind: "public" | "embedded";
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly validFrom: string;
  readonly expiresAt: string;
  readonly readResources: readonly string[];
  readonly actionResources: readonly string[];
}

export type SurfaceAuthorityContext = InternalSurfaceAuthorityContext | PublicSurfaceCapabilityContext;

export interface SurfaceObjectSnapshot {
  readonly id: string;
  readonly version: number;
  readonly values: Readonly<Record<string, SurfaceValue>>;
}

export interface RenderedSurfaceObject {
  readonly binding: string;
  readonly id: string;
  readonly version: number;
  readonly values: Readonly<Record<string, SurfaceValue>>;
}

export interface SurfaceRenderSnapshot {
  readonly surface: {
    readonly instanceId: string;
    readonly definitionId: string;
    readonly revision: number;
  };
  readonly workspaceId: string;
  readonly applicationInstanceId: string;
  readonly work: {
    readonly id: string;
    readonly version: number;
  };
  readonly objects: readonly RenderedSurfaceObject[];
  readonly session:
    | { readonly kind: "internal"; readonly principalId: string; readonly inspectMode: boolean }
    | { readonly kind: "public" | "embedded"; readonly sessionId: string; readonly expiresAt: string };
  readonly authorization: {
    readonly readResources: readonly string[];
    readonly actionResources: readonly string[];
  };
  readonly optimisticVersion: number;
}

export function defineSurfaceDefinition(input: SurfaceDefinition): SurfaceDefinition {
  const audience = surfaceAudience(input.audience);
  if (audience !== "internal" && Object.hasOwn(input, "inspectMode")) {
    throw new Error(`${audience} surfaces cannot expose inspect mode`);
  }
  const base = {
    id: prefixedId("surface definition id", input.id, "surface:"),
    revision: positiveInteger("surface revision", input.revision),
    audience,
    view: {
      binding: requiredText("surface binding", input.view.binding),
      fields: uniqueRequired("surface view fields", input.view.fields),
      readResource: requiredText("surface read resource", input.view.readResource),
    },
    actionResources: unique("surface action resources", input.actionResources),
  };
  if (audience !== "internal") {
    for (const resource of [base.view.readResource, ...base.actionResources]) {
      assertExternalResourceSafe(resource);
    }
  }
  return deepFreeze(audience === "internal"
    ? { ...base, audience, inspectMode: Boolean((input as InternalSurfaceDefinition).inspectMode) }
    : { ...base, audience });
}

export function bindSurfaceInstance(input: {
  readonly id: string;
  readonly definition: SurfaceDefinition;
  readonly application: SurfaceApplicationReference;
  readonly work: SurfaceWorkReference;
}): SurfaceInstance {
  const definition = defineSurfaceDefinition(input.definition);
  const workspaceId = prefixedId("workspace id", input.application.workspaceId, "workspace:");
  const applicationInstanceId = prefixedId(
    "ApplicationInstance id",
    input.application.id,
    "application-instance:",
  );
  const workInstanceId = prefixedId("WorkInstance id", input.work.id, "work-instance:");
  if (input.work.workspaceId !== workspaceId) {
    throw new Error("surface App and Work references must belong to the same workspace");
  }
  positiveInteger("WorkInstance version", input.work.version);
  const semanticObjectBindings = sortedBindings(input.application.semanticObjectBindings);
  const objectId = semanticObjectBindings[definition.view.binding];
  if (objectId === undefined) {
    throw new Error(`surface binding does not exist on ApplicationInstance: ${definition.view.binding}`);
  }
  for (const [binding, semanticObjectId] of Object.entries(semanticObjectBindings)) {
    if (!inBoundary(semanticObjectId, workspaceId)) {
      throw new Error(`surface semantic object is outside workspace: ${binding}`);
    }
  }
  return deepFreeze({
    id: prefixedId("SurfaceInstance id", input.id, "surface-instance:"),
    definition,
    workspaceId,
    applicationInstanceId,
    workInstanceId,
    semanticObjectBindings,
  });
}

export function renderSurface(input: {
  readonly instance: SurfaceInstance;
  readonly work: SurfaceWorkReference;
  readonly objects: readonly SurfaceObjectSnapshot[];
  readonly expectedWorkVersion: number;
  readonly now: string;
  readonly authority?: SurfaceAuthorityContext;
}): SurfaceRenderSnapshot {
  const authority = input.authority;
  if (authority === undefined) throw new Error("surface authority context is required");
  const now = normalizeInstant(input.now);
  const expectedWorkVersion = positiveInteger("expected WorkInstance version", input.expectedWorkVersion);
  validateRenderScope(input.instance, input.work, authority);
  if (input.work.version !== expectedWorkVersion) {
    throw new Error(`optimistic WorkInstance version conflict: expected ${expectedWorkVersion}, received ${input.work.version}`);
  }
  validateAuthority(input.instance.definition, authority, now);

  const objectId = input.instance.semanticObjectBindings[input.instance.definition.view.binding];
  if (objectId === undefined) throw new Error("surface binding is unavailable");
  const objects = normalizedObjects(input.objects, input.instance.workspaceId);
  const object = objects.get(objectId);
  if (object === undefined) throw new Error(`shared semantic object is unavailable: ${objectId}`);
  const values = Object.fromEntries(input.instance.definition.view.fields
    .filter((field) => Object.hasOwn(object.values, field))
    .map((field) => [field, cloneValue(object.values[field] as SurfaceValue)]));
  if (authority.kind !== "internal") assertExternalSelectedDataSafe(values);
  const readResources = uniqueRequired("authorized read resources", authority.readResources);
  const actionResources = unique("authorized action resources", authority.actionResources);
  const snapshot: SurfaceRenderSnapshot = {
    surface: {
      instanceId: input.instance.id,
      definitionId: input.instance.definition.id,
      revision: input.instance.definition.revision,
    },
    workspaceId: input.instance.workspaceId,
    applicationInstanceId: input.instance.applicationInstanceId,
    work: { id: input.instance.workInstanceId, version: input.work.version },
    objects: [{
      binding: input.instance.definition.view.binding,
      id: object.id,
      version: object.version,
      values,
    }],
    session: authority.kind === "internal"
      ? {
          kind: "internal",
          principalId: prefixedId("principal id", authority.principalId, "principal:"),
          inspectMode: input.instance.definition.audience === "internal"
            && input.instance.definition.inspectMode
            && authority.inspectModeAllowed,
        }
      : {
          kind: authority.kind,
          sessionId: namespaced("public surface session id", authority.sessionId),
          expiresAt: normalizeInstant(authority.expiresAt),
        },
    authorization: { readResources, actionResources },
    optimisticVersion: expectedWorkVersion,
  };
  return deepFreeze(snapshot);
}

function validateRenderScope(
  instance: SurfaceInstance,
  work: SurfaceWorkReference,
  authority: SurfaceAuthorityContext,
): void {
  const workspaceId = prefixedId("authority workspace id", authority.workspaceId, "workspace:");
  if (workspaceId !== instance.workspaceId) throw new Error("surface authority workspace mismatch");
  if (work.workspaceId !== instance.workspaceId) throw new Error("render WorkInstance workspace mismatch");
  if (work.id !== instance.workInstanceId) throw new Error("render WorkInstance identity mismatch");
  positiveInteger("WorkInstance version", work.version);
  if (authority.kind !== instance.definition.audience) {
    throw new Error(`surface requires an explicit ${instance.definition.audience} session`);
  }
}

function validateAuthority(
  definition: SurfaceDefinition,
  authority: SurfaceAuthorityContext,
  now: string,
): void {
  const declaredReads = [definition.view.readResource];
  const declaredActions = definition.actionResources;
  const reads = uniqueRequired("authorized read resources", authority.readResources);
  const actions = unique("authorized action resources", authority.actionResources);
  assertSubset("read", reads, declaredReads);
  assertSubset("action", actions, declaredActions);
  if (!reads.includes(definition.view.readResource)) {
    throw new Error(`surface read is not authorized: ${definition.view.readResource}`);
  }
  if (authority.kind === "internal") return;
  assertNoPrivateAuthorityFields(authority);
  const validFrom = normalizeInstant(authority.validFrom);
  const expiresAt = normalizeInstant(authority.expiresAt);
  if (expiresAt <= validFrom) throw new RangeError("public surface capability expiry must follow validFrom");
  if (now < validFrom || now >= expiresAt) throw new Error("public surface capability context is expired or not yet valid");
}

function assertNoPrivateAuthorityFields(authority: PublicSurfaceCapabilityContext): void {
  const forbidden = /(capabilityid|grant|credential|inspectmode)/i;
  for (const key of Object.keys(authority)) {
    if (forbidden.test(key)) throw new Error(`public surface capability context cannot contain ${key}`);
  }
}

function normalizedObjects(
  values: readonly SurfaceObjectSnapshot[],
  workspaceId: string,
): ReadonlyMap<string, SurfaceObjectSnapshot> {
  const result = new Map<string, SurfaceObjectSnapshot>();
  for (const value of [...values].sort((left, right) => left.id.localeCompare(right.id))) {
    const id = namespaced("semantic object id", value.id);
    if (!inBoundary(id, workspaceId)) throw new Error(`semantic object is outside workspace: ${id}`);
    if (result.has(id)) throw new Error(`duplicate semantic object snapshot: ${id}`);
    const object = deepFreeze({
      id,
      version: nonNegativeInteger("semantic object version", value.version),
      values: cloneRecord(value.values),
    });
    result.set(id, object);
  }
  return result;
}

function sortedBindings(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return deepFreeze(Object.fromEntries(Object.entries(value)
    .map(([binding, id]) => [requiredText("semantic object binding", binding), namespaced("semantic object id", id)] as const)
    .sort(([left], [right]) => left.localeCompare(right))));
}

function cloneRecord(value: Readonly<Record<string, SurfaceValue>>): Readonly<Record<string, SurfaceValue>> {
  return deepFreeze(Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [requiredText("surface value field", key), cloneValue(item)] as const)
    .sort(([left], [right]) => left.localeCompare(right))));
}

function cloneValue(value: SurfaceValue): SurfaceValue {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (value !== null && typeof value === "object") {
    return cloneRecord(value as Readonly<Record<string, SurfaceValue>>);
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("surface numbers must be finite");
  return value;
}

function assertSubset(name: string, actual: readonly string[], declared: readonly string[]): void {
  const undeclared = actual.find((item) => !declared.includes(item));
  if (undeclared !== undefined) throw new Error(`undeclared surface ${name} resource: ${undeclared}`);
}

function assertExternalResourceSafe(resource: string): void {
  if (/(?:capability:|credential-ref:|grant|inspect)/i.test(resource)) {
    throw new Error(`external surface resource cannot reveal internal authority: ${resource}`);
  }
}

function assertExternalSelectedDataSafe(value: SurfaceValue): void {
  if (Array.isArray(value)) {
    for (const item of value) assertExternalSelectedDataSafe(item);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.toLocaleLowerCase("en-US").replaceAll(/[^a-z0-9]/g, "");
      if (/(?:capabilityid|credentialref|grant|credential|secret|token|privatekey|inspectmode)/.test(normalizedKey)) {
        throw new Error(`external surface selected data contains private authority material: ${key}`);
      }
      assertExternalSelectedDataSafe(nested);
    }
    return;
  }
  if (typeof value === "string" && containsExplicitPrivateMarker(value)) {
    throw new Error("external surface selected data contains private authority material");
  }
}

function containsExplicitPrivateMarker(value: string): boolean {
  if (/(?:capability(?:-grant)?:|credential(?:-ref)?:)/i.test(value)) return true;
  if (/(?:^|[\s([{,;])(?:secret|grant|private[-_]?key)[:=][^\s,;]+/i.test(value)) return true;
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(value)) return true;
  const bearerToken = /(?:^|[\s([{,;])bearer\s+([a-z0-9._~+/=-]{8,})(?=$|[\s,;])/i.exec(value)?.[1];
  return bearerToken !== undefined
    && (bearerToken.length >= 24 || /[0-9._~+/=-]/.test(bearerToken));
}

function unique(name: string, values: readonly string[]): readonly string[] {
  const normalized = values.map((value) => requiredText(name, value)).sort();
  if (new Set(normalized).size !== normalized.length) throw new Error(`${name} must not contain duplicates`);
  return Object.freeze(normalized);
}

function uniqueRequired(name: string, values: readonly string[]): readonly string[] {
  const normalized = unique(name, values);
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function surfaceAudience(value: SurfaceAudience): SurfaceAudience {
  if (!["internal", "public", "embedded"].includes(value)) throw new TypeError(`unsupported surface audience: ${value}`);
  return value;
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return value;
}

function prefixedId(name: string, value: string, prefix: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${name} must start with ${prefix}`);
  return normalized;
}

function namespaced(name: string, value: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.includes(":")) throw new TypeError(`${name} must be namespace-qualified`);
  return normalized;
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp must include an explicit UTC offset: ${value}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return date.toISOString();
}

function inBoundary(value: string, root: string): boolean {
  return value === root || value.startsWith(`${root}/`);
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
