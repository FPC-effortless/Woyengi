export type OperationalValue =
  | null
  | boolean
  | number
  | string
  | readonly OperationalValue[]
  | { readonly [key: string]: OperationalValue };

export interface TemporalScope {
  readonly from: string;
  readonly to?: string;
}

export interface ComprehensionAssumption {
  readonly id: string;
  readonly statement: string;
  readonly confidence: number;
  readonly evidenceRefs: readonly string[];
}

export interface ComprehensionUnknown {
  readonly id: string;
  readonly question: string;
  readonly blocking: boolean;
}

export interface ComprehensionConflict {
  readonly id: string;
  readonly description: string;
  readonly candidateRefs: readonly string[];
}

export interface ComprehensionModelInput {
  readonly id: string;
  readonly version: string;
  readonly workspaceId: string;
  readonly objective: string;
  readonly actors: readonly string[];
  readonly subjects: readonly string[];
  readonly relevantStateRefs: readonly string[];
  readonly historyRefs: readonly string[];
  readonly requirements: readonly string[];
  readonly constraints: readonly string[];
  readonly invariants: readonly string[];
  readonly rationale: readonly string[];
  readonly assumptions: readonly ComprehensionAssumption[];
  readonly unknowns: readonly ComprehensionUnknown[];
  readonly conflicts: readonly ComprehensionConflict[];
  readonly evidenceRefs: readonly string[];
  readonly provenanceRefs: readonly string[];
  readonly validTime: TemporalScope;
  readonly recordedAt: string;
}

export interface ComprehensionModel extends ComprehensionModelInput {
  readonly contract: "woyengi.comprehension-model.v0.1";
}

export type OutcomeEffectClass = "RUNTIME" | "SEMANTIC" | "EXTERNAL";
export type OutcomeEffectPolicy = "ALLOW" | "FORBID" | "REQUIRE_RECONCILIATION";

export interface OutcomeAssertion {
  readonly id: string;
  readonly description: string;
}

export interface OutcomeEffectConstraint {
  readonly effectClass: OutcomeEffectClass;
  readonly policy: OutcomeEffectPolicy;
}

export interface OutcomeBudget {
  readonly maximumCost: number;
  readonly currency: string;
  readonly maximumAttempts: number;
}

export interface OutcomeTermination {
  readonly mode: "VERIFIED" | "VERIFIED_OR_REVIEW" | "EXPLICIT_ACCEPTANCE";
  readonly reviewRequiredOnInconclusive: boolean;
}

export interface OutcomeContractInput {
  readonly id: string;
  readonly version: string;
  readonly objective: string;
  readonly successAssertions: readonly OutcomeAssertion[];
  readonly invariants: readonly string[];
  readonly requiredEvidenceRefs: readonly string[];
  readonly verificationRequirements: readonly string[];
  readonly effectConstraints: readonly OutcomeEffectConstraint[];
  readonly budget?: OutcomeBudget;
  readonly termination?: OutcomeTermination;
  readonly acceptanceAuthorityRequirements: readonly string[];
}

export interface OutcomeContract extends OutcomeContractInput {
  readonly contract: "woyengi.outcome-contract.v0.1";
}

export type OperationalRequirementKind =
  | "STATE"
  | "ACTIVITY"
  | "AUTHORITY"
  | "CAPABILITY"
  | "INTEGRATION"
  | "COLLABORATION"
  | "RUNTIME"
  | "VERIFICATION"
  | "CONSTRAINT";

export interface OperationalRequirement {
  readonly id: string;
  readonly kind: OperationalRequirementKind;
  readonly statement: string;
  readonly providerNeutral: true;
}

