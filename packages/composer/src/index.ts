import {
  compileOperationalIR,
  defineComprehensionModel,
  defineOperationalSystemSpec,
  type ComprehensionModel,
  type OperationalAuthorityRequirement,
  type OperationalIR,
  type OperationalInvariantDefinition,
  type OperationalRequirement,
  type OperationalSystemSpec,
  type OutcomeContract,
} from "../../operational-spec/src/index.ts";

export const APP_PROJECTION_COMPILER_VERSION = "0.1.0" as const;

export const COMPOSITION_PREFERENCE = Object.freeze([
  "do-nothing",
  "reuse",
  "configure",
  "compose",
  "adapt",
  "extend",
  "generate",
] as const);

export type CompositionStrategy = typeof COMPOSITION_PREFERENCE[number];

export interface IntentAmbiguity {
  readonly id: string;
  readonly blocking: boolean;
  readonly question: string;
}

export interface AppIntent {
  readonly id: string;
  readonly workspaceId: string;
  readonly objective: string;
  readonly users: readonly string[];
  readonly subjects: readonly string[];
  readonly activities: readonly string[];
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly triggers: readonly string[];
  readonly decisions: readonly string[];
  readonly requiredEffects: readonly string[];
  readonly constraints: readonly string[];
  readonly integrations: readonly string[];
  readonly successCriteria: readonly string[];
  readonly collaborationExpectations: readonly string[];
  readonly unresolvedQuestions: readonly string[];
  readonly provenance: readonly { readonly kind: "natural-language" | "operational-system-spec"; readonly value: string }[];
}

export type RequirementKind =
  | "domain-object"
  | "activity"
  | "role"
  | "surface"
  | "capability"
  | "integration"
  | "automation"
  | "authority"
  | "verification"
  | "collaboration"
  | "metric"
  | "runtime"
  | "constraint";

export interface SoftwareRequirementNode {
  readonly id: string;
  readonly kind: RequirementKind;
  readonly requirement: string;
}

export interface SoftwareRequirementEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: "requires" | "governs" | "verifies";
}

export interface SoftwareRequirementGraph {
  readonly id: string;
  readonly intentRef: string;
  readonly providerNeutral: true;
  readonly nodes: readonly SoftwareRequirementNode[];
  readonly edges: readonly SoftwareRequirementEdge[];
}

export interface ApplicationPackageCandidate {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly objective: string;
  readonly subjects: readonly string[];
  readonly activities: readonly string[];
  readonly capabilityRequirements: readonly string[];
  readonly applicability: { readonly applicable: boolean; readonly rationale: readonly string[] };
}

export interface ExistingApplication {
  readonly id: string;
  readonly name: string;
  readonly objective: string;
  readonly subjects: readonly string[];
  readonly activities: readonly string[];
  readonly applicable: boolean;
  readonly satisfiesIntent?: boolean;
}

export interface CompositionPlan {
  readonly id: string;
  readonly intentRef: string;
  readonly requirementGraphRef: string;
  readonly strategy: CompositionStrategy;
  readonly operation: "none" | "install" | "update" | "create";
  readonly targetApplicationId?: string;
  readonly selectedPackage?: { readonly id: string; readonly version: string };
  readonly considered: readonly {
    readonly id: string;
    readonly strategy: CompositionStrategy;
    readonly applicable: boolean;
    readonly rationale: readonly string[];
  }[];
  readonly steps: readonly string[];
  readonly rationale: readonly string[];
}

export interface AppProjectionCompositionPlan extends CompositionPlan {
  readonly operationalSystemSpecRef: string;
  readonly operationalIRRef: string;
}

export interface AppBlueprint {
  readonly id: string;
  readonly version: "1.0.0";
  readonly intentRef: string;
  readonly requirementGraphRef: string;
  readonly operationalSystemSpecRef: string;
  readonly operationalSystemSpecVersion: string;
  readonly operationalIRRef: string;
  readonly outcomeContractRefs: readonly string[];
  readonly projectionRequirementRefs: readonly string[];
  readonly verificationRequirementRefs: readonly string[];
  readonly outcomeContracts: readonly OutcomeContract[];
  readonly authorityRequirementDefinitions: readonly OperationalAuthorityRequirement[];
  readonly constraintRequirements: readonly OperationalRequirement[];
  readonly acceptanceAuthorityRequirements: readonly string[];
  readonly invariantDefinitions: readonly OperationalInvariantDefinition[];
  readonly invariants: readonly string[];
  readonly goals: readonly string[];
  readonly domainDependencies: readonly string[];
  readonly domainExtensions: readonly string[];
  readonly activityTypes: readonly string[];
  readonly workPackages: readonly string[];
  readonly capabilityRequirements: readonly string[];
  readonly procedures: readonly string[];
  readonly automations: readonly string[];
  readonly agentRoles: readonly string[];
  readonly surfaces: readonly string[];
  readonly navigation: readonly string[];
  readonly integrations: readonly string[];
  readonly authorityRequirements: readonly string[];
  readonly verificationContracts: readonly string[];
  readonly metrics: readonly string[];
  readonly notifications: readonly string[];
  readonly runtimeContextRequirements: readonly string[];
  readonly personalizationRules: readonly string[];
  readonly collaborationContract: {
    readonly participantTypes: readonly ("human" | "agent" | "service" | "automation")[];
    readonly sharedObjects: readonly string[];
    readonly activities: readonly string[];
  };
  readonly publicSurfaceContracts: readonly string[];
  readonly packageDependencies: readonly { readonly id: string; readonly version: string }[];
  readonly migrationRequirements: readonly string[];
  readonly compatibilityRequirements: readonly string[];
  readonly provenance: readonly string[];
}

