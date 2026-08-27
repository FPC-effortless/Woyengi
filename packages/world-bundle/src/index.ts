import { createHash } from "node:crypto";

import {
  defineWorldBundle,
  type OperationalValue,
  type WorldBundle,
  type WorldBundleInput,
  type WorldBundlePartitionMember,
} from "../../operational-spec/src/index.ts";

export type WorldBundlePartition = WorldBundlePartitionMember["partition"];

export interface PortableWorldMemberInput {
  readonly id: string;
  readonly partition: WorldBundlePartition;
  readonly kind: string;
  readonly payload: OperationalValue;
}

export interface PortableWorldMember extends PortableWorldMemberInput {
  readonly contentHash: `sha256:${string}`;
}

export interface PortableWorldBundleInput {
  readonly bundle: WorldBundleInput;
  readonly members: readonly PortableWorldMemberInput[];
}

export interface PortableWorldBundle {
  readonly contract: "woyengi.world-bundle-artifact.v0.1";
  readonly artifactId: `world-bundle-artifact:sha256:${string}`;
  readonly bundle: WorldBundle;
  readonly members: readonly PortableWorldMember[];
}

export interface PublicWorldBundleArtifact {
  readonly contract: "woyengi.world-bundle-public-artifact.v0.1";
  readonly artifactId: `world-bundle-public-artifact:sha256:${string}`;
  readonly bundle: WorldBundle;
  readonly members: readonly PortableWorldMember[];
}

export type WorldBundleConformanceCode =
  | "INVALID_ARTIFACT"
  | "NON_CANONICAL_ARTIFACT"
  | "ARTIFACT_ID_MISMATCH"
  | "MEMBER_HASH_MISMATCH"
  | "DUPLICATE_MEMBER"
  | "MISSING_MANIFEST_MEMBER"
  | "UNDECLARED_MEMBER"
  | "PARTITION_MISMATCH"
  | "PRIVATE_PARTITION_UNMATERIALIZED"
  | "PUBLIC_PARTITION_UNMATERIALIZED"
  | "SOURCE_PROVENANCE_MISSING"
  | "PUBLIC_SOURCE_PROVENANCE_MISSING"
  | "PUBLIC_FORBIDDEN_KIND"
  | "PUBLIC_TARGET_ANSWER"
  | "PUBLIC_HIDDEN_EFFECT"
  | "PUBLIC_PRIVATE_EVIDENCE_LOCATOR"
  | "PUBLIC_PRIVATE_BYTE_LOCATOR"
  | "PUBLIC_PRIVATE_REFERENCE"
  | "INCOMPATIBLE_RUNTIME";

export interface WorldBundleConformanceIssue {
  readonly code: WorldBundleConformanceCode;
  readonly message: string;
}

export interface WorldBundleConformanceOptions {
  readonly runtimeVersion?: string;
}

export interface WorldBundleConformanceReport {
  readonly conformant: boolean;
  readonly errors: readonly WorldBundleConformanceIssue[];
  readonly artifactId?: string;
}

export class WorldBundleConformanceError extends Error {
  readonly code: WorldBundleConformanceCode;

  constructor(code: WorldBundleConformanceCode, message: string) {
    super(message);
    this.name = "WorldBundleConformanceError";
    this.code = code;
  }
}

const FULL_ARTIFACT_CONTRACT = "woyengi.world-bundle-artifact.v0.1" as const;
const PUBLIC_ARTIFACT_CONTRACT = "woyengi.world-bundle-public-artifact.v0.1" as const;
const SHA256_PREFIX = "sha256:" as const;

export function createPortableWorldBundle(input: PortableWorldBundleInput): PortableWorldBundle {
  const bundle = defineWorldBundle(input.bundle);
  const members = normalizeInputMembers(input.members);
  assertBundlePartitions(bundle, members);
  assertSourceProvenance(bundle);
  assertNoPublicLeakage(bundle, members);

  const artifactSeed = deepFreeze({
    contract: FULL_ARTIFACT_CONTRACT,
    bundle,
    members,
  });
  const artifactId = `world-bundle-artifact:sha256:${sha256Hex(canonicalJson(artifactSeed))}` as const;

  return deepFreeze({
    ...artifactSeed,
    artifactId,
  });
}

