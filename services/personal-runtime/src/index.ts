import { resolve, join } from "node:path";

import {
  ApplicationInstaller,
  defineApplicationPackage,
  readApplicationPackage,
  type ApplicationInstance,
  type ApplicationPackage,
  type InstallApplicationInput,
  type JsonValue,
} from "../../../packages/apps/src/index.ts";
import { createArtifact, type ArtifactRecord } from "../../../packages/core/src/index.ts";
import {
  LocalCanonicalLedger,
  LocalObjectStore,
  sha256,
} from "../../../packages/storage/src/index.ts";
import {
  WorkspaceRegistry,
  type Workspace,
  type WorkspaceContext,
  type WorkspaceOperation,
} from "../../../packages/workspace/src/index.ts";

const PACKAGE_MANIFEST = "application-package.json";
const STATE_ARTIFACT_ID = "artifact:personal-runtime-state-v1";
const STATE_MEDIA_TYPE = "application/vnd.woyengi.personal-runtime-state+json";

export interface PersonalRuntimeOwnerSeed {
  readonly principalId: string;
  readonly accountId: string;
  readonly workspaceId: string;
}

export interface PersonalRuntimeInstallationInput {
  readonly instanceId: string;
  readonly semanticObjectBindings: Readonly<Record<string, string>>;
  readonly roleBindings: Readonly<Record<string, string>>;
  readonly participantBindings: Readonly<Record<string, string>>;
  readonly integrationBindings: Readonly<Record<string, string>>;
  readonly surfaceConfiguration: Readonly<Record<string, JsonValue>>;
  readonly configuration: Readonly<Record<string, JsonValue>>;
}

export interface SeedPersonalRuntimeInput {
  readonly localStateDirectory: string;
  readonly applicationPackageDirectory: string;
  readonly platformApiVersion: string;
  readonly startedAt: string;
  readonly owner: PersonalRuntimeOwnerSeed;
  readonly installation: PersonalRuntimeInstallationInput;
}

export interface OpenPersonalRuntimeInput {
  readonly localStateDirectory: string;
  readonly startedAt: string;
}

export type PersonalRuntimeStartupCheckKind =
  | "personal-workspace"
  | "filesystem-application-package"
  | "durable-local-ledger"
  | "durable-local-object";

export interface PersonalRuntimeStartupCheck {
  readonly kind: PersonalRuntimeStartupCheckKind;
  readonly outcome: "passed";
  readonly detail: string;
}

export interface PersonalRuntimeStartupEvidence {
  readonly id: string;
  readonly mode: "seeded" | "reopened";
  readonly recordedAt: string;
  readonly workspaceId: string;
  readonly applicationInstanceId: string;
  readonly applicationPackageId: string;
  readonly stateArtifactId: string;
  readonly stateContentHash: string;
  readonly dependencies: {
    readonly networkAccess: "not-used";
    readonly woyengiOperatedServices: readonly [];
  };
  readonly checks: readonly PersonalRuntimeStartupCheck[];
}

export interface PersonalRuntimeSession {
  readonly workspace: Workspace;
  readonly workspaceContext: WorkspaceContext;
  readonly application: ApplicationInstance;
  readonly evidence: PersonalRuntimeStartupEvidence;
}

interface PersistedPersonalRuntimeState {
  readonly schemaVersion: 1;
  readonly platformApiVersion: string;
  readonly owner: PersonalRuntimeOwnerSeed;
  readonly workspaceOperations: readonly WorkspaceOperation[];
  readonly applicationPackage: ApplicationPackage;
  readonly installation: InstallApplicationInput;
  readonly packageSourceDirectory: string;
}