export interface OperationalInvariantDefinition {
  readonly id: string;
  readonly statement: string;
  readonly severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface OperationalActor {
  readonly id: string;
  readonly role: string;
  readonly principalRefs: readonly string[];
}

export interface OperationalCapabilityRequirement {
  readonly id: string;
  readonly requirement: string;
  readonly providerNeutral: true;
}

export interface OperationalAuthorityRequirement {
  readonly id: string;
  readonly operation: string;
  readonly requirement: string;
}

export interface OperationalProcedure {
  readonly id: string;
  readonly name: string;
  readonly capabilityRefs: readonly string[];
  readonly outcomeContractRefs: readonly string[];
  readonly steps: readonly string[];
}

export interface OperationalEpistemicState {
  readonly assumptionRefs: readonly string[];
  readonly unknownRefs: readonly string[];
  readonly conflictRefs: readonly string[];
}

export interface ExternalSystemBindingRequirement {
  readonly id: string;
  readonly purpose: string;
  readonly capabilityRefs: readonly string[];
  readonly providerNeutral: true;
}

export interface OperationalResource {
  readonly id: string;
  readonly kind: "SEMANTIC_OBJECT" | "ARTIFACT" | "COMPUTE" | "EXTERNAL_SYSTEM" | "HUMAN_ATTENTION";
  readonly reference: string;
}

export interface OperationalAttentionRule {
  readonly id: string;
  readonly trigger: string;
  readonly requiredAction: string;
}

export interface OperationalLifecycleRule {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly condition: string;
}

export interface OperationalProjectionRequirement {
  readonly id: string;
  readonly projectionKind: "APP" | "WORK" | "AGENT" | "API" | "WORLD";
  readonly requirement: string;
  readonly outcomeContractRefs: readonly string[];
}

export interface OperationalSystemSpecInput {
  readonly id: string;
  readonly version: string;
  readonly workspaceId: string;
  readonly comprehensionRef: string;
  readonly goals: readonly string[];
  readonly requirements: readonly OperationalRequirement[];
  readonly invariants: readonly OperationalInvariantDefinition[];
  readonly actors: readonly OperationalActor[];
  readonly capabilities: readonly OperationalCapabilityRequirement[];
  readonly authorityRequirements: readonly OperationalAuthorityRequirement[];
  readonly procedures: readonly OperationalProcedure[];
  readonly outcomeContracts: readonly OutcomeContractInput[];
  readonly epistemicState: OperationalEpistemicState;
  readonly externalSystemBindings: readonly ExternalSystemBindingRequirement[];
  readonly resources: readonly OperationalResource[];
  readonly attentionRules: readonly OperationalAttentionRule[];
  readonly lifecycleRules: readonly OperationalLifecycleRule[];
  readonly projectionRequirements: readonly OperationalProjectionRequirement[];
  readonly provenanceRefs: readonly string[];
  readonly validTime: TemporalScope;
  readonly recordedAt: string;
}

export interface OperationalSystemSpec extends Omit<OperationalSystemSpecInput, "outcomeContracts"> {
  readonly contract: "woyengi.operational-system-spec.v0.1";
  readonly outcomeContracts: readonly OutcomeContract[];
}

export interface OperationalIRCompileInput {
  readonly compilerVersion: string;
}

export interface OperationalIR {
  readonly contract: "woyengi.operational-ir.v0.1";
  readonly id: string;
  readonly version: "0.1.0";
  readonly sourceSpecRef: string;
  readonly sourceSpecVersion: string;
  readonly compilerVersion: string;
  readonly resourceRefs: readonly string[];
  readonly activityRequirementRefs: readonly string[];
  readonly dependencies: readonly { readonly from: string; readonly to: string; readonly relation: "REQUIRES" | "GOVERNS" | "VERIFIES" }[];
  readonly capabilityRequirementRefs: readonly string[];
  readonly procedureRefs: readonly string[];
  readonly authorityRequirementRefs: readonly string[];
  readonly outcomeContractRefs: readonly string[];
  readonly verificationRequirementRefs: readonly string[];
  readonly externalBindingRefs: readonly string[];
  readonly projectionRequirementRefs: readonly string[];
  readonly provenanceRefs: readonly string[];
}

export interface WorldActionDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: "READ" | "WRITE" | "EXECUTE" | "COMMUNICATE" | "ESCALATE" | "SUBMIT";
}

export interface WorldAssetDescriptor {
  readonly id: string;
  readonly kind: string;
  readonly format?: string;
  readonly contentHash?: string;
}

export interface WorldBundlePublicPartition {
  readonly objective: string;
  readonly actorRoles: readonly string[];
  readonly actionSurface: readonly WorldActionDescriptor[];
  readonly observationRefs: readonly string[];
  readonly assetDescriptors: readonly WorldAssetDescriptor[];
  readonly outcomeContractRefs: readonly string[];
  readonly provenanceRefs: readonly string[];
}

