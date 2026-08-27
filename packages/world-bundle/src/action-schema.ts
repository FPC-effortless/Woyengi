import type { WorldActionDescriptor } from "../../operational-spec/src/index.ts";
import type { PortableWorldBundle, PortableWorldMember } from "./index.ts";

export const WORLD_BUNDLE_ACTION_SCHEMA_KIND = "ACTION_SCHEMA" as const;
export const WORLD_BUNDLE_ACTION_SCHEMA_CONTRACT = "woyengi.world-bundle.action-schema.v0.1" as const;
export const WORLD_BUNDLE_JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema" as const;

const JSON_SCHEMA_TYPES = ["null", "boolean", "object", "array", "number", "string", "integer"] as const;
type JsonSchemaType = typeof JSON_SCHEMA_TYPES[number];

type ActionSchemaArtifact = Pick<PortableWorldBundle, "bundle" | "members">;

export class WorldActionSchemaConformanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldActionSchemaConformanceError";
  }
}

export interface WorldActionSchemaConformanceReport {
  readonly conformant: boolean;
  readonly errors: readonly string[];
}

export function verifyWorldActionSchemaConformance(
  artifact: ActionSchemaArtifact,
): WorldActionSchemaConformanceReport {
  try {
    assertWorldActionSchemaConformance(artifact);
    return { conformant: true, errors: [] };
  } catch (error) {
    return {
      conformant: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Validate the additive, public, language-neutral action-schema profile without
 * widening the frozen WorldActionDescriptor contract.
 */
export function assertWorldActionSchemaConformance(artifact: ActionSchemaArtifact): void {
  const schemaMembers = artifact.members.filter((member) => member.kind === WORLD_BUNDLE_ACTION_SCHEMA_KIND);
  const bindingByAction = new Map<string, PortableWorldMember>();
  const privateRefs = privateReferenceSet(artifact);

  for (const member of schemaMembers) {
    if (member.partition !== "public") fail(`ACTION_SCHEMA must be public: ${member.id}`);
    const payload = validateActionSchemaPayload(member, privateRefs);
    const action = artifact.bundle.public.actionSurface.find((candidate) => candidate.id === payload.actionRef);
    if (action === undefined) fail(`${member.id}.actionRef references unknown public action ${payload.actionRef}`);
    if (bindingByAction.has(payload.actionRef)) {
      fail(`duplicate ACTION_SCHEMA binding for public action ${payload.actionRef}`);
    }
    assertInputSchemaMatchesAction(payload.inputSchema, action, `${member.id}.inputSchema`);
    bindingByAction.set(payload.actionRef, member);
  }

  for (const action of artifact.bundle.public.actionSurface) {
    if (!bindingByAction.has(action.id)) fail(`public action ${action.id} has no ACTION_SCHEMA binding`);
  }
}

interface ValidatedActionSchemaPayload {
  readonly actionRef: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
}

function validateActionSchemaPayload(
  member: PortableWorldMember,
  privateRefs: ReadonlySet<string>,
): ValidatedActionSchemaPayload {
  const path = `member ${member.id} action schema payload`;
  const payload = exactRecord(member.payload, ["actionRef", "contract", "inputSchema", "outputSchema"], path);
  equal(payload.contract, WORLD_BUNDLE_ACTION_SCHEMA_CONTRACT, `${member.id}.contract`);
  const actionRef = text(payload.actionRef, `${member.id}.actionRef`);
  if (!actionRef.startsWith("world-action:")) fail(`${member.id}.actionRef must start with world-action:`);

  const inputSchema = validateJsonSchema(payload.inputSchema, `${member.id}.inputSchema`, true, privateRefs);
  if (inputSchema.type !== "object") fail(`${member.id}.inputSchema root type must be object`);
  const outputSchema = validateJsonSchema(payload.outputSchema, `${member.id}.outputSchema`, true, privateRefs);

  return { actionRef, inputSchema, outputSchema };
}

function assertInputSchemaMatchesAction(
  schema: Record<string, unknown>,
  action: WorldActionDescriptor,
  path: string,
): void {
  const properties = schema.properties as Record<string, unknown>;
  const actual = Object.keys(properties).sort(compareText);
  const expected = [...action.parameterNames].sort(compareText);
  if (stableJson(actual) !== stableJson(expected)) {
    fail(`${path}.properties must exactly match ${action.id}.parameterNames (${expected.join(", ")})`);
  }
}

function validateJsonSchema(
  value: unknown,
  path: string,
  root: boolean,
  privateRefs: ReadonlySet<string>,
): Record<string, unknown> {
  const allowedKeys = root
    ? ["$schema", "additionalProperties", "items", "properties", "required", "type"]
    : ["additionalProperties", "items", "properties", "required", "type"];
  const schema = exactRecord(
    value,
    allowedKeys,
    path,
    allowedKeys.filter((key) => !["type", ...(root ? ["$schema"] : [])].includes(key)),
  );

  if (root) equal(schema.$schema, WORLD_BUNDLE_JSON_SCHEMA_DIALECT, `${path}.$schema`);
  const type = jsonSchemaType(schema.type, `${path}.type`);

  if (type === "object") {
    if (!("properties" in schema)) fail(`${path}.properties is required for object schemas`);
    if (!("required" in schema)) fail(`${path}.required is required for object schemas`);
    if (!("additionalProperties" in schema)) fail(`${path}.additionalProperties is required for object schemas`);
    if (schema.additionalProperties !== false) fail(`${path}.additionalProperties must be false`);
    if ("items" in schema) fail(`${path}.items is not valid for object schemas`);

    const properties = jsonObject(schema.properties, `${path}.properties`);
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      safePropertyName(propertyName, `${path}.properties`);
      validateJsonSchema(propertySchema, `${path}.properties.${propertyName}`, false, privateRefs);
    }

    const required = stringArray(schema.required, `${path}.required`);
    assertCanonicalStringSet(required, `${path}.required`);
    for (const requiredName of required) {
      if (!(requiredName in properties)) fail(`${path}.required references unknown property ${requiredName}`);
    }
  } else {
    for (const key of ["properties", "required", "additionalProperties"] as const) {
      if (key in schema) fail(`${path}.${key} is only valid for object schemas`);
    }
    if (type === "array") {
      if (!("items" in schema)) fail(`${path}.items is required for array schemas`);
      validateJsonSchema(schema.items, `${path}.items`, false, privateRefs);
    } else if ("items" in schema) {
      fail(`${path}.items is only valid for array schemas`);
    }
  }

  assertNoPrivateSchemaSemantics(schema, path, privateRefs);
  return schema;
}

function assertNoPrivateSchemaSemantics(value: unknown, path: string, privateRefs: ReadonlySet<string>): void {
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (privateRefs.has(value)
      || /^(?:private|evaluator-private|sealed-private):\/\//.test(normalized)
      || /^(?:private-(?:assertion|invariant|effect|evidence|byte)|hidden-effect|oracle):/.test(normalized)) {
      fail(`${path} contains evaluator-private schema value ${value}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPrivateSchemaSemantics(entry, `${path}[${index}]`, privateRefs));
    return;
  }
  if (!isRecord(value)) fail(`${path} must be JSON-compatible`);
  for (const [key, nested] of Object.entries(value)) {
    const token = normalizedToken(key);
    if (sensitiveSchemaKey(token)) fail(`${path} contains evaluator-private schema field ${key}`);
    assertNoPrivateSchemaSemantics(nested, `${path}.${key}`, privateRefs);
  }
}

function sensitiveSchemaKey(token: string): boolean {
  return token.startsWith("private")
    || token.includes("evaluator")
    || token.includes("oracle")
    || token.includes("hiddeneffect")
    || token.includes("hiddentransition")
    || token.includes("targetassertion")
    || ["targetanswer", "targetanswers", "answerkey", "correctanswer", "correctanswers", "targetstate"].includes(token);
}

function privateReferenceSet(artifact: ActionSchemaArtifact): ReadonlySet<string> {
  const partition = artifact.bundle.privateEvaluator;
  if (partition === undefined) return new Set();
  return new Set([
    ...partition.targetAssertionRefs,
    ...partition.invariantRefs,
    ...partition.hiddenEffectRefs,
    ...partition.evidenceLocatorRefs,
  ]);
}

function jsonSchemaType(value: unknown, path: string): JsonSchemaType {
  const type = text(value, path);
  if (!(JSON_SCHEMA_TYPES as readonly string[]).includes(type)) fail(`${path} has unsupported JSON Schema type ${type}`);
  return type as JsonSchemaType;
}

function jsonObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path} must be a JSON object`);
  return value;
}

function safePropertyName(value: string, path: string): void {
  if (value.trim().length === 0 || value !== value.trim()) fail(`${path} contains an invalid property name`);
  if (value === "__proto__" || value === "prototype" || value === "constructor") {
    fail(`${path} contains unsafe property name ${value}`);
  }
  const token = normalizedToken(value);
  if (sensitiveSchemaKey(token)) fail(`${path} contains evaluator-private schema property ${value}`);
}

function assertCanonicalStringSet(values: readonly string[], path: string): void {
  const normalized = [...new Set(values)].sort(compareText);
  if (stableJson(values) !== stableJson(normalized)) {
    fail(`${path} must be unique and lexicographically sorted`);
  }
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value.map((entry, index) => text(entry, `${path}[${index}]`));
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path} must be an object`);
  const allowed = new Set(allowedKeys);
  const optional = new Set(optionalKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path} contains unknown field ${key}`);
  }
  for (const key of allowedKeys) {
    if (!optional.has(key) && !(key in value)) fail(`${path} is missing required field ${key}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${path} must be a non-empty string`);
  return value;
}

function equal(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) fail(`${path} must equal ${String(expected)}`);
}

function normalizedToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fail(message: string): never {
  throw new WorldActionSchemaConformanceError(message);
}