export async function seedPersonalRuntime(input: SeedPersonalRuntimeInput): Promise<PersonalRuntimeSession> {
  const startedAt = normalizeInstant(input.startedAt);
  const paths = localPaths(input.localStateDirectory);
  const ledger = await LocalCanonicalLedger.open<ArtifactRecord>(paths.ledger);
  if (ledger.get(STATE_ARTIFACT_ID) !== undefined) {
    throw new Error(`personal runtime local state is already seeded: ${paths.root}`);
  }

  const registry = new WorkspaceRegistry();
  registry.registerPrincipal({
    operationId: operationId(input.owner.workspaceId, "00-owner-registered"),
    id: input.owner.principalId,
    kind: "human",
    recordedAt: startedAt,
  });
  const { workspace } = registry.createAccount({
    operationId: operationId(input.owner.workspaceId, "01-account-created"),
    id: input.owner.accountId,
    ownerPrincipalId: input.owner.principalId,
    personalWorkspaceId: input.owner.workspaceId,
    recordedAt: startedAt,
  });
  const workspaceContext = registry.switchWorkspace({
    principalId: input.owner.principalId,
    workspaceId: input.owner.workspaceId,
  });

  const packageSourceDirectory = resolve(requiredText("application package directory", input.applicationPackageDirectory));
  const applicationPackage = await readApplicationPackage(join(packageSourceDirectory, PACKAGE_MANIFEST));
  const installer = new ApplicationInstaller({ platformApiVersion: input.platformApiVersion });
  const application = installer.install(applicationPackage, {
    ...input.installation,
    workspaceId: workspace.id,
  });
  const installation = installationFrom(application);
  const state = normalizePersistedState({
    schemaVersion: 1,
    platformApiVersion: input.platformApiVersion,
    owner: input.owner,
    workspaceOperations: registry.history(),
    applicationPackage,
    installation,
    packageSourceDirectory,
  });
  const bytes = new TextEncoder().encode(`${JSON.stringify(state)}\n`);
  const stateContentHash = sha256(bytes);
  const objects = await LocalObjectStore.open(paths.objects);
  await objects.put(stateContentHash, bytes);
  const artifact = createArtifact({
    id: STATE_ARTIFACT_ID,
    mediaType: STATE_MEDIA_TYPE,
    contentHash: stateContentHash,
    storageLocator: `local-object:${stateContentHash}`,
    residualDetails: [{
      locator: join(packageSourceDirectory, PACKAGE_MANIFEST),
      mediaType: "application/json",
    }],
    recordedAt: startedAt,
    provenance: { derivedFrom: [], transformations: ["personal-runtime:offline-seed:v1"] },
    lifecycle: "verified",
  });
  await ledger.append(artifact);

  return session({
    mode: "seeded",
    startedAt,
    workspace,
    workspaceContext,
    application,
    artifact,
    checks: [
      check("personal-workspace", workspace.id),
      check("filesystem-application-package", join(packageSourceDirectory, PACKAGE_MANIFEST)),
      check("durable-local-ledger", paths.ledger),
      check("durable-local-object", stateContentHash),
    ],
  });
}

export async function openPersonalRuntime(input: OpenPersonalRuntimeInput): Promise<PersonalRuntimeSession> {
  const startedAt = normalizeInstant(input.startedAt);
  const paths = localPaths(input.localStateDirectory);
  const ledger = await LocalCanonicalLedger.open<ArtifactRecord>(paths.ledger);
  const artifact = ledger.get(STATE_ARTIFACT_ID);
  if (artifact === undefined) throw new Error(`personal runtime local state is not seeded: ${paths.root}`);
  if (artifact.kind !== "artifact" || artifact.mediaType !== STATE_MEDIA_TYPE) {
    throw new Error("personal runtime state artifact has an incompatible contract");
  }
  const objects = await LocalObjectStore.open(paths.objects);
  const bytes = await objects.get(artifact.contentHash);
  if (bytes === undefined) throw new Error(`personal runtime state object is missing: ${artifact.contentHash}`);
  if (sha256(bytes) !== artifact.contentHash) throw new Error("personal runtime state object failed integrity verification");
  const state = parsePersistedState(new TextDecoder().decode(bytes));
  const restored = restore(state);

  return session({
    mode: "reopened",
    startedAt,
    workspace: restored.workspace,
    workspaceContext: restored.workspaceContext,
    application: restored.application,
    artifact,
    checks: [
      check("personal-workspace", restored.workspace.id),
      check("durable-local-ledger", paths.ledger),
      check("durable-local-object", artifact.contentHash),
    ],
  });
}