export function toPublicWorldBundleArtifact(value: PortableWorldBundle): PublicWorldBundleArtifact {
  assertConformant(value);
  const publicMembers = value.members.filter((member) => member.partition === "public");
  const publicBundle = defineWorldBundle({
    id: value.bundle.id,
    version: value.bundle.version,
    sourceSpecRef: value.bundle.sourceSpecRef,
    sourceSpecVersion: value.bundle.sourceSpecVersion,
    compatibility: value.bundle.compatibility,
    public: value.bundle.public,
    partitionManifest: value.bundle.partitionManifest.filter((member) => member.partition === "public"),
    provenanceRefs: value.bundle.provenanceRefs,
  });

  assertBundlePartitions(publicBundle, publicMembers);
  assertSourceProvenance(publicBundle);
  assertNoPublicLeakage(publicBundle, publicMembers);

  const artifactSeed = deepFreeze({
    contract: PUBLIC_ARTIFACT_CONTRACT,
    bundle: publicBundle,
    members: publicMembers,
  });
  const artifactId = `world-bundle-public-artifact:sha256:${sha256Hex(canonicalJson(artifactSeed))}` as const;

  return deepFreeze({
    ...artifactSeed,
    artifactId,
  });
}

export function serializePortableWorldBundle(value: PortableWorldBundle): string {
  assertConformant(value);
  return `${canonicalJson(value)}\n`;
}

export function serializePublicWorldBundleArtifact(value: PublicWorldBundleArtifact): string {
  assertPublicArtifactConformant(value);
  return `${canonicalJson(value)}\n`;
}

export function parsePortableWorldBundle(serialized: string): PortableWorldBundle {
  const parsed: unknown = JSON.parse(serialized);
  assertConformant(parsed);
  return parsed as PortableWorldBundle;
}

export function parsePublicWorldBundleArtifact(serialized: string): PublicWorldBundleArtifact {
  const parsed: unknown = JSON.parse(serialized);
  assertPublicArtifactConformant(parsed);
  return parsed as PublicWorldBundleArtifact;
}

export function verifyWorldBundleConformance(
  value: unknown,
  options: WorldBundleConformanceOptions = {},
): WorldBundleConformanceReport {
  try {
    const artifact = normalizeFullArtifactCandidate(value);
    assertBundlePartitions(artifact.bundle, artifact.members);
    assertSourceProvenance(artifact.bundle);
    assertNoPublicLeakage(artifact.bundle, artifact.members);
    assertRuntimeCompatibility(artifact.bundle, options.runtimeVersion);
    return {
      conformant: true,
      errors: [],
      artifactId: artifact.artifactId,
    };
  } catch (error) {
    const issue = toConformanceIssue(error);
    return {
      conformant: false,
      errors: [issue],
    };
  }
}

export function verifyPublicWorldBundleConformance(
  value: unknown,
  options: WorldBundleConformanceOptions = {},
): WorldBundleConformanceReport {
  try {
    const artifact = normalizePublicArtifactCandidate(value);
    assertBundlePartitions(artifact.bundle, artifact.members);
    assertSourceProvenance(artifact.bundle);
    assertNoPublicLeakage(artifact.bundle, artifact.members);
    if (artifact.bundle.privateEvaluator !== undefined) {
      fail("INVALID_ARTIFACT", "public artifact must not contain a private evaluator partition");
    }
    if (artifact.bundle.partitionManifest.some((member) => member.partition !== "public")) {
      fail("INVALID_ARTIFACT", "public artifact manifest must contain only public members");
    }
    assertRuntimeCompatibility(artifact.bundle, options.runtimeVersion);
    return {
      conformant: true,
      errors: [],
      artifactId: artifact.artifactId,
    };
  } catch (error) {
    const issue = toConformanceIssue(error);
    return {
      conformant: false,
      errors: [issue],
    };
  }
}

export function resolvePublicMember(
  artifact: PublicWorldBundleArtifact,
  memberId: string,
): PortableWorldMember | undefined {
  assertPublicArtifactConformant(artifact);
  const normalizedId = namespaced("public member id", memberId, "world-member:");
  return artifact.members.find((member) => member.id === normalizedId);
}

