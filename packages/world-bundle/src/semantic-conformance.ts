import type { WorldActionDescriptor } from "../../operational-spec/src/index.ts";
import type { PortableWorldBundle, PortableWorldMember } from "./index.ts";

export const WORLD_BUNDLE_PUBLIC_TASK_CONTRACT = "woyengi.world-bundle.public-task.v0.1" as const;
export const WORLD_BUNDLE_PUBLIC_EVIDENCE_CONTRACT = "woyengi.world-bundle.public-evidence.v0.1" as const;
export const WORLD_BUNDLE_PRIVATE_EVALUATOR_CONTRACT = "woyengi.world-bundle.private-evaluator.v0.1" as const;

export type SemanticWorldMemberKind = "SEMANTIC_TASK" | "EVIDENCE_RECORD" | "EVALUATOR_ORACLE";

export class WorldBundleSemanticConformanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldBundleSemanticConformanceError";
  }
}

export interface WorldBundleSemanticConformanceReport {
  readonly conformant: boolean;
  readonly errors: readonly string[];
}

export function verifyWorldBundleSemanticConformance(
  artifact: PortableWorldBundle,
): WorldBundleSemanticConformanceReport {
  try {
    assertWorldBundleSemanticConformance(artifact);
    return { conformant: true, errors: [] };
  } catch (error) {
    return {
      conformant: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Validate the portable semantic profile used by cross-language operational-world
 * consumers. The base artifact format remains generic JSON, but these high-value
 * member kinds are exact-schema, fail-closed contracts rather than heuristic blobs.
 */
export function assertWorldBundleSemanticConformance(artifact: PortableWorldBundle): void {
  const supportedKinds = new Set<SemanticWorldMemberKind>([
    "SEMANTIC_TASK",
    "EVIDENCE_RECORD",
    "EVALUATOR_ORACLE",
  ]);
  for (const member of artifact.members) {
    if (!supportedKinds.has(member.kind as SemanticWorldMemberKind)) {
      fail(`semantic profile does not recognize member kind ${member.kind} (${member.id})`);
    }
  }

  const taskMembers = artifact.members.filter((member) => member.kind === "SEMANTIC_TASK");
  if (taskMembers.length !== 1) fail(`semantic profile requires exactly one SEMANTIC_TASK member; found ${taskMembers.length}`);
  const taskMember = taskMembers[0]!;
  if (taskMember.partition !== "public") fail("SEMANTIC_TASK must be public");
  const task = validatePublicTask(taskMember, artifact);

  const evidenceMembers = artifact.members.filter((member) => member.kind === "EVIDENCE_RECORD");
  const evidenceIds = new Set<string>();
  for (const member of evidenceMembers) {
    if (member.partition !== "public") fail(`EVIDENCE_RECORD must be public: ${member.id}`);
    const evidence = validatePublicEvidence(member, artifact);
    if (evidenceIds.has(evidence.recordId)) fail(`duplicate public evidence record identity: ${evidence.recordId}`);
    evidenceIds.add(evidence.recordId);
  }

  for (const evidenceRef of task.evidenceRequirements) {
    if (!artifact.bundle.public.observationRefs.includes(evidenceRef)) {
      fail(`required evidence ${evidenceRef} is not declared as an agent-visible public observation`);
    }
    if (!evidenceIds.has(evidenceRef)) {
      fail(`required evidence ${evidenceRef} has no materialized public EVIDENCE_RECORD`);
    }
  }

  const evaluatorMembers = artifact.members.filter((member) => member.kind === "EVALUATOR_ORACLE");
  if (artifact.bundle.privateEvaluator === undefined) {
    if (evaluatorMembers.length !== 0) fail("EVALUATOR_ORACLE requires privateEvaluator metadata");
    return;
  }
  if (evaluatorMembers.length !== 1) {
    fail(`privateEvaluator metadata requires exactly one EVALUATOR_ORACLE member; found ${evaluatorMembers.length}`);
  }
  const evaluatorMember = evaluatorMembers[0]!;
  if (evaluatorMember.partition !== "private-evaluator") fail("EVALUATOR_ORACLE must be private-evaluator");
  validatePrivateEvaluator(evaluatorMember, artifact);
}

function validatePublicTask(member: PortableWorldMember, artifact: PortableWorldBundle): {
  readonly evidenceRequirements: readonly string[];
} {
  const payload = exactRecord(member.payload, [
    "actions",
    "actors",
    "artifactDescriptors",
    "budgets",
    "constraints",
    "contract",
    "evidenceRequirements",
    "objective",
    "sourceSpecRef",
    "sourceSpecVersion",
    "successAssertions",
  ], `member ${member.id} public task payload`);
  equal(payload.contract, WORLD_BUNDLE_PUBLIC_TASK_CONTRACT, `${member.id}.contract`);
  equal(payload.objective, artifact.bundle.public.objective, `${member.id}.objective`);
  equal(payload.sourceSpecRef, artifact.bundle.sourceSpecRef, `${member.id}.sourceSpecRef`);
  equal(payload.sourceSpecVersion, artifact.bundle.sourceSpecVersion, `${member.id}.sourceSpecVersion`);

  if (stableJson(payload.actions) !== stableJson(artifact.bundle.public.actionSurface)) {
    fail(`${member.id}.actions must exactly match bundle.public.actionSurface`);
  }
  if (stableJson(payload.artifactDescriptors) !== stableJson(artifact.bundle.public.assetDescriptors)) {
    fail(`${member.id}.artifactDescriptors must exactly match bundle.public.assetDescriptors`);
  }

  const actors = arrayOfRecords(payload.actors, ["id", "role"], `${member.id}.actors`);
  const actorRoles = actors.map((actor, index) => text(actor.role, `${member.id}.actors[${index}].role`));
  if (stableJson(actorRoles) !== stableJson(artifact.bundle.public.actorRoles)) {
    fail(`${member.id}.actors roles must exactly match bundle.public.actorRoles`);
  }

  const actions = array(payload.actions, `${member.id}.actions`);
  for (let index = 0; index < actions.length; index += 1) {
    validatePublicAction(actions[index], artifact.bundle.public.actionSurface[index], `${member.id}.actions[${index}]`);
  }

  const constraints = arrayOfRecords(payload.constraints, ["id", "statement"], `${member.id}.constraints`);
  for (let index = 0; index < constraints.length; index += 1) {
    text(constraints[index]!.id, `${member.id}.constraints[${index}].id`);
    text(constraints[index]!.statement, `${member.id}.constraints[${index}].statement`);
  }

  const budgets = arrayOfRecords(
    payload.budgets,
    ["currency", "maximumAttempts", "maximumCost", "outcomeContractRef"],
    `${member.id}.budgets`,
  );
  for (let index = 0; index < budgets.length; index += 1) {
    const budget = budgets[index]!;
    text(budget.currency, `${member.id}.budgets[${index}].currency`);
    nonNegativeNumber(budget.maximumCost, `${member.id}.budgets[${index}].maximumCost`);
    positiveInteger(budget.maximumAttempts, `${member.id}.budgets[${index}].maximumAttempts`);
    text(budget.outcomeContractRef, `${member.id}.budgets[${index}].outcomeContractRef`);
  }

  const successAssertions = arrayOfRecords(
    payload.successAssertions,
    ["description", "id"],
    `${member.id}.successAssertions`,
  );
  for (let index = 0; index < successAssertions.length; index += 1) {
    text(successAssertions[index]!.id, `${member.id}.successAssertions[${index}].id`);
    text(successAssertions[index]!.description, `${member.id}.successAssertions[${index}].description`);
  }

  return { evidenceRequirements: stringArray(payload.evidenceRequirements, `${member.id}.evidenceRequirements`) };
}

function validatePublicEvidence(
  member: PortableWorldMember,
  artifact: PortableWorldBundle,
): { readonly recordId: string } {
  const payload = exactRecord(member.payload, [
    "contract",
    "fields",
    "objectId",
    "provenanceRefs",
    "recordId",
    "recordType",
    "searchableText",
    "systemRef",
  ], `member ${member.id} public evidence payload`);
  equal(payload.contract, WORLD_BUNDLE_PUBLIC_EVIDENCE_CONTRACT, `${member.id}.contract`);
  const recordId = text(payload.recordId, `${member.id}.recordId`);
  if (!recordId.startsWith("evidence:")) fail(`${member.id}.recordId must start with evidence:`);
  text(payload.systemRef, `${member.id}.systemRef`);
  text(payload.recordType, `${member.id}.recordType`);
  text(payload.objectId, `${member.id}.objectId`);
  text(payload.searchableText, `${member.id}.searchableText`);
  exactJsonRecord(payload.fields, `${member.id}.fields`);
  const provenanceRefs = stringArray(payload.provenanceRefs, `${member.id}.provenanceRefs`);
  if (!provenanceRefs.includes(artifact.bundle.sourceSpecRef)) {
    fail(`${member.id}.provenanceRefs must include source OperationalSystemSpec ${artifact.bundle.sourceSpecRef}`);
  }
  return { recordId };
}

function validatePrivateEvaluator(member: PortableWorldMember, artifact: PortableWorldBundle): void {
  const payload = exactRecord(member.payload, [
    "contract",
    "evidenceLocators",
    "hiddenEffects",
    "invariants",
    "targetAssertions",
  ], `member ${member.id} private evaluator payload`);
  equal(payload.contract, WORLD_BUNDLE_PRIVATE_EVALUATOR_CONTRACT, `${member.id}.contract`);

  const targets = array(payload.targetAssertions, `${member.id}.targetAssertions`).map((entry, index) =>
    validateStateAssertion(entry, `${member.id}.targetAssertions[${index}]`, true));
  const invariants = array(payload.invariants, `${member.id}.invariants`).map((entry, index) =>
    validateInvariant(entry, `${member.id}.invariants[${index}]`));
  const hiddenEffects = array(payload.hiddenEffects, `${member.id}.hiddenEffects`).map((entry, index) =>
    validateHiddenEffect(entry, artifact, `${member.id}.hiddenEffects[${index}]`));
  const locators = array(payload.evidenceLocators, `${member.id}.evidenceLocators`).map((entry, index) =>
    validateEvidenceLocator(entry, `${member.id}.evidenceLocators[${index}]`));

  const privateEvaluator = artifact.bundle.privateEvaluator!;
  exactReferenceSet(targets.map((entry) => entry.id), privateEvaluator.targetAssertionRefs, "target assertions");
  exactReferenceSet(invariants.map((entry) => entry.id), privateEvaluator.invariantRefs, "invariants");
  exactReferenceSet(hiddenEffects.map((entry) => entry.id), privateEvaluator.hiddenEffectRefs, "hidden effects");
  exactReferenceSet(locators.map((entry) => entry.ref), privateEvaluator.evidenceLocatorRefs, "evidence locators");
}

function validateStateAssertion(value: unknown, path: string, requireId: boolean): { readonly id: string } {
  const allowed = requireId ? ["id", "operator", "path", "tolerance", "value"] : ["operator", "path", "tolerance", "value"];
  const record = exactRecord(value, allowed, path, ["tolerance"]);
  const id = requireId ? text(record.id, `${path}.id`) : "";
  const statePath = text(record.path, `${path}.path`);
  if (!statePath.includes(".")) fail(`${path}.path must contain object.field identity`);
  const operator = text(record.operator, `${path}.operator`);
  if (!["EQUALS", "EQUAL", "NOT_EQUALS", "NOT_EQUAL", "LESS_THAN", "LESS_THAN_OR_EQUAL", "GREATER_THAN", "GREATER_THAN_OR_EQUAL", "CONTAINS", "IN"].includes(operator)) {
    fail(`${path}.operator is unsupported: ${operator}`);
  }
  if (!("value" in record)) fail(`${path}.value is required`);
  if (record.tolerance !== undefined) nonNegativeNumber(record.tolerance, `${path}.tolerance`);
  return { id };
}

function validateInvariant(value: unknown, path: string): { readonly id: string } {
  const record = exactRecord(value, ["assertion", "id", "scope", "severity", "statement"], path);
  const id = text(record.id, `${path}.id`);
  text(record.statement, `${path}.statement`);
  const severity = text(record.severity, `${path}.severity`);
  if (!["low", "medium", "high", "critical"].includes(severity)) fail(`${path}.severity is invalid: ${severity}`);
  const scope = text(record.scope, `${path}.scope`);
  if (scope !== "final" && scope !== "always") fail(`${path}.scope is invalid: ${scope}`);
  validateStateAssertion(record.assertion, `${path}.assertion`, false);
  return { id };
}

function validateHiddenEffect(
  value: unknown,
  artifact: PortableWorldBundle,
  path: string,
): { readonly id: string } {
  const record = exactRecord(value, ["actionRef", "id", "transition"], path);
  const id = text(record.id, `${path}.id`);
  const actionRef = text(record.actionRef, `${path}.actionRef`);
  if (!artifact.bundle.public.actionSurface.some((action) => action.id === actionRef)) {
    fail(`${path}.actionRef must name a declared public action: ${actionRef}`);
  }
  const transition = exactRecord(record.transition, [
    "blockedObservableResult",
    "consequenceSeverity",
    "emittedSideEffects",
    "forbidden",
    "observableResult",
    "requiredParameters",
    "requiredPriorActions",
    "requiredState",
    "setState",
  ], `${path}.transition`);
  exactJsonRecord(transition.requiredParameters, `${path}.transition.requiredParameters`);
  array(transition.requiredState, `${path}.transition.requiredState`).forEach((entry, index) =>
    validateStateAssertion(entry, `${path}.transition.requiredState[${index}]`, false));
  stringArray(transition.requiredPriorActions, `${path}.transition.requiredPriorActions`).forEach((prior) => {
    if (!artifact.bundle.public.actionSurface.some((action) => action.id === prior)) {
      fail(`${path}.transition.requiredPriorActions references unknown action ${prior}`);
    }
  });
  exactJsonRecord(transition.setState, `${path}.transition.setState`);
  exactJsonRecord(transition.observableResult, `${path}.transition.observableResult`);
  exactJsonRecord(transition.blockedObservableResult, `${path}.transition.blockedObservableResult`);
  stringArray(transition.emittedSideEffects, `${path}.transition.emittedSideEffects`);
  if (typeof transition.forbidden !== "boolean") fail(`${path}.transition.forbidden must be boolean`);
  const severity = nonNegativeNumber(transition.consequenceSeverity, `${path}.transition.consequenceSeverity`);
  if (severity > 1) fail(`${path}.transition.consequenceSeverity must be <= 1`);
  return { id };
}

function validateEvidenceLocator(value: unknown, path: string): { readonly ref: string } {
  const record = exactRecord(value, ["locator", "ref"], path);
  const ref = text(record.ref, `${path}.ref`);
  const locator = text(record.locator, `${path}.locator`);
  if (!/^(?:private|evaluator-private|sealed-private):\/\//.test(locator)) {
    fail(`${path}.locator must use an evaluator-private locator scheme`);
  }
  return { ref };
}

function validatePublicAction(value: unknown, expected: WorldActionDescriptor | undefined, path: string): void {
  if (expected === undefined) fail(`${path} has no corresponding bundle public action`);
  const record = exactRecord(value, ["cost", "id", "kind", "name", "parameterNames", "systemRef"], path, ["cost"]);
  if (stableJson(record) !== stableJson(expected)) fail(`${path} must exactly match its bundle public action`);
}

function exactReferenceSet(actual: readonly string[], expected: readonly string[], label: string): void {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (stableJson(normalizedActual) !== stableJson(normalizedExpected)) {
    fail(`private evaluator ${label} materialization must exactly match metadata references`);
  }
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value;
}

function arrayOfRecords(value: unknown, keys: readonly string[], path: string): readonly Record<string, unknown>[] {
  return array(value, path).map((entry, index) => exactRecord(entry, keys, `${path}[${index}]`));
}

function stringArray(value: unknown, path: string): readonly string[] {
  return array(value, path).map((entry, index) => text(entry, `${path}[${index}]`));
}

function exactJsonRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path} must be a JSON object`);
  for (const [key, nested] of Object.entries(value)) validateJsonValue(nested, `${path}.${key}`);
  return value;
}

function validateJsonValue(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonValue(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) fail(`${path} must be JSON-compatible`);
  for (const [key, nested] of Object.entries(value)) validateJsonValue(nested, `${path}.${key}`);
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

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${path} must be a finite non-negative number`);
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) fail(`${path} must be a positive integer`);
  return value;
}

function equal(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) fail(`${path} must equal ${String(expected)}`);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fail(message: string): never {
  throw new WorldBundleSemanticConformanceError(message);
}