export interface CompileIntentInput {
  readonly workspaceId: string;
  readonly naturalLanguageIntent: string;
  readonly ambiguities?: readonly IntentAmbiguity[];
  readonly availablePackages?: readonly ApplicationPackageCandidate[];
  readonly existingApplications?: readonly ExistingApplication[];
  readonly changeTargetAppId?: string;
}

export interface CompileAppProjectionInput {
  readonly comprehensionModel: ComprehensionModel;
  readonly operationalSystemSpec: OperationalSystemSpec;
  readonly availablePackages?: readonly ApplicationPackageCandidate[];
  readonly existingApplications?: readonly ExistingApplication[];
  readonly changeTargetAppId?: string;
}

export interface ReadyAppProjectionCompilation {
  readonly status: "ready";
  readonly comprehensionModel: ComprehensionModel;
  readonly operationalSystemSpec: OperationalSystemSpec;
  readonly operationalIR: OperationalIR;
  readonly compositionPlan: AppProjectionCompositionPlan;
  readonly appBlueprint: AppBlueprint;
  readonly humanReadableDiff: string;
}

export interface ReadyIntentCompilation extends ReadyAppProjectionCompilation {
  readonly appIntent: AppIntent;
  readonly requirementGraph: SoftwareRequirementGraph;
}

export interface NeedsInputIntentCompilation {
  readonly status: "needs-input";
  readonly appIntent: AppIntent;
  readonly blockingQuestion: string;
  readonly blockingAmbiguityIds: readonly string[];
}

export type IntentCompilation = ReadyIntentCompilation | NeedsInputIntentCompilation;

export function defineApplicationPackageCandidate(input: ApplicationPackageCandidate): ApplicationPackageCandidate {
  const minimum = {
    id: prefixed("application package id", input.id, "application-package:"),
    version: semanticVersion(input.version),
    name: requiredText("application package name", input.name),
    objective: requiredText("application package objective", input.objective),
    subjects: normalizedList(input.subjects),
    activities: normalizedList(input.activities),
    capabilityRequirements: normalizedList(input.capabilityRequirements),
    applicability: {
      applicable: input.applicability.applicable,
      rationale: normalizedList(input.applicability.rationale),
    },
  };
  return deepFreeze(minimum);
}

export function defineExistingApplication(input: ExistingApplication): ExistingApplication {
  return deepFreeze({
    id: prefixed("application instance id", input.id, "application-instance:"),
    name: requiredText("application name", input.name),
    objective: requiredText("application objective", input.objective),
    subjects: normalizedList(input.subjects),
    activities: normalizedList(input.activities),
    applicable: input.applicable,
    ...(input.satisfiesIntent === undefined ? {} : { satisfiesIntent: input.satisfiesIntent }),
  });
}

export function createAppIntent(input: CompileIntentInput): AppIntent {
  const workspaceId = namespaced("workspace id", input.workspaceId);
  const objective = requiredText("natural-language intent", input.naturalLanguageIntent);
  const subjects = extract(objective, SUBJECT_TERMS);
  const activities = extract(objective, ACTIVITY_TERMS);
  const effects = new Set<string>(["records.read", "records.write"]);
  if (activities.includes("approval")) effects.add("approval.request");
  if (/\b(send|email|notify|notification|message)\b/i.test(objective)) effects.add("communication.send");
  const ambiguities = normalizeAmbiguities(input.ambiguities ?? []);
  const seed = stableJson({ workspaceId, objective });
  return deepFreeze({
    id: `app-intent:${fingerprint(seed)}`,
    workspaceId,
    objective,
    users: extract(objective, USER_TERMS),
    subjects,
    activities,
    inputs: [],
    outputs: [],
    triggers: /\bwhen\b/i.test(objective) ? ["condition"] : [],
    decisions: activities.includes("approval") ? ["approval-decision"] : [],
    requiredEffects: [...effects].sort(),
    constraints: extractConstraints(objective),
    integrations: [],
    successCriteria: ["requested-behavior-is-available"],
    collaborationExpectations: activities.includes("approval") ? ["human-approval"] : [],
    unresolvedQuestions: ambiguities.map((item) => item.question),
    provenance: [{ kind: "natural-language" as const, value: objective }],
  });
}

export function createSoftwareRequirementGraph(appIntent: AppIntent): SoftwareRequirementGraph {
  return createRequirementGraph(appIntent.id, [
    ...appIntent.subjects.map((requirement) => ({ kind: "domain-object" as const, requirement })),
    ...appIntent.activities.map((requirement) => ({ kind: "activity" as const, requirement })),
    ...appIntent.users.map((requirement) => ({ kind: "role" as const, requirement })),
    { kind: "surface" as const, requirement: "workspace" },
    ...appIntent.requiredEffects.map((requirement) => ({ kind: "capability" as const, requirement })),
    ...appIntent.integrations.map((requirement) => ({ kind: "integration" as const, requirement })),
    ...appIntent.constraints.map((requirement) => ({ kind: "constraint" as const, requirement })),
    ...appIntent.collaborationExpectations.map((requirement) => ({ kind: "collaboration" as const, requirement })),
    ...appIntent.successCriteria.map((requirement) => ({ kind: "verification" as const, requirement })),
  ]);
}