export function resolvePrivateEvaluatorMember(
  artifact: PortableWorldBundle,
  memberId: string,
): PortableWorldMember | undefined {
  assertConformant(artifact);
  const normalizedId = namespaced("private evaluator member id", memberId, "world-member:");
  return artifact.members.find((member) => member.id === normalizedId && member.partition === "private-evaluator");
}

function normalizeFullArtifactCandidate(value: unknown): PortableWorldBundle {
  const record = exactRecord(value, ["artifactId", "bundle", "contract", "members"], "WorldBundle artifact");
  if (record.contract !== FULL_ARTIFACT_CONTRACT) {
    fail("INVALID_ARTIFACT", `artifact contract must be ${FULL_ARTIFACT_CONTRACT}`);
  }
  if (!Array.isArray(record.members)) fail("INVALID_ARTIFACT", "artifact members must be an array");

  let bundle: WorldBundle;
  try {
    bundle = defineWorldBundle(record.bundle as WorldBundleInput);
  } catch (error) {
    fail("INVALID_ARTIFACT", `invalid WorldBundle contract: ${errorMessage(error)}`);
  }
  if (canonicalJson(record.bundle) !== canonicalJson(bundle)) {
    fail("NON_CANONICAL_ARTIFACT", "artifact bundle is not normalized or contains unknown fields");
  }

  const members = normalizeExistingMembers(record.members);
  if (canonicalJson(record.members) !== canonicalJson(members)) {
    fail("NON_CANONICAL_ARTIFACT", "artifact members are not in canonical normalized form");
  }

  if (typeof record.artifactId !== "string") fail("INVALID_ARTIFACT", "artifactId must be a string");
  const expectedId = `world-bundle-artifact:sha256:${sha256Hex(canonicalJson({
    contract: FULL_ARTIFACT_CONTRACT,
    bundle,
    members,
  }))}`;
  if (record.artifactId !== expectedId) {
    fail("ARTIFACT_ID_MISMATCH", `artifactId must equal ${expectedId}`);
  }

  return deepFreeze({
    contract: FULL_ARTIFACT_CONTRACT,
    artifactId: expectedId as PortableWorldBundle["artifactId"],
    bundle,
    members,
  });
}

function normalizePublicArtifactCandidate(value: unknown): PublicWorldBundleArtifact {
  const record = exactRecord(value, ["artifactId", "bundle", "contract", "members"], "public WorldBundle artifact");
  if (record.contract !== PUBLIC_ARTIFACT_CONTRACT) {
    fail("INVALID_ARTIFACT", `artifact contract must be ${PUBLIC_ARTIFACT_CONTRACT}`);
  }
  if (!Array.isArray(record.members)) fail("INVALID_ARTIFACT", "artifact members must be an array");

  let bundle: WorldBundle;
  try {
    bundle = defineWorldBundle(record.bundle as WorldBundleInput);
  } catch (error) {
    fail("INVALID_ARTIFACT", `invalid public WorldBundle contract: ${errorMessage(error)}`);
  }
  if (canonicalJson(record.bundle) !== canonicalJson(bundle)) {
    fail("NON_CANONICAL_ARTIFACT", "public artifact bundle is not normalized or contains unknown fields");
  }

  const members = normalizeExistingMembers(record.members);
  if (canonicalJson(record.members) !== canonicalJson(members)) {
    fail("NON_CANONICAL_ARTIFACT", "public artifact members are not in canonical normalized form");
  }
  if (members.some((member) => member.partition !== "public")) {
    fail("INVALID_ARTIFACT", "public artifact cannot materialize private-evaluator members");
  }

  if (typeof record.artifactId !== "string") fail("INVALID_ARTIFACT", "artifactId must be a string");
  const expectedId = `world-bundle-public-artifact:sha256:${sha256Hex(canonicalJson({
    contract: PUBLIC_ARTIFACT_CONTRACT,
    bundle,
    members,
  }))}`;
  if (record.artifactId !== expectedId) {
    fail("ARTIFACT_ID_MISMATCH", `artifactId must equal ${expectedId}`);
  }

  return deepFreeze({
    contract: PUBLIC_ARTIFACT_CONTRACT,
    artifactId: expectedId as PublicWorldBundleArtifact["artifactId"],
    bundle,
    members,
  });
}

