export type RuntimeLifecycleState =
  | "PENDING"
  | "LOADING"
  | "ACTIVE"
  | "SUSPENDED"
  | "DEGRADED"
  | "UNLOADING"
  | "DISPOSED"
  | "FAILED";

export type RuntimeEffectClass = "RUNTIME" | "SEMANTIC" | "EXTERNAL";

export interface RuntimeScope {
  readonly workspaceId: string;
  readonly episodeId?: string;
  readonly componentId?: string;
  readonly requestId?: string;
}

export interface RuntimeRequirement {
  readonly capability: string;
  readonly compatible?: (provider: RuntimeProvider) => boolean;
}

export interface RuntimeProvider<Value = unknown> {
  readonly id: string;
  readonly capability: string;
  readonly version: string;
  readonly scope: RuntimeScope;
  readonly value: Value;
  readonly priority?: number;
}

export interface ProviderBinding {
  readonly capability: string;
  readonly providerId: string;
  readonly providerVersion: string;
}

export interface RuntimeEffectLease {
  readonly id: string;
  readonly effectClass: "RUNTIME";
  readonly dispose: () => void | Promise<void>;
}

export interface ProposedEffectReference {
  readonly id: string;
}

export interface CapabilityContext {
  readonly componentId: string;
  readonly scope: RuntimeScope;
  readonly bindings: readonly ProviderBinding[];
  resolve<Value = unknown>(capability: string): Value;
}

export interface RuntimeComponentDefinition {
  readonly id: string;
  readonly version: string;
  readonly scope: RuntimeScope;
  readonly requirements: readonly RuntimeRequirement[];
  readonly effects?: {
    readonly acquireRuntime?: (context: CapabilityContext) => Promise<readonly RuntimeEffectLease[]>;
    readonly semantic?: readonly ProposedEffectReference[];
    readonly external?: readonly ProposedEffectReference[];
  };
}

export interface RuntimeDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export interface RuntimeEvaluationInput {
  readonly componentId: string;
  readonly scope: RuntimeScope;
  readonly bindings: readonly ProviderBinding[];
}

export interface RuntimeTransition {
  readonly sequence: number;
  readonly componentId: string;
  readonly from?: RuntimeLifecycleState;
  readonly to: RuntimeLifecycleState;
  readonly reason: string;
  readonly providerIds: readonly string[];
  readonly disposerFailures: readonly { readonly leaseId: string; readonly message: string }[];
  readonly recordedAt: string;
}

export interface RuntimeComponentSnapshot {
  readonly id: string;
  readonly version: string;
  readonly scope: RuntimeScope;
  readonly state: RuntimeLifecycleState;
  readonly providerIds: readonly string[];
  readonly runtimeEffectLeaseIds: readonly string[];
}

export interface RuntimeReconciliationResult {
  readonly componentIds: readonly string[];
  readonly transitions: readonly RuntimeTransition[];
  readonly disposerFailures: readonly { readonly componentId: string; readonly leaseId: string; readonly message: string }[];
}

export interface CompositionRuntimeOptions {
  readonly evaluateApplicability?: (input: RuntimeEvaluationInput) => RuntimeDecision | Promise<RuntimeDecision>;
  readonly authorize?: (input: RuntimeEvaluationInput) => RuntimeDecision | Promise<RuntimeDecision>;
  readonly transitionSink?: (transition: RuntimeTransition) => void | Promise<void>;
  readonly now?: () => string;
}

interface ComponentEntry {
  readonly definition: RuntimeComponentDefinition;
  state: RuntimeLifecycleState;
  bindings: readonly ResolvedBinding[];
  leases: readonly RuntimeEffectLease[];
}

interface ResolvedBinding extends ProviderBinding {
  readonly value: unknown;
}

export class CompositionRuntime {
  readonly #components = new Map<string, ComponentEntry>();
  readonly #providers = new Map<string, RuntimeProvider>();
  readonly #journal: RuntimeTransition[] = [];
  readonly #options: CompositionRuntimeOptions;