export function createCompositionPlan(input: {
  readonly appIntent: AppIntent;
  readonly requirementGraph: SoftwareRequirementGraph;
  readonly availablePackages?: readonly ApplicationPackageCandidate[];
  readonly existingApplications?: readonly ExistingApplication[];
  readonly changeTargetAppId?: string;
}): CompositionPlan {
  const packages = [...(input.availablePackages ?? [])].map(defineApplicationPackageCandidate);
  const applications = [...(input.existingApplications ?? [])].map(defineExistingApplication);
  const explicitTarget = input.changeTargetAppId === undefined
    ? undefined
    : applications.find((item) => item.id === input.changeTargetAppId && item.applicable);
  const inferredTarget = explicitTarget ?? (/^(?:change|update|modify)\b/i.test(input.appIntent.objective)
    ? bestApplication(input.appIntent, applications.filter((item) => item.applicable))
    : undefined);
  const satisfied = inferredTarget?.satisfiesIntent === true
    ? inferredTarget
    : bestApplication(input.appIntent, applications.filter((item) => item.applicable && item.satisfiesIntent === true));
  const applicablePackages = packages
    .filter((item) => item.applicability.applicable)
    .sort((left, right) => matchScore(input.appIntent, right) - matchScore(input.appIntent, left) || left.id.localeCompare(right.id));
  const selectedPackage = applicablePackages[0];
  const considered = [
    ...applications.map((item) => ({ id: item.id, strategy: item.satisfiesIntent ? "do-nothing" as const : "configure" as const, applicable: item.applicable, rationale: [item.satisfiesIntent ? "existing App already satisfies the intent" : "existing App can be changed"] })),
    ...packages.map((item) => ({ id: item.id, strategy: "reuse" as const, applicable: item.applicability.applicable, rationale: item.applicability.rationale })),
  ].sort((left, right) => preferenceRank(left.strategy) - preferenceRank(right.strategy) || left.id.localeCompare(right.id));

  let strategy: CompositionStrategy;
  let operation: CompositionPlan["operation"];
  let targetApplicationId: string | undefined;
  let packageRef: { readonly id: string; readonly version: string } | undefined;
  let steps: readonly string[];
  let rationale: readonly string[];
  if (satisfied !== undefined) {
    strategy = "do-nothing";
    operation = "none";
    targetApplicationId = satisfied.id;
    steps = ["Keep the existing ApplicationInstance unchanged"];
    rationale = ["An applicable existing App already satisfies the operating intent"];
  } else if (inferredTarget !== undefined) {
    strategy = "configure";
    operation = "update";
    targetApplicationId = inferredTarget.id;
    steps = ["Update the existing ApplicationInstance", "Preview and apply the blueprint diff"];
    rationale = ["Change the applicable existing App instead of creating a duplicate"];
  } else if (selectedPackage !== undefined) {
    strategy = "reuse";
    operation = "install";
    packageRef = { id: selectedPackage.id, version: selectedPackage.version };
    steps = ["Reuse the compatible ApplicationPackage", "Bind it to workspace semantic objects"];
    rationale = [...selectedPackage.applicability.rationale];
  } else {
    strategy = "generate";
    operation = "create";
    steps = ["Generate only the unresolved software definition", "Preview before installation"];
    rationale = ["No applicable existing App or package was discovered"];
  }
  const identity = { intentRef: input.appIntent.id, requirementGraphRef: input.requirementGraph.id, strategy, operation, targetApplicationId, packageRef };
  return deepFreeze({
    id: `composition-plan:${fingerprint(stableJson(identity))}`,
    intentRef: input.appIntent.id,
    requirementGraphRef: input.requirementGraph.id,
    strategy,
    operation,
    ...(targetApplicationId === undefined ? {} : { targetApplicationId }),
    ...(packageRef === undefined ? {} : { selectedPackage: packageRef }),
    considered,
    steps,
    rationale,
  });
}

export function createAppBlueprint(input: {
  readonly appIntent: AppIntent;
  readonly requirementGraph: SoftwareRequirementGraph;
  readonly compositionPlan: CompositionPlan;
}): AppBlueprint {
  const source = createLegacyOperationalSource(input.appIntent, input.requirementGraph, []);
  const operationalIR = compileOperationalIR(source.operationalSystemSpec, { compilerVersion: APP_PROJECTION_COMPILER_VERSION });
  const compositionPlan = bindCompositionPlan(input.compositionPlan, source.operationalSystemSpec, operationalIR);
  const appBlueprint = createAppBlueprintProjection({
    appIntent: input.appIntent,
    requirementGraph: input.requirementGraph,
    compositionPlan,
    comprehensionModel: source.comprehensionModel,
    operationalSystemSpec: source.operationalSystemSpec,
    operationalIR,
    compatibilityMode: "legacy",
  });
  validateAppBlueprintProjection({ appBlueprint, operationalSystemSpec: source.operationalSystemSpec, operationalIR });
  return appBlueprint;
}