function normalizeInputMembers(values: readonly PortableWorldMemberInput[]): readonly PortableWorldMember[] {
  const members = values.map((value) => normalizeMember(value, false)).sort(compareMembers);
  assertUniqueMemberIds(members);
  return deepFreeze(members);
}

function normalizeExistingMembers(values: readonly unknown[]): readonly PortableWorldMember[] {
  const members = values.map((value) => normalizeMember(value, true)).sort(compareMembers);
  assertUniqueMemberIds(members);
  return deepFreeze(members);
}

function normalizeMember(value: unknown, requireHash: boolean): PortableWorldMember {
  const allowed = requireHash
    ? ["contentHash", "id", "kind", "partition", "payload"]
    : ["id", "kind", "partition", "payload"];
  const record = exactRecord(value, allowed, "WorldBundle member");
  const id = namespaced("WorldBundle member id", stringField(record, "id"), "world-member:");
  const partition = worldPartition(record.partition);
  const kind = requiredText("WorldBundle member kind", stringField(record, "kind"));
  const payload = normalizeOperationalValue(record.payload, `member:${id}`);
  const contentHash = `${SHA256_PREFIX}${sha256Hex(canonicalJson(payload))}` as const;

  if (requireHash) {
    if (record.contentHash !== contentHash) {
      fail("MEMBER_HASH_MISMATCH", `member ${id} contentHash must equal ${contentHash}`);
    }
  }

  return deepFreeze({ id, partition, kind, payload, contentHash });
}

function assertUniqueMemberIds(members: readonly PortableWorldMember[]): void {
  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.id)) fail("DUPLICATE_MEMBER", `duplicate materialized WorldBundle member: ${member.id}`);
    seen.add(member.id);
  }
}

function assertBundlePartitions(bundle: WorldBundle, members: readonly PortableWorldMember[]): void {
  const manifest = new Map(bundle.partitionManifest.map((member) => [member.id, member] as const));
  const materialized = new Map(members.map((member) => [member.id, member] as const));

  for (const descriptor of bundle.partitionManifest) {
    const member = materialized.get(descriptor.id);
    if (member === undefined) {
      fail("MISSING_MANIFEST_MEMBER", `manifest member is not materialized: ${descriptor.id}`);
    }
    if (member.partition !== descriptor.partition || member.kind !== descriptor.kind) {
      fail(
        "PARTITION_MISMATCH",
        `materialized member ${descriptor.id} must match manifest partition=${descriptor.partition} kind=${descriptor.kind}`,
      );
    }
  }

  for (const member of members) {
    if (!manifest.has(member.id)) fail("UNDECLARED_MEMBER", `materialized member is not declared by manifest: ${member.id}`);
  }

  const publicCount = bundle.partitionManifest.filter((member) => member.partition === "public").length;
  if (publicCount === 0) fail("PUBLIC_PARTITION_UNMATERIALIZED", "WorldBundle must declare at least one public member");

  const privateCount = bundle.partitionManifest.filter((member) => member.partition === "private-evaluator").length;
  if (bundle.privateEvaluator !== undefined && privateCount === 0) {
    fail("PRIVATE_PARTITION_UNMATERIALIZED", "private evaluator metadata requires at least one private-evaluator member");
  }
  if (bundle.privateEvaluator === undefined && privateCount > 0) {
    fail("PARTITION_MISMATCH", "private-evaluator members require private evaluator metadata");
  }
}

function assertSourceProvenance(bundle: WorldBundle): void {
  if (!bundle.provenanceRefs.includes(bundle.sourceSpecRef)) {
    fail("SOURCE_PROVENANCE_MISSING", `bundle provenance must include source OperationalSystemSpec ${bundle.sourceSpecRef}`);
  }
  if (!bundle.public.provenanceRefs.includes(bundle.sourceSpecRef)) {
    fail(
      "PUBLIC_SOURCE_PROVENANCE_MISSING",
      `public provenance must include source OperationalSystemSpec ${bundle.sourceSpecRef}`,
    );
  }
}

function assertNoPublicLeakage(bundle: WorldBundle, members: readonly PortableWorldMember[]): void {
  const privateRefs = privateReferenceSet(bundle);
  scanPublicValue(bundle.public, "bundle.public", privateRefs);
  for (const member of members) {
    if (member.partition !== "public") continue;
    assertSafePublicKind(member);
    scanPublicValue(member.payload, `member:${member.id}.payload`, privateRefs);
  }
}