export interface WorldBundlePrivateEvaluatorPartition {
  readonly targetAssertionRefs: readonly string[];
  readonly invariantRefs: readonly string[];
  readonly hiddenEffectRefs: readonly string[];
  readonly evidenceLocatorRefs: readonly string[];
}

export interface WorldBundlePartitionMember {
  readonly id: string;
  readonly partition: "public" | "private-evaluator";
  readonly kind: string;
}

export interface WorldBundleInput {
  readonly id: string;
  readonly version: string;
  readonly sourceSpecRef: string;
  readonly sourceSpecVersion: string;
  readonly compatibility: { readonly minimumRuntimeVersion: string };
  readonly public: WorldBundlePublicPartition;
  readonly privateEvaluator?: WorldBundlePrivateEvaluatorPartition;
  readonly partitionManifest: readonly WorldBundlePartitionMember[];
  readonly provenanceRefs: readonly string[];
}

export interface WorldBundle extends Omit<WorldBundleInput, "version" | "sourceSpecVersion" | "compatibility"> {
  readonly contract: "woyengi.world-bundle.v0.1";
  readonly version: "0.1.0";
  readonly sourceSpecVersion: string;
  readonly compatibility: { readonly minimumRuntimeVersion: string };
}

export function defineComprehensionModel(input: ComprehensionModelInput): ComprehensionModel {
  const assumptions = input.assumptions.map((item) => {
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
      throw new RangeError(`assumption confidence must be between 0 and 1: ${item.id}`);
    }
    return {
      id: namespaced("assumption id", item.id, "assumption:"),
      statement: requiredText("assumption statement", item.statement),
      confidence: item.confidence,
      evidenceRefs: normalizedNamespacedList("assumption evidence reference", item.evidenceRefs),
    };
  }).sort(compareById);
  assertUniqueIds("assumption", assumptions);

  const unknowns = input.unknowns.map((item) => ({
    id: namespaced("unknown id", item.id, "unknown:"),
    question: requiredText("unknown question", item.question),
    blocking: item.blocking,
  })).sort(compareById);
  assertUniqueIds("unknown", unknowns);

  const conflicts = input.conflicts.map((item) => ({
    id: namespaced("conflict id", item.id, "conflict:"),
    description: requiredText("conflict description", item.description),
    candidateRefs: normalizedNamespacedList("conflict candidate reference", item.candidateRefs),
  })).sort(compareById);
  assertUniqueIds("conflict", conflicts);

  return deepFreeze({
    contract: "woyengi.comprehension-model.v0.1" as const,
    id: namespaced("comprehension id", input.id, "comprehension:"),
    version: semanticVersion(input.version),
    workspaceId: namespaced("workspace id", input.workspaceId, "workspace:"),
    objective: requiredText("comprehension objective", input.objective),
    actors: normalizedNamespacedList("actor reference", input.actors),
    subjects: normalizedList(input.subjects),
    relevantStateRefs: normalizedNamespacedList("relevant state reference", input.relevantStateRefs),
    historyRefs: normalizedNamespacedList("history reference", input.historyRefs),
    requirements: normalizedList(input.requirements),
    constraints: normalizedList(input.constraints),
    invariants: normalizedList(input.invariants),
    rationale: normalizedList(input.rationale),
    assumptions,
    unknowns,
    conflicts,
    evidenceRefs: normalizedNamespacedList("evidence reference", input.evidenceRefs),
    provenanceRefs: normalizedNamespacedList("provenance reference", input.provenanceRefs),
    validTime: temporalScope(input.validTime),
    recordedAt: normalizeInstant(input.recordedAt),
  });
}