export function validateAppBlueprintProjection(input: {
  readonly appBlueprint: AppBlueprint;
  readonly operationalSystemSpec: OperationalSystemSpec;
  readonly operationalIR: OperationalIR;
}): void {
  const spec = defineOperationalSystemSpec(input.operationalSystemSpec);
  if (input.operationalIR.sourceSpecRef !== spec.id || input.operationalIR.sourceSpecVersion !== spec.version) {
    throw new Error("AppBlueprint operational IR provenance does not match its source OperationalSystemSpec");
  }
  const rebuiltIR = compileOperationalIR(spec, { compilerVersion: input.operationalIR.compilerVersion });
  if (stableJson(rebuiltIR) !== stableJson(input.operationalIR)) {
    throw new Error("AppBlueprint operational IR is not the deterministic IR for its source OperationalSystemSpec");
  }
  if (
    input.appBlueprint.operationalSystemSpecRef !== spec.id
    || input.appBlueprint.operationalSystemSpecVersion !== spec.version
    || input.appBlueprint.operationalIRRef !== input.operationalIR.id
  ) {
    throw new Error("AppBlueprint provenance does not match its source OperationalSystemSpec and Operational IR");
  }
  assertProjectionEquivalent("goal semantics", input.appBlueprint.goals, spec.goals);
  assertProjectionEquivalent("outcome contract semantics", input.appBlueprint.outcomeContracts, spec.outcomeContracts);
  assertProjectionEquivalent("outcome contract references", input.appBlueprint.outcomeContractRefs, input.operationalIR.outcomeContractRefs);
  assertProjectionEquivalent("authority semantics", input.appBlueprint.authorityRequirementDefinitions, spec.authorityRequirements);
  assertProjectionEquivalent("authority semantics", input.appBlueprint.authorityRequirements, projectedAuthorityRequirements(spec));
  assertProjectionEquivalent("acceptance authority semantics", input.appBlueprint.acceptanceAuthorityRequirements, projectedAcceptanceAuthorityRequirements(spec));
  assertProjectionEquivalent("constraint semantics", input.appBlueprint.constraintRequirements, constraintRequirements(spec));
  assertProjectionEquivalent("verification semantics", input.appBlueprint.verificationContracts, projectedVerificationRequirements(spec));
  assertProjectionEquivalent("verification references", input.appBlueprint.verificationRequirementRefs, input.operationalIR.verificationRequirementRefs);
  assertProjectionEquivalent("invariant definition semantics", input.appBlueprint.invariantDefinitions, spec.invariants);
  assertProjectionEquivalent("invariant semantics", input.appBlueprint.invariants, projectedInvariants(spec));
  assertProjectionEquivalent("projection requirement references", input.appBlueprint.projectionRequirementRefs, input.operationalIR.projectionRequirementRefs);
}

export class AppProjectionCompiler {
  compile(input: CompileAppProjectionInput): ReadyAppProjectionCompilation {
    const comprehensionModel = defineComprehensionModel(input.comprehensionModel);
    const operationalSystemSpec = defineOperationalSystemSpec(input.operationalSystemSpec);
    assertOperationalSource(comprehensionModel, operationalSystemSpec);
    const operationalIR = compileOperationalIR(operationalSystemSpec, { compilerVersion: APP_PROJECTION_COMPILER_VERSION });
    const appIntent = createProjectionIntent(comprehensionModel, operationalSystemSpec);
    const requirementGraph = createProjectionRequirementGraph(appIntent, comprehensionModel, operationalSystemSpec);
    const basePlan = createCompositionPlan({
      appIntent,
      requirementGraph,
      ...(input.availablePackages === undefined ? {} : { availablePackages: input.availablePackages }),
      ...(input.existingApplications === undefined ? {} : { existingApplications: input.existingApplications }),
      ...(input.changeTargetAppId === undefined ? {} : { changeTargetAppId: input.changeTargetAppId }),
    });
    const compositionPlan = bindCompositionPlan(basePlan, operationalSystemSpec, operationalIR);
    const appBlueprint = createAppBlueprintProjection({
      appIntent,
      requirementGraph,
      compositionPlan,
      comprehensionModel,
      operationalSystemSpec,
      operationalIR,
      compatibilityMode: "operational",
    });
    validateAppBlueprintProjection({ appBlueprint, operationalSystemSpec, operationalIR });
    return deepFreeze({
      status: "ready" as const,
      comprehensionModel,
      operationalSystemSpec,
      operationalIR,
      compositionPlan,
      appBlueprint,
      humanReadableDiff: renderDiff(appIntent, compositionPlan, appBlueprint, input.availablePackages ?? [], input.existingApplications ?? []),
    });
  }
}

export class IntentCompiler {
  compile(input: CompileIntentInput): IntentCompilation {
    const appIntent = createAppIntent(input);
    const ambiguities = normalizeAmbiguities(input.ambiguities ?? []);
    const blocking = ambiguities.filter((item) => item.blocking);
    if (blocking.length > 0) {
      const first = blocking[0] as IntentAmbiguity;
      return deepFreeze({
        status: "needs-input" as const,
        appIntent,
        blockingQuestion: first.question,
        blockingAmbiguityIds: [first.id],
      });
    }
    const requirementGraph = createSoftwareRequirementGraph(appIntent);
    const source = createLegacyOperationalSource(appIntent, requirementGraph, ambiguities);
    const operationalIR = compileOperationalIR(source.operationalSystemSpec, { compilerVersion: APP_PROJECTION_COMPILER_VERSION });
    const basePlan = createCompositionPlan({
      appIntent,
      requirementGraph,
      ...(input.availablePackages === undefined ? {} : { availablePackages: input.availablePackages }),
      ...(input.existingApplications === undefined ? {} : { existingApplications: input.existingApplications }),
      ...(input.changeTargetAppId === undefined ? {} : { changeTargetAppId: input.changeTargetAppId }),
    });
    const compositionPlan = bindCompositionPlan(basePlan, source.operationalSystemSpec, operationalIR);
    const appBlueprint = createAppBlueprintProjection({
      appIntent,
      requirementGraph,
      compositionPlan,
      comprehensionModel: source.comprehensionModel,
      operationalSystemSpec: source.operationalSystemSpec,
      operationalIR,
      compatibilityMode: "legacy",
    });
    validateAppBlueprintProjection({ appBlueprint, operationalSystemSpec: source.operationalSystemSpec, operationalIR });
    return deepFreeze({
      status: "ready" as const,
      appIntent,
      requirementGraph,
      comprehensionModel: source.comprehensionModel,
      operationalSystemSpec: source.operationalSystemSpec,
      operationalIR,
      compositionPlan,
      appBlueprint,
      humanReadableDiff: renderDiff(appIntent, compositionPlan, appBlueprint, input.availablePackages ?? [], input.existingApplications ?? []),
    });
  }
}

