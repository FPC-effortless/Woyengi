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
  readonly provenance: readonly { readonly kind: "natural-language"; readonly value: string }[];
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

export interface AppBlueprint {
  readonly id: string;
  readonly version: "1.0.0";
  readonly intentRef: string;
  readonly requirementGraphRef: string;
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

export interface ReadyIntentCompilation {
  readonly status: "ready";
  readonly appIntent: AppIntent;
  readonly requirementGraph: SoftwareRequirementGraph;
  readonly compositionPlan: CompositionPlan;
  readonly appBlueprint: AppBlueprint;
  readonly humanReadableDiff: string;
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
  const requirements: { readonly kind: RequirementKind; readonly requirement: string }[] = [
    ...appIntent.subjects.map((requirement) => ({ kind: "domain-object" as const, requirement })),
    ...appIntent.activities.map((requirement) => ({ kind: "activity" as const, requirement })),
    ...appIntent.users.map((requirement) => ({ kind: "role" as const, requirement })),
    { kind: "surface", requirement: "workspace" },
    ...appIntent.requiredEffects.map((requirement) => ({ kind: "capability" as const, requirement })),
    ...appIntent.integrations.map((requirement) => ({ kind: "integration" as const, requirement })),
    ...appIntent.constraints.map((requirement) => ({ kind: "constraint" as const, requirement })),
    ...appIntent.collaborationExpectations.map((requirement) => ({ kind: "collaboration" as const, requirement })),
    ...appIntent.successCriteria.map((requirement) => ({ kind: "verification" as const, requirement })),
  ];
  const nodes = requirements
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
    id: `software-requirement-graph:${fingerprint(stableJson({ intentRef: appIntent.id, nodes, edges }))}`,
    intentRef: appIntent.id,
    providerNeutral: true as const,
    nodes,
    edges,
  });
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
  const nodes = input.requirementGraph.nodes;
  const requirements = (kind: RequirementKind) => nodes.filter((node) => node.kind === kind).map((node) => node.requirement);
  return deepFreeze({
    id: `app-blueprint:${fingerprint(stableJson({ intentRef: input.appIntent.id, graphRef: input.requirementGraph.id, planRef: input.compositionPlan.id }))}`,
    version: "1.0.0" as const,
    intentRef: input.appIntent.id,
    requirementGraphRef: input.requirementGraph.id,
    goals: [input.appIntent.objective],
    domainDependencies: requirements("domain-object"),
    domainExtensions: [],
    activityTypes: requirements("activity"),
    workPackages: [],
    capabilityRequirements: requirements("capability"),
    procedures: [],
    automations: requirements("automation"),
    agentRoles: [],
    surfaces: requirements("surface"),
    navigation: requirements("surface"),
    integrations: requirements("integration"),
    authorityRequirements: requirements("authority"),
    verificationContracts: requirements("verification"),
    metrics: requirements("metric"),
    notifications: [],
    runtimeContextRequirements: requirements("runtime"),
    personalizationRules: [],
    collaborationContract: {
      participantTypes: ["human" as const, "agent" as const],
      sharedObjects: requirements("domain-object"),
      activities: requirements("activity"),
    },
    publicSurfaceContracts: [],
    packageDependencies: input.compositionPlan.selectedPackage === undefined ? [] : [input.compositionPlan.selectedPackage],
    migrationRequirements: [],
    compatibilityRequirements: input.compositionPlan.selectedPackage === undefined ? [] : ["package-version-compatible"],
    provenance: [input.appIntent.id, input.requirementGraph.id, input.compositionPlan.id],
  });
}

export class IntentCompiler {
  compile(input: CompileIntentInput): IntentCompilation {
    const appIntent = createAppIntent(input);
    const blocking = normalizeAmbiguities(input.ambiguities ?? []).filter((item) => item.blocking);
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
    const compositionPlan = createCompositionPlan({
      appIntent,
      requirementGraph,
      ...(input.availablePackages === undefined ? {} : { availablePackages: input.availablePackages }),
      ...(input.existingApplications === undefined ? {} : { existingApplications: input.existingApplications }),
      ...(input.changeTargetAppId === undefined ? {} : { changeTargetAppId: input.changeTargetAppId }),
    });
    const appBlueprint = createAppBlueprint({ appIntent, requirementGraph, compositionPlan });
    return deepFreeze({
      status: "ready" as const,
      appIntent,
      requirementGraph,
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