export function defineOutcomeContract(input: OutcomeContractInput): OutcomeContract {
  const assertions = input.successAssertions.map((item) => ({
    id: namespaced("outcome assertion id", item.id, "outcome-assertion:"),
    description: requiredText("outcome assertion description", item.description),
  })).sort(compareById);
  assertUniqueIds("outcome assertion", assertions);

  const effectConstraints = input.effectConstraints.map((item) => ({
    effectClass: outcomeEffectClass(item.effectClass),
    policy: outcomeEffectPolicy(item.policy),
  })).sort((left, right) => left.effectClass.localeCompare(right.effectClass) || left.policy.localeCompare(right.policy));
  const duplicateEffectClasses = duplicates(effectConstraints.map((item) => item.effectClass));
  if (duplicateEffectClasses.length > 0) throw new Error(`duplicate outcome effect class: ${duplicateEffectClasses.join(", ")}`);

  const budget = input.budget === undefined ? undefined : normalizeBudget(input.budget);
  const termination = input.termination === undefined ? undefined : {
    mode: outcomeTerminationMode(input.termination.mode),
    reviewRequiredOnInconclusive: input.termination.reviewRequiredOnInconclusive,
  };

  return deepFreeze({
    contract: "woyengi.outcome-contract.v0.1" as const,
    id: namespaced("outcome contract id", input.id, "outcome-contract:"),
    version: semanticVersion(input.version),
    objective: requiredText("outcome objective", input.objective),
    successAssertions: assertions,
    invariants: normalizedList(input.invariants),
    requiredEvidenceRefs: normalizedNamespacedList("required evidence reference", input.requiredEvidenceRefs),
    verificationRequirements: normalizedList(input.verificationRequirements),
    effectConstraints,
    ...(budget === undefined ? {} : { budget }),
    ...(termination === undefined ? {} : { termination }),
    acceptanceAuthorityRequirements: normalizedNamespacedList("acceptance authority requirement", input.acceptanceAuthorityRequirements),
  });
}