const SUBJECT_TERMS: Readonly<Record<string, RegExp>> = {
  customer: /\bcustomers?\b/i,
  employee: /\bemployees?\b/i,
  invoice: /\binvoices?\b/i,
  repository: /\brepositor(?:y|ies)\b/i,
  supplier: /\bsuppliers?\b/i,
};

const ACTIVITY_TERMS: Readonly<Record<string, RegExp>> = {
  approval: /\bapprov(?:al|e|ed|ing)\b/i,
  onboarding: /\bonboard(?:ing|ed)?\b/i,
  reporting: /\breport(?:ing|s)?\b/i,
  tracking: /\btrack(?:ing|ed)?\b/i,
};

const USER_TERMS: Readonly<Record<string, RegExp>> = {
  finance: /\bfinance\b/i,
  manager: /\bmanagers?\b/i,
  operator: /\boperators?\b/i,
};

const LEGACY_ADAPTER_TIME = "1970-01-01T00:00:00.000Z";

function createLegacyOperationalSource(
  appIntent: AppIntent,
  requirementGraph: SoftwareRequirementGraph,
  ambiguities: readonly IntentAmbiguity[],
): { readonly comprehensionModel: ComprehensionModel; readonly operationalSystemSpec: OperationalSystemSpec } {
  const actorIds = appIntent.users.map((role) => `operational-actor:legacy-${slug(role)}-${fingerprint(role)}`);
  const unknowns = ambiguities.map((ambiguity) => ({
    id: `unknown:legacy-${slug(ambiguity.id)}-${fingerprint(ambiguity.id)}`,
    question: ambiguity.question,
    blocking: ambiguity.blocking,
  }));
  const comprehensionIdentity = stableJson({ appIntent, requirementGraph, ambiguities });
  const comprehensionModel = defineComprehensionModel({
    id: `comprehension:legacy-${fingerprint(comprehensionIdentity)}`,
    version: "0.1.0",
    workspaceId: appIntent.workspaceId,
    objective: appIntent.objective,
    actors: actorIds,
    subjects: appIntent.subjects,
    relevantStateRefs: [],
    historyRefs: [],
    requirements: requirementGraph.nodes.map((node) => node.requirement),
    constraints: appIntent.constraints,
    invariants: [],
    rationale: ["Deterministic legacy AppIntent compatibility adapter"],
    assumptions: [],
    unknowns,
    conflicts: [],
    evidenceRefs: [],
    provenanceRefs: [appIntent.id],
    validTime: { from: LEGACY_ADAPTER_TIME },
    recordedAt: LEGACY_ADAPTER_TIME,
  });
  const legacyVerificationRequirements = normalizedList(
    requirementGraph.nodes.filter((node) => node.kind === "verification").map((node) => node.requirement),
  );
  const outcomeContractId = `outcome-contract:legacy-${fingerprint(stableJson({ intentRef: appIntent.id, successCriteria: appIntent.successCriteria }))}`;
  const operationalSystemSpec = defineOperationalSystemSpec({
    id: `operational-system-spec:legacy-${fingerprint(stableJson({ comprehensionModel, requirementGraph }))}`,
    version: "0.1.0",
    workspaceId: appIntent.workspaceId,
    comprehensionRef: comprehensionModel.id,
    goals: [appIntent.objective],
    requirements: requirementGraph.nodes
      .filter((node) => !["domain-object", "role", "surface", "automation", "metric"].includes(node.kind))
      .map((node) => ({
        id: `operational-requirement:legacy-${slug(node.kind)}-${fingerprint(node.id)}`,
        kind: operationalKindForLegacyRequirement(node.kind),
        statement: node.requirement,
        providerNeutral: true as const,
      })),
    invariants: [],
    actors: appIntent.users.map((role, index) => ({
      id: actorIds[index] as string,
      role,
      principalRefs: [],
    })),
    capabilities: appIntent.requiredEffects.map((requirement) => ({
      id: `operational-capability:legacy-${slug(requirement)}-${fingerprint(requirement)}`,
      requirement,
      providerNeutral: true as const,
    })),
    authorityRequirements: [],
    procedures: [],
    outcomeContracts: [{
      id: outcomeContractId,
      version: "0.1.0",
      objective: appIntent.objective,
      successAssertions: appIntent.successCriteria.map((description) => ({
        id: `outcome-assertion:legacy-${slug(description)}-${fingerprint(description)}`,
        description,
      })),
      invariants: [],
      requiredEvidenceRefs: [],
      verificationRequirements: legacyVerificationRequirements,
      effectConstraints: [],
      acceptanceAuthorityRequirements: [],
    }],
    epistemicState: {
      assumptionRefs: [],
      unknownRefs: comprehensionModel.unknowns.map((unknown) => unknown.id),
      conflictRefs: [],
    },
    externalSystemBindings: [],
    resources: appIntent.subjects.map((subject) => ({
      id: `operational-resource:legacy-${slug(subject)}-${fingerprint(subject)}`,
      kind: "SEMANTIC_OBJECT" as const,
      reference: `subject:${slug(subject)}`,
    })),
    attentionRules: [],
    lifecycleRules: [],
    projectionRequirements: [],
    provenanceRefs: [appIntent.id, comprehensionModel.id],
    validTime: { from: LEGACY_ADAPTER_TIME },
    recordedAt: LEGACY_ADAPTER_TIME,
  });
  return deepFreeze({ comprehensionModel, operationalSystemSpec });
}