function restore(state: PersistedPersonalRuntimeState): {
  readonly workspace: Workspace;
  readonly workspaceContext: WorkspaceContext;
  readonly application: ApplicationInstance;
} {
  const registry = WorkspaceRegistry.replay(state.workspaceOperations);
  const workspace = registry.workspaceFor({
    principalId: state.owner.principalId,
    workspaceId: state.owner.workspaceId,
  });
  if (workspace.kind !== "personal" || workspace.accountId !== state.owner.accountId) {
    throw new Error("persisted personal workspace owner references do not match");
  }
  const workspaceContext = registry.switchWorkspace({
    principalId: state.owner.principalId,
    workspaceId: state.owner.workspaceId,
  });
  const applicationPackage = defineApplicationPackage(state.applicationPackage);
  const installer = new ApplicationInstaller({ platformApiVersion: state.platformApiVersion });
  const application = installer.install(applicationPackage, state.installation);
  if (application.workspaceId !== workspace.id) throw new Error("persisted ApplicationInstance workspace mismatch");
  return deepFreeze({ workspace, workspaceContext, application });
}

function installationFrom(application: ApplicationInstance): InstallApplicationInput {
  return deepFreeze({
    instanceId: application.id,
    workspaceId: application.workspaceId,
    semanticObjectBindings: application.semanticObjectBindings,
    roleBindings: application.roleBindings,
    participantBindings: application.participantBindings,
    integrationBindings: application.integrationBindings,
    surfaceConfiguration: application.surfaceConfiguration,
    configuration: application.configuration,
  });
}

function normalizePersistedState(input: PersistedPersonalRuntimeState): PersistedPersonalRuntimeState {
  const owner = {
    principalId: prefixedId("owner principal id", input.owner.principalId, "principal:"),
    accountId: prefixedId("owner account id", input.owner.accountId, "account:"),
    workspaceId: prefixedId("Personal Workspace id", input.owner.workspaceId, "workspace:"),
  };
  return deepFreeze({
    schemaVersion: 1,
    platformApiVersion: semanticVersion(input.platformApiVersion),
    owner,
    workspaceOperations: structuredClone(input.workspaceOperations),
    applicationPackage: defineApplicationPackage(input.applicationPackage),
    installation: structuredClone(input.installation),
    packageSourceDirectory: resolve(requiredText("package source directory", input.packageSourceDirectory)),
  });
}

function parsePersistedState(serialized: string): PersistedPersonalRuntimeState {
  const parsed: unknown = JSON.parse(serialized);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("personal runtime state must be an object");
  }
  const candidate = parsed as PersistedPersonalRuntimeState;
  if (candidate.schemaVersion !== 1) throw new Error("unsupported personal runtime state schema");
  return normalizePersistedState(candidate);
}

function session(input: {
  readonly mode: "seeded" | "reopened";
  readonly startedAt: string;
  readonly workspace: Workspace;
  readonly workspaceContext: WorkspaceContext;
  readonly application: ApplicationInstance;
  readonly artifact: ArtifactRecord;
  readonly checks: readonly PersonalRuntimeStartupCheck[];
}): PersonalRuntimeSession {
  const evidence: PersonalRuntimeStartupEvidence = {
    id: `startup-evidence:${input.mode}:${input.workspace.id.slice("workspace:".length)}`,
    mode: input.mode,
    recordedAt: input.startedAt,
    workspaceId: input.workspace.id,
    applicationInstanceId: input.application.id,
    applicationPackageId: input.application.packageId,
    stateArtifactId: input.artifact.id,
    stateContentHash: input.artifact.contentHash,
    dependencies: { networkAccess: "not-used", woyengiOperatedServices: [] },
    checks: input.checks,
  };
  return deepFreeze({
    workspace: input.workspace,
    workspaceContext: input.workspaceContext,
    application: input.application,
    evidence,
  });
}

function check(kind: PersonalRuntimeStartupCheckKind, detail: string): PersonalRuntimeStartupCheck {
  return deepFreeze({ kind, outcome: "passed", detail: requiredText("startup evidence detail", detail) });
}

function localPaths(directory: string): { readonly root: string; readonly ledger: string; readonly objects: string } {
  const root = resolve(requiredText("local state directory", directory));
  return { root, ledger: join(root, "canonical-ledger.json"), objects: join(root, "objects") };
}

function operationId(workspaceId: string, suffix: string): string {
  const workspace = prefixedId("Personal Workspace id", workspaceId, "workspace:");
  return `workspace-operation:${workspace.slice("workspace:".length)}:${suffix}`;
}

function semanticVersion(value: string): string {
  const normalized = requiredText("Platform API version", value);
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) throw new TypeError("Platform API version must be semantic");
  return normalized;
}

function prefixedId(name: string, value: string, prefix: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${name} must start with ${prefix}`);
  return normalized;
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`);
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