export function defineOperationalSystemSpec(input: OperationalSystemSpecInput): OperationalSystemSpec {
  const requirements = input.requirements.map((item) => {
    assertProviderNeutral("operational requirement", item.providerNeutral);
    return {
      id: namespaced("operational requirement id", item.id, "operational-requirement:"),
      kind: operationalRequirementKind(item.kind),
      statement: requiredText("operational requirement statement", item.statement),
      providerNeutral: true as const,
    };
  }).sort(compareById);
  assertUniqueIds("operational requirement", requirements);

  const invariants = input.invariants.map((item) => ({
    id: namespaced("operational invariant id", item.id, "operational-invariant:"),
    statement: requiredText("operational invariant statement", item.statement),
    severity: invariantSeverity(item.severity),
  })).sort(compareById);
  assertUniqueIds("operational invariant", invariants);

  const actors = input.actors.map((item) => ({
    id: namespaced("operational actor id", item.id, "operational-actor:"),
    role: requiredText("operational actor role", item.role),
    principalRefs: normalizedNamespacedList("actor principal reference", item.principalRefs),
  })).sort(compareById);
  assertUniqueIds("operational actor", actors);

  const capabilities = input.capabilities.map((item) => {
    assertProviderNeutral("operational capability", item.providerNeutral);
    return {
      id: namespaced("operational capability id", item.id, "operational-capability:"),
      requirement: requiredText("operational capability requirement", item.requirement),
      providerNeutral: true as const,
    };
  }).sort(compareById);
  assertUniqueIds("operational capability", capabilities);
  const capabilityIds = new Set(capabilities.map((item) => item.id));

  const authorityRequirements = input.authorityRequirements.map((item) => ({
    id: namespaced("authority requirement id", item.id, "authority-requirement:"),
    operation: requiredText("authority operation", item.operation),
    requirement: requiredText("authority requirement", item.requirement),
  })).sort(compareById);
  assertUniqueIds("authority requirement", authorityRequirements);

  const outcomeContracts = input.outcomeContracts.map((item) => defineOutcomeContract(item)).sort(compareById);
  assertUniqueIds("outcome contract", outcomeContracts);
  const outcomeContractIds = new Set(outcomeContracts.map((item) => item.id));

  const procedures = input.procedures.map((item) => {
    const capabilityRefs = normalizedNamespacedList("procedure capability reference", item.capabilityRefs, "operational-capability:");
    for (const ref of capabilityRefs) {
      if (!capabilityIds.has(ref)) throw new Error(`unknown capability reference in ${item.id}: ${ref}`);
    }
    const outcomeContractRefs = normalizedNamespacedList("procedure outcome contract reference", item.outcomeContractRefs, "outcome-contract:");
    for (const ref of outcomeContractRefs) {
      if (!outcomeContractIds.has(ref)) throw new Error(`unknown outcome contract reference in ${item.id}: ${ref}`);
    }
    return {
      id: namespaced("operational procedure id", item.id, "operational-procedure:"),
      name: requiredText("operational procedure name", item.name),
      capabilityRefs,
      outcomeContractRefs,
      steps: normalizedOrderedList(item.steps),
    };
  }).sort(compareById);
  assertUniqueIds("operational procedure", procedures);

  const externalSystemBindings = input.externalSystemBindings.map((item) => {
    assertProviderNeutral("external system binding", item.providerNeutral);
    const capabilityRefs = normalizedNamespacedList("external binding capability reference", item.capabilityRefs, "operational-capability:");
    for (const ref of capabilityRefs) {
      if (!capabilityIds.has(ref)) throw new Error(`unknown capability reference in ${item.id}: ${ref}`);
    }
    return {
      id: namespaced("external binding id", item.id, "external-binding:"),
      purpose: requiredText("external binding purpose", item.purpose),
      capabilityRefs,
      providerNeutral: true as const,
    };
  }).sort(compareById);
  assertUniqueIds("external binding", externalSystemBindings);

  const resources = input.resources.map((item) => ({
    id: namespaced("operational resource id", item.id, "operational-resource:"),
    kind: operationalResourceKind(item.kind),
    reference: namespaced("operational resource reference", item.reference),
  })).sort(compareById);
  assertUniqueIds("operational resource", resources);

  const attentionRules = input.attentionRules.map((item) => ({
    id: namespaced("attention rule id", item.id, "attention-rule:"),
    trigger: requiredText("attention trigger", item.trigger),
    requiredAction: requiredText("attention required action", item.requiredAction),
  })).sort(compareById);
  assertUniqueIds("attention rule", attentionRules);

  const lifecycleRules = input.lifecycleRules.map((item) => ({
    id: namespaced("lifecycle rule id", item.id, "lifecycle-rule:"),
    from: requiredText("lifecycle from", item.from),
    to: requiredText("lifecycle to", item.to),
    condition: requiredText("lifecycle condition", item.condition),
  })).sort(compareById);
  assertUniqueIds("lifecycle rule", lifecycleRules);

  const projectionRequirements = input.projectionRequirements.map((item) => {
    const outcomeContractRefs = normalizedNamespacedList("projection outcome contract reference", item.outcomeContractRefs, "outcome-contract:");
    for (const ref of outcomeContractRefs) {
      if (!outcomeContractIds.has(ref)) throw new Error(`unknown outcome contract reference in ${item.id}: ${ref}`);
    }
    return {
      id: namespaced("projection requirement id", item.id, "projection-requirement:"),
      projectionKind: projectionKind(item.projectionKind),
      requirement: requiredText("projection requirement", item.requirement),
      outcomeContractRefs,
    };
  }).sort(compareById);
  assertUniqueIds("projection requirement", projectionRequirements);

  return deepFreeze({
    contract: "woyengi.operational-system-spec.v0.1" as const,
    id: namespaced("OperationalSystemSpec id", input.id, "operational-system-spec:"),
    version: semanticVersion(input.version),
    workspaceId: namespaced("workspace id", input.workspaceId, "workspace:"),
    comprehensionRef: namespaced("comprehension reference", input.comprehensionRef, "comprehension:"),
    goals: normalizedList(input.goals),
    requirements,
    invariants,
    actors,
    capabilities,
    authorityRequirements,
    procedures,
    outcomeContracts,
    epistemicState: {
      assumptionRefs: normalizedNamespacedList("epistemic assumption reference", input.epistemicState.assumptionRefs, "assumption:"),
      unknownRefs: normalizedNamespacedList("epistemic unknown reference", input.epistemicState.unknownRefs, "unknown:"),
      conflictRefs: normalizedNamespacedList("epistemic conflict reference", input.epistemicState.conflictRefs, "conflict:"),
    },
    externalSystemBindings,
    resources,
    attentionRules,
    lifecycleRules,
    projectionRequirements,
    provenanceRefs: normalizedNamespacedList("OperationalSystemSpec provenance reference", input.provenanceRefs),
    validTime: temporalScope(input.validTime),
    recordedAt: normalizeInstant(input.recordedAt),
  });
}