  constructor(options: CompositionRuntimeOptions = {}) {
    this.#options = options;
  }

  async registerComponent(definition: RuntimeComponentDefinition): Promise<RuntimeReconciliationResult> {
    const normalized = normalizeComponent(definition);
    if (this.#components.has(normalized.id)) throw new Error(`runtime component already exists: ${normalized.id}`);
    const entry: ComponentEntry = { definition: normalized, state: "PENDING", bindings: [], leases: [] };
    this.#components.set(normalized.id, entry);
    const transitions = [await this.#transition(entry, undefined, "PENDING", "component-registered", [])];
    const reconciled = await this.#reconcile(entry);
    return result([entry.definition.id], [...transitions, ...reconciled.transitions], reconciled.disposerFailures);
  }

  async registerProvider(provider: RuntimeProvider): Promise<RuntimeReconciliationResult> {
    const normalized = normalizeProvider(provider);
    if (this.#providers.has(normalized.id)) throw new Error(`runtime provider already exists: ${normalized.id}`);
    this.#providers.set(normalized.id, normalized);
    const transitions: RuntimeTransition[] = [];
    const failures: RuntimeReconciliationResult["disposerFailures"][number][] = [];
    const componentIds: string[] = [];
    for (const entry of this.#orderedComponents()) {
      const reconciled = await this.#reconcile(entry);
      if (reconciled.transitions.length > 0) componentIds.push(entry.definition.id);
      transitions.push(...reconciled.transitions);
      failures.push(...reconciled.disposerFailures);
    }
    return result(componentIds, transitions, failures);
  }

  async unregisterProvider(providerId: string, reason = "provider-unavailable"): Promise<RuntimeReconciliationResult> {
    const id = requiredPrefixed("runtime provider id", providerId, "provider:");
    if (!this.#providers.delete(id)) throw new Error(`runtime provider does not exist: ${id}`);
    const transitions: RuntimeTransition[] = [];
    const failures: RuntimeReconciliationResult["disposerFailures"][number][] = [];
    const componentIds: string[] = [];
    for (const entry of this.#orderedComponents()) {
      if (!entry.bindings.some((binding) => binding.providerId === id)) continue;
      componentIds.push(entry.definition.id);
      transitions.push(await this.#transition(entry, entry.state, "SUSPENDED", `${requiredText("provider loss reason", reason)}: ${id}`, []));
      transitions.push(await this.#transition(entry, "SUSPENDED", "UNLOADING", `unloading-after-provider-loss: ${id}`, []));
      const componentFailures: RuntimeTransition["disposerFailures"][number][] = [];
      for (const lease of entry.leases) {
        try {
          await lease.dispose();
        } catch (error) {
          const failure = { leaseId: lease.id, message: safeError(error) };
          componentFailures.push(failure);
          failures.push({ componentId: entry.definition.id, ...failure });
        }
      }
      entry.leases = [];
      entry.bindings = [];
      transitions.push(await this.#transition(entry, "UNLOADING", "PENDING", `requirements-unsatisfied: ${id}`, componentFailures));
    }
    return result(componentIds, transitions, failures);
  }

  component(componentId: string): RuntimeComponentSnapshot | undefined {
    const entry = this.#components.get(requiredNamespaced("component id", componentId));
    if (entry === undefined) return undefined;
    return freeze({
      id: entry.definition.id,
      version: entry.definition.version,
      scope: { ...entry.definition.scope },
      state: entry.state,
      providerIds: entry.bindings.map((binding) => binding.providerId),
      runtimeEffectLeaseIds: entry.leases.map((lease) => lease.id),
    });
  }

  journal(): readonly RuntimeTransition[] {
    return freeze(this.#journal.map((transition) => structuredClone(transition)));
  }

  #orderedComponents(): readonly ComponentEntry[] {
    return [...this.#components.values()].sort((left, right) => left.definition.id.localeCompare(right.definition.id));
  }

  async #reconcile(entry: ComponentEntry): Promise<RuntimeReconciliationResult> {
    if (entry.state !== "PENDING") return result([], [], []);
    const bindings = this.#resolveBindings(entry.definition);
    if (bindings === undefined) return result([], [], []);
    const publicBindings = bindings.map(publicBinding);
    const evaluation = { componentId: entry.definition.id, scope: entry.definition.scope, bindings: publicBindings };
    const applicability = await (this.#options.evaluateApplicability?.(evaluation) ?? { allowed: true, reason: "applicable" });
    if (!applicability.allowed) {
      const transition = await this.#transition(entry, "PENDING", "PENDING", `applicability-rejected: ${requiredText("applicability reason", applicability.reason)}`, []);
      return result([entry.definition.id], [transition], []);
    }
    const authority = await (this.#options.authorize?.(evaluation) ?? {
      allowed: false,
      reason: "authority evaluator is not configured",
    });
    if (!authority.allowed) {
      const transition = await this.#transition(entry, "PENDING", "PENDING", `authority-rejected: ${requiredText("authority reason", authority.reason)}`, []);
      return result([entry.definition.id], [transition], []);
    }
    const transitions = [await this.#transition(entry, "PENDING", "LOADING", "requirements-satisfied", [])];
    entry.bindings = bindings;
    try {
      const acquire = entry.definition.effects?.acquireRuntime;
      entry.leases = acquire === undefined ? [] : normalizeLeases(await acquire(capabilityContext(entry)));
      transitions.push(await this.#transition(entry, "LOADING", "ACTIVE", "component-activated", []));
      return result([entry.definition.id], transitions, []);
    } catch (error) {
      entry.bindings = [];
      entry.leases = [];
      transitions.push(await this.#transition(entry, "LOADING", "FAILED", `activation-failed: ${safeError(error)}`, []));
      return result([entry.definition.id], transitions, []);
    }
  }

  #resolveBindings(definition: RuntimeComponentDefinition): readonly ResolvedBinding[] | undefined {
    const bindings: ResolvedBinding[] = [];
    for (const requirement of definition.requirements) {
      const candidates = [...this.#providers.values()]
        .filter((provider) => provider.capability === requirement.capability)
        .filter((provider) => providerVisibleIn(provider.scope, definition.scope))
        .filter((provider) => requirement.compatible?.(provider) ?? true)
        .sort(compareProviders);
      const selected = candidates[0];
      if (selected === undefined) return undefined;
      bindings.push({
        capability: requirement.capability,
        providerId: selected.id,
        providerVersion: selected.version,
        value: selected.value,
      });
    }
    return bindings;
  }

  async #transition(
    entry: ComponentEntry,
    from: RuntimeLifecycleState | undefined,
    to: RuntimeLifecycleState,
    reason: string,
    disposerFailures: RuntimeTransition["disposerFailures"],
  ): Promise<RuntimeTransition> {
    const transition = freeze({
      sequence: this.#journal.length + 1,
      componentId: entry.definition.id,
      ...(from === undefined ? {} : { from }),
      to,
      reason: requiredText("transition reason", reason),
      providerIds: entry.bindings.map((binding) => binding.providerId),
      disposerFailures: [...disposerFailures],
      recordedAt: normalizeInstant(this.#options.now?.() ?? new Date().toISOString()),
    });
    entry.state = to;
    this.#journal.push(transition);
    await this.#options.transitionSink?.(transition);
    return transition;
  }
}

function capabilityContext(entry: ComponentEntry): CapabilityContext {
  const bindings = entry.bindings.map(publicBinding);
  const values = new Map(entry.bindings.map((binding) => [binding.capability, binding.value]));
  return freeze({
    componentId: entry.definition.id,
    scope: { ...entry.definition.scope },
    bindings,
    resolve<Value = unknown>(capability: string): Value {
      const normalized = requiredNamespaced("capability", capability);
      if (!values.has(normalized)) throw new Error(`capability is not bound: ${normalized}`);
      return values.get(normalized) as Value;
    },
  });
}

function publicBinding(binding: ResolvedBinding): ProviderBinding {
  return freeze({ capability: binding.capability, providerId: binding.providerId, providerVersion: binding.providerVersion });
}

function normalizeComponent(definition: RuntimeComponentDefinition): RuntimeComponentDefinition {
  const requirements = definition.requirements.map((requirement) => ({
    capability: requiredNamespaced("runtime requirement capability", requirement.capability),
    ...(requirement.compatible === undefined ? {} : { compatible: requirement.compatible }),
  }));
  if (new Set(requirements.map((requirement) => requirement.capability)).size !== requirements.length) {
    throw new Error("runtime component requirements must not contain duplicate capabilities");
  }
  return freeze({
    ...definition,
    id: requiredPrefixed("runtime component id", definition.id, "component:"),
    version: semanticVersion(definition.version),
    scope: normalizeScope(definition.scope),
    requirements,
  });
}

function normalizeProvider(provider: RuntimeProvider): RuntimeProvider {
  if (!Number.isSafeInteger(provider.priority ?? 0)) throw new TypeError("runtime provider priority must be an integer");
  return Object.freeze({
    ...provider,
    id: requiredPrefixed("runtime provider id", provider.id, "provider:"),
    capability: requiredNamespaced("runtime provider capability", provider.capability),
    version: semanticVersion(provider.version),
    scope: normalizeScope(provider.scope),
    priority: provider.priority ?? 0,
  });
}

function normalizeScope(scope: RuntimeScope): RuntimeScope {
  return freeze({
    workspaceId: requiredPrefixed("runtime scope workspace", scope.workspaceId, "workspace:"),
    ...(scope.episodeId === undefined ? {} : { episodeId: requiredPrefixed("runtime scope episode", scope.episodeId, "episode:") }),
    ...(scope.componentId === undefined ? {} : { componentId: requiredPrefixed("runtime scope component", scope.componentId, "component:") }),
    ...(scope.requestId === undefined ? {} : { requestId: requiredPrefixed("runtime scope request", scope.requestId, "request:") }),
  });
}

function normalizeLeases(leases: readonly RuntimeEffectLease[]): readonly RuntimeEffectLease[] {
  const ids = new Set<string>();
  return freeze(leases.map((lease) => {
    const id = requiredPrefixed("runtime effect lease id", lease.id, "runtime-effect-lease:");
    if (ids.has(id)) throw new Error(`duplicate runtime effect lease: ${id}`);
    ids.add(id);
    if (lease.effectClass !== "RUNTIME") throw new TypeError("automatic effect leases must have RUNTIME effect class");
    return freeze({ id, effectClass: "RUNTIME" as const, dispose: lease.dispose });
  }));
}

function providerVisibleIn(provider: RuntimeScope, consumer: RuntimeScope): boolean {
  return provider.workspaceId === consumer.workspaceId
    && (provider.episodeId === undefined || provider.episodeId === consumer.episodeId)
    && (provider.componentId === undefined || provider.componentId === consumer.componentId)
    && (provider.requestId === undefined || provider.requestId === consumer.requestId);
}

function compareProviders(left: RuntimeProvider, right: RuntimeProvider): number {
  return (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id);
}

function result(
  componentIds: readonly string[],
  transitions: readonly RuntimeTransition[],
  disposerFailures: RuntimeReconciliationResult["disposerFailures"],
): RuntimeReconciliationResult {
  return freeze({ componentIds: [...new Set(componentIds)].sort(), transitions: [...transitions], disposerFailures: [...disposerFailures] });
}

function semanticVersion(value: string): string {
  const normalized = requiredText("semantic version", value);
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) throw new TypeError(`version must use major.minor.patch: ${normalized}`);
  return normalized;
}

function requiredPrefixed(name: string, value: string, prefix: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${name} must start with ${prefix}`);
  return normalized;
}

function requiredNamespaced(name: string, value: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.includes(":")) throw new TypeError(`${name} must be namespace-qualified`);
  return normalized;
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`);
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return instant.toISOString();
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "unknown runtime failure").slice(0, 500);
}

function freeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