function createProjectionIntent(comprehensionModel: ComprehensionModel, spec: OperationalSystemSpec): AppIntent {
  const activities = spec.requirements.filter((item) => item.kind === "ACTIVITY").map((item) => item.statement);
  const integrations = spec.requirements.filter((item) => item.kind === "INTEGRATION").map((item) => item.statement);
  const constraints = spec.requirements.filter((item) => item.kind === "CONSTRAINT").map((item) => item.statement);
  const collaboration = spec.requirements.filter((item) => item.kind === "COLLABORATION").map((item) => item.statement);
  const successCriteria = spec.outcomeContracts.flatMap((contract) => contract.successAssertions.map((assertion) => assertion.description));
  const objective = spec.goals.join("; ") || comprehensionModel.objective;
  const identity = stableJson({ comprehensionRef: comprehensionModel.id, specRef: spec.id, specVersion: spec.version });
  return deepFreeze({
    id: `app-intent:projection-${fingerprint(identity)}`,
    workspaceId: spec.workspaceId,
    objective,
    users: normalizedList(spec.actors.map((actor) => actor.role)),
    subjects: normalizedList(comprehensionModel.subjects),
    activities: normalizedList(activities),
    inputs: [],
    outputs: [],
    triggers: normalizedList(spec.attentionRules.map((rule) => rule.trigger)),
    decisions: normalizedList(spec.authorityRequirements.map((requirement) => requirement.operation)),
    requiredEffects: normalizedList(spec.capabilities.map((capability) => capability.requirement)),
    constraints: normalizedList(constraints),
    integrations: normalizedList([...integrations, ...spec.externalSystemBindings.map((binding) => binding.purpose)]),
    successCriteria: normalizedList(successCriteria),
    collaborationExpectations: normalizedList(collaboration),
    unresolvedQuestions: normalizedList(comprehensionModel.unknowns.map((unknown) => unknown.question)),
    provenance: [{ kind: "operational-system-spec" as const, value: spec.id }],
  });
}

function createProjectionRequirementGraph(
  appIntent: AppIntent,
  comprehensionModel: ComprehensionModel,
  spec: OperationalSystemSpec,
): SoftwareRequirementGraph {
  return createRequirementGraph(appIntent.id, [
    ...comprehensionModel.subjects.map((requirement) => ({ kind: "domain-object" as const, requirement })),
    ...spec.requirements.map((item) => ({ kind: requirementKindForOperational(item.kind), requirement: item.statement })),
    ...spec.actors.map((actor) => ({ kind: "role" as const, requirement: actor.role })),
    ...spec.capabilities.map((capability) => ({ kind: "capability" as const, requirement: capability.requirement })),
    ...spec.authorityRequirements.map((requirement) => ({ kind: "authority" as const, requirement: requirement.requirement })),
    ...spec.externalSystemBindings.map((binding) => ({ kind: "integration" as const, requirement: binding.purpose })),
    ...spec.outcomeContracts.flatMap((contract) => contract.verificationRequirements.map((requirement) => ({ kind: "verification" as const, requirement }))),
    { kind: "surface" as const, requirement: "workspace" },
  ]);
}

function createRequirementGraph(
  intentRef: string,
  requirements: readonly { readonly kind: RequirementKind; readonly requirement: string }[],
): SoftwareRequirementGraph {
  const unique = new Map<string, { readonly kind: RequirementKind; readonly requirement: string }>();
  for (const item of requirements) {
    const requirement = requiredText("software requirement", item.requirement);
    unique.set(`${item.kind}\u0000${requirement}`, { kind: item.kind, requirement });
  }
  const nodes = [...unique.values()]
    .map((item) => ({ ...item, id: `requirement:${item.kind}:${slug(item.requirement)}:${fingerprint(item.requirement)}` }))
    .sort(compareRequirementNodes);
  const activityNodes = nodes.filter((node) => node.kind === "activity");
  const dependencyNodes = nodes.filter((node) => ["domain-object", "capability", "surface", "collaboration"].includes(node.kind));
  const edges = activityNodes.flatMap((activity) => dependencyNodes.map((dependency) => ({
    from: activity.id,
    to: dependency.id,
    relation: "requires" as const,
  }))).sort(compareRequirementEdges);
  return deepFreeze({
    id: `software-requirement-graph:${fingerprint(stableJson({ intentRef, nodes, edges }))}`,
    intentRef,
    providerNeutral: true as const,
    nodes,
    edges,
  });
}

function bindCompositionPlan(
  plan: CompositionPlan,
  operationalSystemSpec: OperationalSystemSpec,
  operationalIR: OperationalIR,
): AppProjectionCompositionPlan {
  return deepFreeze({
    ...plan,
    operationalSystemSpecRef: operationalSystemSpec.id,
    operationalIRRef: operationalIR.id,
  });
}