export function compileOperationalIR(input: OperationalSystemSpec, options: OperationalIRCompileInput): OperationalIR {
  const spec = defineOperationalSystemSpec(input);
  const compilerVersion = semanticVersion(options.compilerVersion);
  const activityRequirementRefs = spec.requirements.filter((item) => item.kind === "ACTIVITY").map((item) => item.id);
  const verificationRequirementRefs = uniqueSorted(spec.outcomeContracts.flatMap((contract) => contract.verificationRequirements.map((requirement) => `verification-requirement:${fingerprint(requirement)}`)));
  const dependencies = spec.procedures.flatMap((procedure) => [
    ...procedure.capabilityRefs.map((capabilityRef) => ({ from: procedure.id, to: capabilityRef, relation: "REQUIRES" as const })),
    ...procedure.outcomeContractRefs.map((outcomeRef) => ({ from: procedure.id, to: outcomeRef, relation: "VERIFIES" as const })),
  ]).sort(compareDependency);
  const identity = stableJson({ sourceSpec: spec, compilerVersion });
  return deepFreeze({
    contract: "woyengi.operational-ir.v0.1" as const,
    id: `operational-ir:${fingerprint(identity)}`,
    version: "0.1.0" as const,
    sourceSpecRef: spec.id,
    sourceSpecVersion: spec.version,
    compilerVersion,
    resourceRefs: spec.resources.map((item) => item.id),
    activityRequirementRefs,
    dependencies,
    capabilityRequirementRefs: spec.capabilities.map((item) => item.id),
    procedureRefs: spec.procedures.map((item) => item.id),
    authorityRequirementRefs: spec.authorityRequirements.map((item) => item.id),
    outcomeContractRefs: spec.outcomeContracts.map((item) => item.id),
    verificationRequirementRefs,
    externalBindingRefs: spec.externalSystemBindings.map((item) => item.id),
    projectionRequirementRefs: spec.projectionRequirements.map((item) => item.id),
    provenanceRefs: uniqueSorted([spec.id, spec.comprehensionRef, ...spec.provenanceRefs]),
  });
}

export function defineWorldBundle(input: WorldBundleInput): WorldBundle {
  const actionSurface = input.public.actionSurface.map((item) => ({
    id: namespaced("world action id", item.id, "world-action:"),
    name: requiredText("world action name", item.name),
    kind: worldActionKind(item.kind),
  })).sort(compareById);
  assertUniqueIds("world action", actionSurface);

  const assetDescriptors = input.public.assetDescriptors.map((item) => ({
    id: namespaced("world asset id", item.id, "world-asset:"),
    kind: requiredText("world asset kind", item.kind),
    ...(item.format === undefined ? {} : { format: requiredText("world asset format", item.format) }),
    ...(item.contentHash === undefined ? {} : { contentHash: requiredText("world asset content hash", item.contentHash) }),
  })).sort(compareById);
  assertUniqueIds("world asset", assetDescriptors);

  const publicPartition = {
    objective: requiredText("world objective", input.public.objective),
    actorRoles: normalizedList(input.public.actorRoles),
    actionSurface,
    observationRefs: normalizedNamespacedList("world observation reference", input.public.observationRefs),
    assetDescriptors,
    outcomeContractRefs: normalizedNamespacedList("world outcome contract reference", input.public.outcomeContractRefs, "outcome-contract:"),
    provenanceRefs: normalizedNamespacedList("world public provenance reference", input.public.provenanceRefs),
  };
  rejectPrivateReferences(publicPartition.observationRefs, "public observation");
  rejectPrivateReferences(publicPartition.outcomeContractRefs, "public outcome contract");
  rejectPrivateReferences(publicPartition.provenanceRefs, "public provenance");

  const privateEvaluator = input.privateEvaluator === undefined ? undefined : {
    targetAssertionRefs: normalizedNamespacedList("private target assertion reference", input.privateEvaluator.targetAssertionRefs),
    invariantRefs: normalizedNamespacedList("private invariant reference", input.privateEvaluator.invariantRefs),
    hiddenEffectRefs: normalizedNamespacedList("private hidden effect reference", input.privateEvaluator.hiddenEffectRefs),
    evidenceLocatorRefs: normalizedNamespacedList("private evidence locator reference", input.privateEvaluator.evidenceLocatorRefs),
  };

  const partitionManifest = input.partitionManifest.map((item) => ({
    id: namespaced("world member id", item.id, "world-member:"),
    partition: worldPartition(item.partition),
    kind: requiredText("world member kind", item.kind),
  })).sort((left, right) => left.partition.localeCompare(right.partition) || left.id.localeCompare(right.id));
  assertUniqueIds("world member", partitionManifest);
  if (privateEvaluator === undefined && partitionManifest.some((item) => item.partition === "private-evaluator")) {
    throw new Error("private-evaluator manifest members require a private evaluator partition");
  }

  return deepFreeze({
    contract: "woyengi.world-bundle.v0.1" as const,
    id: namespaced("WorldBundle id", input.id, "world-bundle:"),
    version: exactVersion("WorldBundle version", input.version, "0.1.0"),
    sourceSpecRef: namespaced("WorldBundle source spec", input.sourceSpecRef, "operational-system-spec:"),
    sourceSpecVersion: semanticVersion(input.sourceSpecVersion),
    compatibility: { minimumRuntimeVersion: semanticVersion(input.compatibility.minimumRuntimeVersion) },
    public: publicPartition,
    ...(privateEvaluator === undefined ? {} : { privateEvaluator }),
    partitionManifest,
    provenanceRefs: normalizedNamespacedList("WorldBundle provenance reference", input.provenanceRefs),
  });
}