function assertSafePublicKind(member: PortableWorldMember): void {
  const kind = normalizedToken(member.kind);
  const forbidden = ["oracle", "private", "targetanswer", "hiddeneffect", "privateevidencelocator", "evaluatorsecret"];
  if (forbidden.some((token) => kind.includes(token))) {
    fail("PUBLIC_FORBIDDEN_KIND", `public member ${member.id} uses evaluator-private kind ${member.kind}`);
  }
}

function scanPublicValue(value: unknown, path: string, privateRefs: ReadonlySet<string>): void {
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (privateRefs.has(value) || privateReferencePattern(value)) {
      fail("PUBLIC_PRIVATE_REFERENCE", `public artifact contains evaluator-private reference at ${path}: ${value}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) scanPublicValue(value[index], `${path}[${index}]`, privateRefs);
    return;
  }
  if (!isPlainRecord(value)) fail("INVALID_ARTIFACT", `public value at ${path} must be JSON-compatible`);

  for (const [key, nested] of Object.entries(value)) {
    const token = normalizedToken(key);
    if (targetAnswerKey(token)) fail("PUBLIC_TARGET_ANSWER", `public artifact contains target-answer field at ${path}.${key}`);
    if (hiddenEffectKey(token)) fail("PUBLIC_HIDDEN_EFFECT", `public artifact contains hidden-effect field at ${path}.${key}`);
    if (privateEvidenceLocatorKey(token)) {
      fail("PUBLIC_PRIVATE_EVIDENCE_LOCATOR", `public artifact contains private evidence locator field at ${path}.${key}`);
    }
    if (privateByteLocatorKey(token)) {
      fail("PUBLIC_PRIVATE_BYTE_LOCATOR", `public artifact contains private-byte locator field at ${path}.${key}`);
    }
    if (locatorKey(token) && typeof nested === "string" && unsafePublicLocator(nested)) {
      fail("PUBLIC_PRIVATE_BYTE_LOCATOR", `public artifact contains unsafe byte locator at ${path}.${key}: ${nested}`);
    }
    scanPublicValue(nested, `${path}.${key}`, privateRefs);
  }
}

function privateReferenceSet(bundle: WorldBundle): ReadonlySet<string> {
  const privateEvaluator = bundle.privateEvaluator;
  if (privateEvaluator === undefined) return new Set();
  return new Set([
    ...privateEvaluator.targetAssertionRefs,
    ...privateEvaluator.invariantRefs,
    ...privateEvaluator.hiddenEffectRefs,
    ...privateEvaluator.evidenceLocatorRefs,
  ]);
}

function targetAnswerKey(token: string): boolean {
  return ["targetanswer", "targetanswers", "answerkey", "correctanswer", "correctanswers", "oracletruth", "oraclevalue", "targetassertionvalue", "targetassertionvalues"].includes(token);
}

function hiddenEffectKey(token: string): boolean {
  return token === "hiddeneffect" || token === "hiddeneffects";
}

function privateEvidenceLocatorKey(token: string): boolean {
  return token.includes("private") && token.includes("evidence") && token.includes("locator");
}

function privateByteLocatorKey(token: string): boolean {
  return token === "privatebytes" || token === "privatebyte" || (token.includes("private") && token.includes("locator"));
}

function locatorKey(token: string): boolean {
  return token.endsWith("locator") || token.endsWith("location") || token.endsWith("path") || token.endsWith("uri") || token.endsWith("url");
}

function unsafePublicLocator(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("file:")
    || normalized.startsWith("data:")
    || normalized.startsWith("private:")
    || normalized.startsWith("evaluator-private:")
    || normalized.startsWith("sealed-private:")
    || normalized.startsWith("../")
    || normalized.includes("/private-evaluator/")
    || normalized.includes("\\private-evaluator\\");
}

function privateReferencePattern(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /^(?:private-(?:assertion|invariant|effect|evidence|byte)|hidden-effect|oracle):/.test(normalized)
    || /^(?:private|evaluator-private|sealed-private):\/\//.test(normalized);
}

function assertRuntimeCompatibility(bundle: WorldBundle, runtimeVersion: string | undefined): void {
  if (runtimeVersion === undefined) return;
  if (compareSemanticVersions(runtimeVersion, bundle.compatibility.minimumRuntimeVersion) < 0) {
    fail(
      "INCOMPATIBLE_RUNTIME",
      `runtime ${runtimeVersion} does not satisfy minimum ${bundle.compatibility.minimumRuntimeVersion}`,
    );
  }
}

function assertConformant(value: unknown): asserts value is PortableWorldBundle {
  const report = verifyWorldBundleConformance(value);
  if (!report.conformant) throw issueAsError(report.errors[0]);
}

function assertPublicArtifactConformant(value: unknown): asserts value is PublicWorldBundleArtifact {
  const report = verifyPublicWorldBundleConformance(value);
  if (!report.conformant) throw issueAsError(report.errors[0]);
}

function issueAsError(issue: WorldBundleConformanceIssue | undefined): WorldBundleConformanceError {
  if (issue === undefined) return new WorldBundleConformanceError("INVALID_ARTIFACT", "unknown conformance failure");
  return new WorldBundleConformanceError(issue.code, issue.message);
}

function toConformanceIssue(error: unknown): WorldBundleConformanceIssue {
  if (error instanceof WorldBundleConformanceError) return { code: error.code, message: error.message };
  return { code: "INVALID_ARTIFACT", message: errorMessage(error) };
}

function normalizeOperationalValue(value: unknown, path: string): OperationalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("INVALID_ARTIFACT", `member payload number at ${path} must be finite`);
    return value;
  }
  if (Array.isArray(value)) return deepFreeze(value.map((item, index) => normalizeOperationalValue(item, `${path}[${index}]`)));
  if (!isPlainRecord(value)) fail("INVALID_ARTIFACT", `member payload at ${path} must be JSON-compatible`);

  const entries = Object.entries(value).sort(([left], [right]) => compareText(left, right));
  const normalized: { [key: string]: OperationalValue } = {};
  for (const [key, nested] of entries) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      fail("INVALID_ARTIFACT", `member payload at ${path} contains unsafe object key ${key}`);
    }
    normalized[key] = normalizeOperationalValue(nested, `${path}.${key}`);
  }
  return deepFreeze(normalized);
}

function exactRecord(value: unknown, allowedKeys: readonly string[], name: string): { [key: string]: unknown } {
  if (!isPlainRecord(value)) fail("INVALID_ARTIFACT", `${name} must be a JSON object`);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("INVALID_ARTIFACT", `${name} contains unknown field ${key}`);
  }
  return value;
}

function isPlainRecord(value: unknown): value is { [key: string]: unknown } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stringField(record: { [key: string]: unknown }, key: string): string {
  const value = record[key];
  if (typeof value !== "string") fail("INVALID_ARTIFACT", `${key} must be a string`);
  return value;
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) fail("INVALID_ARTIFACT", `${name} must not be empty`);
  return normalized;
}

function namespaced(name: string, value: string, prefix?: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.includes(":")) fail("INVALID_ARTIFACT", `${name} must be namespace-qualified`);
  if (prefix !== undefined && !normalized.startsWith(prefix)) fail("INVALID_ARTIFACT", `${name} must start with ${prefix}`);
  return normalized;
}

function worldPartition(value: unknown): WorldBundlePartition {
  if (value !== "public" && value !== "private-evaluator") {
    fail("INVALID_ARTIFACT", `invalid WorldBundle partition: ${String(value)}`);
  }
  return value;
}

function compareMembers(left: PortableWorldMember, right: PortableWorldMember): number {
  return compareText(left.partition, right.partition) || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizedToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function compareSemanticVersions(left: string, right: string): number {
  const leftParts = parseSemanticVersion(left);
  const rightParts = parseSemanticVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseSemanticVersion(value: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (match === null) fail("INVALID_ARTIFACT", `runtime version must use major.minor.patch: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("INVALID_ARTIFACT", "canonical JSON cannot encode a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (!isPlainRecord(value)) fail("INVALID_ARTIFACT", `canonical JSON cannot encode ${typeof value}`);
  const entries = Object.entries(value).sort(([left], [right]) => compareText(left, right));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function fail(code: WorldBundleConformanceCode, message: string): never {
  throw new WorldBundleConformanceError(code, message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