function createAppBlueprintProjection(input: {
  readonly appIntent: AppIntent;
  readonly requirementGraph: SoftwareRequirementGraph;
  readonly compositionPlan: AppProjectionCompositionPlan;
  readonly comprehensionModel: ComprehensionModel;
  readonly operationalSystemSpec: OperationalSystemSpec;
  readonly operationalIR: OperationalIR;
  readonly compatibilityMode: "legacy" | "operational";
}): AppBlueprint {
  assertOperationalSource(input.comprehensionModel, input.operationalSystemSpec);
  if (
    input.compositionPlan.operationalSystemSpecRef !== input.operationalSystemSpec.id
    || input.compositionPlan.operationalIRRef !== input.operationalIR.id
  ) {
    throw new Error("CompositionPlan provenance does not match the App projection source");
  }
  const nodes = input.requirementGraph.nodes;
  const requirements = (kind: RequirementKind) => nodes.filter((node) => node.kind === kind).map((node) => node.requirement);
  const spec = input.operationalSystemSpec;
  const legacyCompatibility = input.compatibilityMode === "legacy";
  return deepFreeze({
    id: `app-blueprint:${fingerprint(stableJson({ intentRef: input.appIntent.id, graphRef: input.requirementGraph.id, planRef: input.compositionPlan.id }))}`,
    version: "1.0.0" as const,
    intentRef: input.appIntent.id,
    requirementGraphRef: input.requirementGraph.id,
    operationalSystemSpecRef: spec.id,
    operationalSystemSpecVersion: spec.version,
    operationalIRRef: input.operationalIR.id,
    outcomeContractRefs: [...input.operationalIR.outcomeContractRefs],
    projectionRequirementRefs: [...input.operationalIR.projectionRequirementRefs],
    verificationRequirementRefs: [...input.operationalIR.verificationRequirementRefs],
    outcomeContracts: [...spec.outcomeContracts],
    authorityRequirementDefinitions: [...spec.authorityRequirements],
    constraintRequirements: constraintRequirements(spec),
    acceptanceAuthorityRequirements: projectedAcceptanceAuthorityRequirements(spec),
    invariantDefinitions: [...spec.invariants],
    invariants: projectedInvariants(spec),
    goals: [...spec.goals],
    domainDependencies: requirements("domain-object"),
    domainExtensions: [],
    activityTypes: legacyCompatibility
      ? requirements("activity")
      : normalizedList([...requirements("activity"), ...spec.requirements.filter((item) => item.kind === "ACTIVITY").map((item) => item.statement)]),
    workPackages: [],
    capabilityRequirements: legacyCompatibility
      ? requirements("capability")
      : normalizedList([...requirements("capability"), ...spec.capabilities.map((capability) => capability.requirement)]),
    procedures: legacyCompatibility ? [] : spec.procedures.map((procedure) => procedure.id),
    automations: requirements("automation"),
    agentRoles: legacyCompatibility ? [] : normalizedList(spec.actors.map((actor) => actor.role)),
    surfaces: requirements("surface"),
    navigation: requirements("surface"),
    integrations: legacyCompatibility
      ? requirements("integration")
      : normalizedList([...requirements("integration"), ...spec.externalSystemBindings.map((binding) => binding.purpose)]),
    authorityRequirements: projectedAuthorityRequirements(spec),
    verificationContracts: projectedVerificationRequirements(spec),
    metrics: requirements("metric"),
    notifications: [],
    runtimeContextRequirements: legacyCompatibility
      ? requirements("runtime")
      : normalizedList([...requirements("runtime"), ...spec.requirements.filter((item) => item.kind === "RUNTIME").map((item) => item.statement)]),
    personalizationRules: [],
    collaborationContract: {
      participantTypes: ["human" as const, "agent" as const],
      sharedObjects: requirements("domain-object"),
      activities: legacyCompatibility
        ? requirements("activity")
        : normalizedList([...requirements("activity"), ...spec.requirements.filter((item) => item.kind === "ACTIVITY").map((item) => item.statement)]),
    },
    publicSurfaceContracts: legacyCompatibility
      ? []
      : spec.projectionRequirements.filter((requirement) => requirement.projectionKind === "APP").map((requirement) => requirement.requirement),
    packageDependencies: input.compositionPlan.selectedPackage === undefined ? [] : [input.compositionPlan.selectedPackage],
    migrationRequirements: [],
    compatibilityRequirements: input.compositionPlan.selectedPackage === undefined ? [] : ["package-version-compatible"],
    provenance: normalizedList([
      input.appIntent.id,
      input.requirementGraph.id,
      input.compositionPlan.id,
      input.comprehensionModel.id,
      spec.id,
      input.operationalIR.id,
      ...spec.provenanceRefs,
    ]),
  });
}

function assertOperationalSource(comprehensionModel: ComprehensionModel, spec: OperationalSystemSpec): void {
  if (spec.comprehensionRef !== comprehensionModel.id) {
    throw new Error(`OperationalSystemSpec comprehensionRef does not match source comprehension: ${spec.comprehensionRef}`);
  }
  if (spec.workspaceId !== comprehensionModel.workspaceId) {
    throw new Error(`OperationalSystemSpec workspace does not match source comprehension: ${spec.workspaceId}`);
  }
}

function constraintRequirements(spec: OperationalSystemSpec): readonly OperationalRequirement[] {
  return spec.requirements.filter((requirement) => requirement.kind === "CONSTRAINT");
}

function projectedAuthorityRequirements(spec: OperationalSystemSpec): readonly string[] {
  return normalizedList([
    ...spec.requirements.filter((requirement) => requirement.kind === "AUTHORITY").map((requirement) => requirement.statement),
    ...spec.authorityRequirements.map((requirement) => requirement.requirement),
  ]);
}

function projectedAcceptanceAuthorityRequirements(spec: OperationalSystemSpec): readonly string[] {
  return normalizedList(spec.outcomeContracts.flatMap((contract) => contract.acceptanceAuthorityRequirements));
}

function projectedVerificationRequirements(spec: OperationalSystemSpec): readonly string[] {
  return normalizedList([
    ...spec.requirements.filter((requirement) => requirement.kind === "VERIFICATION").map((requirement) => requirement.statement),
    ...spec.outcomeContracts.flatMap((contract) => contract.verificationRequirements),
  ]);
}