export function serializeOperationalSystemSpec(value: OperationalSystemSpec): string {
  return `${stableJson(defineOperationalSystemSpec(value))}\n`;
}

export function serializeWorldBundle(value: WorldBundle): string {
  return `${stableJson(defineWorldBundle(value))}\n`;
}

function temporalScope(value: TemporalScope): TemporalScope {
  const from = normalizeInstant(value.from);
  const to = value.to === undefined ? undefined : normalizeInstant(value.to);
  if (to !== undefined && Date.parse(to) <= Date.parse(from)) throw new RangeError("temporal scope to must be after from");
  return to === undefined ? { from } : { from, to };
}

function normalizeBudget(value: OutcomeBudget): OutcomeBudget {
  if (!Number.isFinite(value.maximumCost) || value.maximumCost < 0) throw new RangeError("maximumCost must be finite and non-negative");
  if (!Number.isSafeInteger(value.maximumAttempts) || value.maximumAttempts < 1) throw new RangeError("maximumAttempts must be a positive integer");
  return {
    maximumCost: value.maximumCost,
    currency: requiredText("budget currency", value.currency).toUpperCase(),
    maximumAttempts: value.maximumAttempts,
  };
}

function normalizedList(values: readonly string[]): readonly string[] {
  return uniqueSorted(values.map((item) => requiredText("list item", item)));
}

function normalizedOrderedList(values: readonly string[]): readonly string[] {
  return values.map((item) => requiredText("ordered list item", item));
}

function normalizedNamespacedList(name: string, values: readonly string[], prefix?: string): readonly string[] {
  return uniqueSorted(values.map((item) => namespaced(name, item, prefix)));
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

function assertUniqueIds(name: string, values: readonly { readonly id: string }[]): void {
  const duplicateIds = duplicates(values.map((item) => item.id));
  if (duplicateIds.length > 0) throw new Error(`duplicate ${name} id: ${duplicateIds.join(", ")}`);
}

function assertProviderNeutral(name: string, value: unknown): void {
  if (value !== true) throw new TypeError(`${name} must explicitly be provider-neutral`);
}

function compareById(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id);
}

function compareDependency(left: OperationalIR["dependencies"][number], right: OperationalIR["dependencies"][number]): number {
  return left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.relation.localeCompare(right.relation);
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function namespaced(name: string, value: string, prefix?: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.includes(":")) throw new TypeError(`${name} must be namespace-qualified`);
  if (prefix !== undefined && !normalized.startsWith(prefix)) throw new TypeError(`${name} must start with ${prefix}`);
  return normalized;
}

function semanticVersion(value: string): string {
  const normalized = requiredText("version", value);
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) throw new TypeError(`version must use major.minor.patch: ${normalized}`);
  return normalized;
}

function exactVersion(name: string, value: string, expected: string): "0.1.0" {
  const normalized = semanticVersion(value);
  if (normalized !== expected) throw new TypeError(`${name} must be ${expected}`);
  return "0.1.0";
}

function normalizeInstant(value: string): string {
  const normalized = requiredText("timestamp", value);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new TypeError(`timestamp must be a valid ISO instant: ${value}`);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) throw new TypeError(`timestamp must include an explicit offset: ${value}`);
  return new Date(timestamp).toISOString();
}

function operationalRequirementKind(value: OperationalRequirementKind): OperationalRequirementKind {
  const allowed: readonly OperationalRequirementKind[] = ["STATE", "ACTIVITY", "AUTHORITY", "CAPABILITY", "INTEGRATION", "COLLABORATION", "RUNTIME", "VERIFICATION", "CONSTRAINT"];
  if (!allowed.includes(value)) throw new TypeError(`invalid operational requirement kind: ${value}`);
  return value;
}

function invariantSeverity(value: OperationalInvariantDefinition["severity"]): OperationalInvariantDefinition["severity"] {
  const allowed = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
  if (!allowed.includes(value)) throw new TypeError(`invalid operational invariant severity: ${value}`);
  return value;
}

function operationalResourceKind(value: OperationalResource["kind"]): OperationalResource["kind"] {
  const allowed = ["SEMANTIC_OBJECT", "ARTIFACT", "COMPUTE", "EXTERNAL_SYSTEM", "HUMAN_ATTENTION"] as const;
  if (!allowed.includes(value)) throw new TypeError(`invalid operational resource kind: ${value}`);
  return value;
}

function projectionKind(value: OperationalProjectionRequirement["projectionKind"]): OperationalProjectionRequirement["projectionKind"] {
  const allowed = ["APP", "WORK", "AGENT", "API", "WORLD"] as const;
  if (!allowed.includes(value)) throw new TypeError(`invalid projection kind: ${value}`);
  return value;
}

function outcomeEffectClass(value: OutcomeEffectClass): OutcomeEffectClass {
  const allowed: readonly OutcomeEffectClass[] = ["RUNTIME", "SEMANTIC", "EXTERNAL"];
  if (!allowed.includes(value)) throw new TypeError(`invalid outcome effect class: ${value}`);
  return value;
}

function outcomeEffectPolicy(value: OutcomeEffectPolicy): OutcomeEffectPolicy {
  const allowed: readonly OutcomeEffectPolicy[] = ["ALLOW", "FORBID", "REQUIRE_RECONCILIATION"];
  if (!allowed.includes(value)) throw new TypeError(`invalid outcome effect policy: ${value}`);
  return value;
}

function outcomeTerminationMode(value: OutcomeTermination["mode"]): OutcomeTermination["mode"] {
  const allowed = ["VERIFIED", "VERIFIED_OR_REVIEW", "EXPLICIT_ACCEPTANCE"] as const;
  if (!allowed.includes(value)) throw new TypeError(`invalid outcome termination mode: ${value}`);
  return value;
}

function worldActionKind(value: WorldActionDescriptor["kind"]): WorldActionDescriptor["kind"] {
  const allowed = ["READ", "WRITE", "EXECUTE", "COMMUNICATE", "ESCALATE", "SUBMIT"] as const;
  if (!allowed.includes(value)) throw new TypeError(`invalid world action kind: ${value}`);
  return value;
}

function worldPartition(value: WorldBundlePartitionMember["partition"]): WorldBundlePartitionMember["partition"] {
  if (value !== "public" && value !== "private-evaluator") throw new TypeError(`invalid world partition: ${value}`);
  return value;
}

function rejectPrivateReferences(values: readonly string[], name: string): void {
  const leaking = values.filter((value) => /(^|:)private(?:-|:)/i.test(value));
  if (leaking.length > 0) throw new Error(`${name} partition contains private evaluator reference: ${leaking.join(", ")}`);
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