function projectedInvariants(spec: OperationalSystemSpec): readonly string[] {
  return normalizedList([
    ...spec.invariants.map((invariant) => invariant.statement),
    ...spec.outcomeContracts.flatMap((contract) => contract.invariants),
  ]);
}

function assertProjectionEquivalent(name: string, actual: unknown, expected: unknown): void {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(`AppBlueprint ${name} must exactly match its source OperationalSystemSpec`);
  }
}

function operationalKindForLegacyRequirement(kind: RequirementKind): OperationalRequirement["kind"] {
  switch (kind) {
    case "domain-object": return "STATE";
    case "activity": return "ACTIVITY";
    case "role": return "COLLABORATION";
    case "surface": return "RUNTIME";
    case "capability": return "CAPABILITY";
    case "integration": return "INTEGRATION";
    case "automation": return "ACTIVITY";
    case "authority": return "AUTHORITY";
    case "verification": return "VERIFICATION";
    case "collaboration": return "COLLABORATION";
    case "metric": return "VERIFICATION";
    case "runtime": return "RUNTIME";
    case "constraint": return "CONSTRAINT";
  }
}

function requirementKindForOperational(kind: OperationalRequirement["kind"]): RequirementKind {
  switch (kind) {
    case "STATE": return "domain-object";
    case "ACTIVITY": return "activity";
    case "AUTHORITY": return "authority";
    case "CAPABILITY": return "capability";
    case "INTEGRATION": return "integration";
    case "COLLABORATION": return "collaboration";
    case "RUNTIME": return "runtime";
    case "VERIFICATION": return "verification";
    case "CONSTRAINT": return "constraint";
  }
}

function renderDiff(appIntent: AppIntent, plan: CompositionPlan, blueprint: AppBlueprint, packages: readonly ApplicationPackageCandidate[], applications: readonly ExistingApplication[]): string {
  let headline: string;
  if (plan.operation === "install") {
    const selected = packages.find((item) => item.id === plan.selectedPackage?.id);
    headline = `Reuse ${selected?.name ?? plan.selectedPackage?.id}@${plan.selectedPackage?.version}`;
  } else if (plan.operation === "update") {
    const target = applications.find((item) => item.id === plan.targetApplicationId);
    headline = `Update ${target?.name ?? plan.targetApplicationId}`;
  } else if (plan.operation === "none") {
    const target = applications.find((item) => item.id === plan.targetApplicationId);
    headline = `No change to ${target?.name ?? plan.targetApplicationId}`;
  } else {
    headline = "Generate the missing App definition";
  }
  return [
    headline,
    `Goal: ${appIntent.objective}`,
    `Shared objects: ${blueprint.domainDependencies.join(", ") || "none identified"}`,
    `Activities: ${blueprint.activityTypes.join(", ") || "none identified"}`,
    `Capabilities: ${blueprint.capabilityRequirements.join(", ") || "none"}`,
  ].join("\n");
}

function normalizeAmbiguities(values: readonly IntentAmbiguity[]): readonly IntentAmbiguity[] {
  const ids = new Set<string>();
  return values.map((item) => {
    const id = requiredText("ambiguity id", item.id);
    if (ids.has(id)) throw new Error(`duplicate ambiguity id: ${id}`);
    ids.add(id);
    return deepFreeze({ id, blocking: item.blocking, question: requiredText("ambiguity question", item.question) });
  });
}

function extract(value: string, vocabulary: Readonly<Record<string, RegExp>>): readonly string[] {
  return Object.entries(vocabulary).filter(([, pattern]) => pattern.test(value)).map(([term]) => term).sort();
}

function extractConstraints(value: string): readonly string[] {
  const constraints: string[] = [];
  if (/\brequire(?:d|s)?\b/i.test(value)) constraints.push("required");
  if (/\bmust\b/i.test(value)) constraints.push("must");
  return constraints;
}

function bestApplication(intent: AppIntent, values: readonly ExistingApplication[]): ExistingApplication | undefined {
  const best = [...values].sort((left, right) => matchScore(intent, right) - matchScore(intent, left) || left.id.localeCompare(right.id))[0];
  return best === undefined || matchScore(intent, best) <= 0 ? undefined : best;
}

function matchScore(intent: AppIntent, candidate: Pick<ApplicationPackageCandidate, "objective" | "subjects" | "activities"> | Pick<ExistingApplication, "objective" | "subjects" | "activities">): number {
  const intentTerms = new Set([...intent.subjects, ...intent.activities, ...tokens(intent.objective)]);
  return [...candidate.subjects, ...candidate.activities, ...tokens(candidate.objective)].filter((item) => intentTerms.has(item)).length;
}

function tokens(value: string): readonly string[] {
  return [...new Set(value.toLocaleLowerCase("en-US").split(/[^a-z0-9]+/).filter((item) => item.length > 2))].sort();
}

function preferenceRank(value: CompositionStrategy): number {
  return COMPOSITION_PREFERENCE.indexOf(value);
}

function compareRequirementNodes(left: SoftwareRequirementNode, right: SoftwareRequirementNode): number {
  return left.kind.localeCompare(right.kind) || left.requirement.localeCompare(right.requirement) || left.id.localeCompare(right.id);
}

function compareRequirementEdges(left: SoftwareRequirementEdge, right: SoftwareRequirementEdge): number {
  return left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.relation.localeCompare(right.relation);
}

function normalizedList(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((item) => requiredText("list item", item)))].sort();
}

function semanticVersion(value: string): string {
  const version = requiredText("version", value);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new TypeError(`version must use major.minor.patch: ${version}`);
  return version;
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

function slug(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "requirement";
}

function fingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
