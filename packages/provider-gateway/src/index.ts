export type ProviderKind = "FILESYSTEM" | "GIT" | "REST" | "MCP" | "MODEL";

export type ProviderEffectClass = "RUNTIME" | "SEMANTIC" | "EXTERNAL";

export interface ProviderCapability {
  readonly id: string;
  readonly version: string;
  readonly description: string;
}

export interface ToolOperationContract {
  readonly name: string;
  readonly effectClass: ProviderEffectClass;
}

export interface ToolContract {
  readonly id: string;
  readonly version: string;
  readonly kind: ProviderKind;
  readonly capabilityId: string;
  readonly operations: readonly ToolOperationContract[];
}

export type ProviderValue = null | boolean | number | string | readonly ProviderValue[] | { readonly [key: string]: ProviderValue };

export interface ProviderBinding {
  readonly id: string;
  readonly workspaceId: string;
  readonly appInstanceId: string;
  readonly providerId: string;
  readonly toolContractIds: readonly string[];
  readonly principalIds: readonly string[];
}

export interface ExpectedProviderEffect {
  readonly id: string;
  readonly effectClass: ProviderEffectClass;
  readonly description: string;
}

export interface ProviderReconciliationMetadata {
  readonly id: string;
  readonly strategy: string;
  readonly required: boolean;
}

export interface ProviderOperationEnvelope {
  readonly id: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly appInstanceId: string;
  readonly bindingId: string;
  readonly toolContractId: string;
  readonly operation: string;
  readonly authorityReference: string;
  readonly idempotencyKey: string;
  readonly expectedEffect: ExpectedProviderEffect;
  readonly reconciliation: ProviderReconciliationMetadata;
  readonly input: ProviderValue;
  readonly requestedAt: string;
}

export interface ProviderAdapterRequest {
  readonly envelope: ProviderOperationEnvelope;
  readonly binding: ProviderBinding;
  readonly capabilityId: string;
  readonly credential?: unknown;
}

export interface ProviderAdapterObservation {
  readonly status: "SUCCEEDED" | "FAILED" | "UNKNOWN";
  readonly output: ProviderValue;
  readonly observedAt: string;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly version: string;
  readonly toolContractIds: readonly string[];
  readonly invoke: (request: ProviderAdapterRequest) => ProviderAdapterObservation | Promise<ProviderAdapterObservation>;
}

export interface ProviderAuthorityRequest {
  readonly envelope: ProviderOperationEnvelope;
  readonly providerId: string;
  readonly bindingId: string;
  readonly capabilityId: string;
}

export interface ProviderAuthorityDecision {
  readonly allowed: boolean;
  readonly decisionId: string;
  readonly reason: string;
}

export interface ProviderCredentialRequest {
  readonly credentialReference: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly providerId: string;
  readonly bindingId: string;
}

export interface ProviderReceipt {
  readonly contract: "woyengi.provider-receipt.v1";
  readonly id: string;
  readonly operationId: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly providerId: string;
  readonly bindingId: string;
  readonly idempotencyKey: string;
  readonly authorityReference: string;
  readonly status: ProviderAdapterObservation["status"];
  readonly providerOutput: ProviderValue;
  readonly observedAt: string;
  readonly observationOnly: true;
  readonly acceptedTruth: false;
}

export interface ObservedProviderEffect {
  readonly contract: "woyengi.observed-provider-effect.v1";
  readonly id: string;
  readonly operationId: string;
  readonly expectedEffectId: string;
  readonly effectClass: ProviderEffectClass;
  readonly providerId: string;
  readonly observation: ProviderValue;
  readonly reconciliationPlanId: string;
  readonly reconciliationStatus: "PENDING";
  readonly observedAt: string;
  readonly observationOnly: true;
  readonly acceptedTruth: false;
}

export interface ProviderOperationResult {
  readonly receipt: ProviderReceipt;
  readonly observedEffects: readonly ObservedProviderEffect[];
  readonly governanceStatus: "OBSERVED_NOT_ACCEPTED";
}

export interface ProviderAvailabilityEvent {
  readonly sequence: number;
  readonly providerId: string;
  readonly kind: ProviderKind;
  readonly version: string;
  readonly toolContractIds: readonly string[];
  readonly availability: "AVAILABLE" | "UNAVAILABLE";
  readonly reason: string;
  readonly recordedAt: string;
  readonly replayConsequentialActions: false;
}

export type ProviderAvailabilityListener = (event: ProviderAvailabilityEvent) => void;

export interface ProviderGatewayOptions {
  readonly registry: ProviderContractRegistry;
  readonly authorize?: (request: ProviderAuthorityRequest) => ProviderAuthorityDecision | Promise<ProviderAuthorityDecision>;
  readonly resolveCredential?: (request: ProviderCredentialRequest) => unknown | Promise<unknown>;
  readonly now?: () => string;
}

interface StoredBinding {
  readonly binding: ProviderBinding;
  readonly credentialReference?: string;
}

interface RegisteredProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly version: string;
  readonly toolContractIds: readonly string[];
  readonly invoke: ProviderAdapter["invoke"];
}

const PROVIDER_KINDS: readonly ProviderKind[] = Object.freeze(["FILESYSTEM", "GIT", "REST", "MCP", "MODEL"]);
const EFFECT_CLASSES: readonly ProviderEffectClass[] = Object.freeze(["RUNTIME", "SEMANTIC", "EXTERNAL"]);

export class ProviderContractRegistry {
  readonly #capabilities = new Map<string, ProviderCapability>();
  readonly #toolContracts = new Map<string, ToolContract>();

  registerCapability(input: ProviderCapability): ProviderCapability {
    const capability = deepFreeze({
      id: prefixed("capability id", input.id, "capability:"),
      version: semanticVersion(input.version),
      description: requiredText("capability description", input.description),
    });
    if (this.#capabilities.has(capability.id)) throw new Error(`capability already registered: ${capability.id}`);
    this.#capabilities.set(capability.id, capability);
    return capability;
  }

  registerToolContract(input: ToolContract): ToolContract {
    const capabilityId = prefixed("tool capability id", input.capabilityId, "capability:");
    if (!this.#capabilities.has(capabilityId)) throw new Error(`tool contract capability is not registered: ${capabilityId}`);
    const operations = input.operations.map((operation) => deepFreeze({
      name: namespaced("tool operation name", operation.name),
      effectClass: providerEffectClass(operation.effectClass),
    }));
    if (operations.length === 0) throw new TypeError("tool contract requires at least one operation");
    if (new Set(operations.map((operation) => operation.name)).size !== operations.length) {
      throw new Error("tool contract operations must be unique");
    }
    const contract = deepFreeze({
      id: prefixed("tool contract id", input.id, "tool-contract:"),
      version: semanticVersion(input.version),
      kind: providerKind(input.kind),
      capabilityId,
      operations,
    });
    if (this.#toolContracts.has(contract.id)) throw new Error(`tool contract already registered: ${contract.id}`);
    this.#toolContracts.set(contract.id, contract);
    return contract;
  }

  capability(capabilityId: string): ProviderCapability | undefined {
    return this.#capabilities.get(prefixed("capability id", capabilityId, "capability:"));
  }

  toolContract(toolContractId: string): ToolContract | undefined {
    return this.#toolContracts.get(prefixed("tool contract id", toolContractId, "tool-contract:"));
  }

  capabilities(): readonly ProviderCapability[] {
    return Object.freeze([...this.#capabilities.values()]);
  }

  toolContracts(): readonly ToolContract[] {
    return Object.freeze([...this.#toolContracts.values()]);
  }
}

export class ProviderGateway {
  readonly #registry: ProviderContractRegistry;
  readonly #authorize?: ProviderGatewayOptions["authorize"];
  readonly #resolveCredential?: ProviderGatewayOptions["resolveCredential"];
  readonly #now: () => string;
  readonly #providers = new Map<string, RegisteredProvider>();
  readonly #bindings = new Map<string, StoredBinding>();
  readonly #idempotency = new Map<string, { readonly fingerprint: string; readonly result: Promise<ProviderOperationResult> }>();
  readonly #availabilityListeners = new Set<ProviderAvailabilityListener>();
  #availabilitySequence = 0;

  constructor(options: ProviderGatewayOptions) {
    this.#registry = options.registry;
    this.#authorize = options.authorize;
    this.#resolveCredential = options.resolveCredential;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  registerProvider(input: ProviderAdapter): void {
    const id = prefixed("provider id", input.id, "provider:");
    if (this.#providers.has(id)) throw new Error(`provider already registered: ${id}`);
    const kind = providerKind(input.kind);
    const toolContractIds = uniqueSorted("provider tool contracts", input.toolContractIds, (value) => prefixed("tool contract id", value, "tool-contract:"));
    for (const toolContractId of toolContractIds) {
      const contract = this.#registry.toolContract(toolContractId);
      if (contract === undefined) throw new Error(`provider tool contract is not registered: ${toolContractId}`);
      if (contract.kind !== kind) throw new Error(`provider kind does not match tool contract: ${toolContractId}`);
    }
    const provider = Object.freeze({
      id,
      kind,
      version: semanticVersion(input.version),
      toolContractIds,
      invoke: input.invoke,
    });
    this.#providers.set(id, provider);
    this.#publishAvailability(provider, "AVAILABLE", "provider registered");
  }

  unregisterProvider(providerId: string, reason = "provider unavailable"): void {
    const id = prefixed("provider id", providerId, "provider:");
    const provider = this.#providers.get(id);
    if (provider === undefined) throw new Error(`provider is unavailable: ${id}`);
    this.#providers.delete(id);
    this.#publishAvailability(provider, "UNAVAILABLE", requiredText("provider unavailability reason", reason));
  }

  subscribeAvailability(listener: ProviderAvailabilityListener): () => void {
    this.#availabilityListeners.add(listener);
    return () => { this.#availabilityListeners.delete(listener); };
  }

  bindProvider(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly appInstanceId: string;
    readonly providerId: string;
    readonly toolContractIds: readonly string[];
    readonly principalIds: readonly string[];
    readonly credentialReference?: string;
  }): ProviderBinding {
    const id = prefixed("provider binding id", input.id, "provider-binding:");
    if (this.#bindings.has(id)) throw new Error(`provider binding already exists: ${id}`);
    const providerId = prefixed("provider id", input.providerId, "provider:");
    const provider = this.#providers.get(providerId);
    if (provider === undefined) throw new Error(`provider is unavailable: ${providerId}`);
    const toolContractIds = uniqueSorted("binding tool contracts", input.toolContractIds, (value) => prefixed("tool contract id", value, "tool-contract:"));
    for (const toolContractId of toolContractIds) {
      if (!provider.toolContractIds.includes(toolContractId)) throw new Error(`provider does not implement tool contract: ${toolContractId}`);
    }
    const binding = deepFreeze({
      id,
      workspaceId: prefixed("workspace id", input.workspaceId, "workspace:"),
      appInstanceId: prefixed("application instance id", input.appInstanceId, "application-instance:"),
      providerId,
      toolContractIds,
      principalIds: uniqueSorted("binding principals", input.principalIds, (value) => prefixed("principal id", value, "principal:")),
    });
    const credentialReference = input.credentialReference === undefined
      ? undefined
      : prefixed("credential reference", input.credentialReference, "credential-ref:");
    this.#bindings.set(id, credentialReference === undefined ? { binding } : { binding, credentialReference });
    return binding;
  }

  binding(bindingId: string): ProviderBinding | undefined {
    return this.#bindings.get(prefixed("provider binding id", bindingId, "provider-binding:"))?.binding;
  }

  execute(input: ProviderOperationEnvelope): Promise<ProviderOperationResult> {
    const envelope = normalizeEnvelope(input);
    const key = `${envelope.workspaceId}\u0000${envelope.idempotencyKey}`;
    const fingerprint = stableStringify(envelope);
    const existing = this.#idempotency.get(key);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new Error(`idempotency key reused with different provider operation: ${envelope.idempotencyKey}`));
      }
      return existing.result;
    }
    const attempt = { adapterInvocationStarted: false };
    const result = this.#executeNew(envelope, () => { attempt.adapterInvocationStarted = true; });
    this.#idempotency.set(key, { fingerprint, result });
    void result.catch(() => {
      if (!attempt.adapterInvocationStarted && this.#idempotency.get(key)?.result === result) this.#idempotency.delete(key);
    });
    return result;
  }

  async #executeNew(envelope: ProviderOperationEnvelope, markAdapterInvocationStarted: () => void): Promise<ProviderOperationResult> {
    if (envelope.expectedEffect.effectClass === "EXTERNAL" && !envelope.reconciliation.required) {
      throw new Error("external provider effects require reconciliation");
    }
    const stored = this.#bindings.get(envelope.bindingId);
    if (stored === undefined) throw new Error(`provider binding does not exist: ${envelope.bindingId}`);
    const binding = stored.binding;
    if (binding.workspaceId !== envelope.workspaceId || binding.appInstanceId !== envelope.appInstanceId) {
      throw new Error(`provider binding scope mismatch: ${binding.id}`);
    }
    if (!binding.principalIds.includes(envelope.principalId)) throw new Error(`principal is outside provider binding scope: ${envelope.principalId}`);
    if (!binding.toolContractIds.includes(envelope.toolContractId)) throw new Error(`tool contract is outside provider binding scope: ${envelope.toolContractId}`);
    const provider = this.#providers.get(binding.providerId);
    if (provider === undefined) throw new Error(`provider is unavailable: ${binding.providerId}`);
    if (!provider.toolContractIds.includes(envelope.toolContractId)) throw new Error(`provider no longer implements tool contract: ${envelope.toolContractId}`);
    const contract = this.#registry.toolContract(envelope.toolContractId);
    if (contract === undefined) throw new Error(`tool contract is not registered: ${envelope.toolContractId}`);
    if (contract.kind !== provider.kind) throw new Error(`provider kind does not match tool contract: ${contract.id}`);
    const operation = contract.operations.find((candidate) => candidate.name === envelope.operation);
    if (operation === undefined) throw new Error(`operation is not declared by tool contract: ${envelope.operation}`);
    if (operation.effectClass !== envelope.expectedEffect.effectClass) throw new Error("expected effect class does not match tool contract");

    const authorityRequest = deepFreeze({
      envelope,
      providerId: provider.id,
      bindingId: binding.id,
      capabilityId: contract.capabilityId,
    });
    let decision: ProviderAuthorityDecision;
    try {
      decision = await (this.#authorize?.(authorityRequest) ?? {
        allowed: false,
        decisionId: "authority-decision:unconfigured",
        reason: "authority evaluator is not configured",
      });
    } catch {
      throw new Error(`provider authority denied: ${envelope.id}`);
    }
    if (
      decision.allowed !== true ||
      prefixed("authority decision id", decision.decisionId, "authority-decision:") !== envelope.authorityReference
    ) {
      throw new Error(`provider authority denied: ${envelope.id}`);
    }
    requiredText("authority decision reason", decision.reason);

    let credential: unknown;
    if (stored.credentialReference !== undefined) {
      if (this.#resolveCredential === undefined) throw new Error(`credential resolver is not configured: ${binding.id}`);
      try {
        credential = await this.#resolveCredential(deepFreeze({
          credentialReference: stored.credentialReference,
          workspaceId: envelope.workspaceId,
          principalId: envelope.principalId,
          providerId: provider.id,
          bindingId: binding.id,
        }));
      } catch {
        throw new Error(`credential resolution failed: ${binding.id}`);
      }
    }

    const adapterRequest: ProviderAdapterRequest = Object.freeze({
      envelope,
      binding,
      capabilityId: contract.capabilityId,
      ...(stored.credentialReference === undefined ? {} : { credential }),
    });
    markAdapterInvocationStarted();
    const observation = normalizeAdapterObservation(await provider.invoke(adapterRequest));
    if (this.#providers.get(provider.id) !== provider) throw new Error(`provider was lost during operation: ${provider.id}`);
    const suffix = envelope.id.slice("provider-operation:".length);
    const receipt: ProviderReceipt = deepFreeze({
      contract: "woyengi.provider-receipt.v1" as const,
      id: `provider-receipt:${suffix}`,
      operationId: envelope.id,
      workspaceId: envelope.workspaceId,
      principalId: envelope.principalId,
      providerId: provider.id,
      bindingId: binding.id,
      idempotencyKey: envelope.idempotencyKey,
      authorityReference: envelope.authorityReference,
      status: observation.status,
      providerOutput: cloneValue(observation.output),
      observedAt: observation.observedAt,
      observationOnly: true as const,
      acceptedTruth: false as const,
    });
    const observedEffect: ObservedProviderEffect = deepFreeze({
      contract: "woyengi.observed-provider-effect.v1" as const,
      id: `observed-effect:${suffix}`,
      operationId: envelope.id,
      expectedEffectId: envelope.expectedEffect.id,
      effectClass: envelope.expectedEffect.effectClass,
      providerId: provider.id,
      observation: cloneValue(observation.output),
      reconciliationPlanId: envelope.reconciliation.id,
      reconciliationStatus: "PENDING" as const,
      observedAt: observation.observedAt,
      observationOnly: true as const,
      acceptedTruth: false as const,
    });
    return deepFreeze({ receipt, observedEffects: [observedEffect], governanceStatus: "OBSERVED_NOT_ACCEPTED" as const });
  }

  #publishAvailability(
    provider: RegisteredProvider,
    availability: ProviderAvailabilityEvent["availability"],
    reason: string,
  ): void {
    const event: ProviderAvailabilityEvent = deepFreeze({
      sequence: ++this.#availabilitySequence,
      providerId: provider.id,
      kind: provider.kind,
      version: provider.version,
      toolContractIds: [...provider.toolContractIds],
      availability,
      reason,
      recordedAt: normalizeInstant(this.#now()),
      replayConsequentialActions: false as const,
    });
    for (const listener of [...this.#availabilityListeners]) {
      try {
        listener(event);
      } catch {
        // Availability observers cannot roll back provider state or trigger action replay.
      }
    }
  }
}

function normalizeEnvelope(input: ProviderOperationEnvelope): ProviderOperationEnvelope {
  return deepFreeze({
    id: prefixed("provider operation id", input.id, "provider-operation:"),
    workspaceId: prefixed("workspace id", input.workspaceId, "workspace:"),
    principalId: prefixed("principal id", input.principalId, "principal:"),
    appInstanceId: prefixed("application instance id", input.appInstanceId, "application-instance:"),
    bindingId: prefixed("provider binding id", input.bindingId, "provider-binding:"),
    toolContractId: prefixed("tool contract id", input.toolContractId, "tool-contract:"),
    operation: namespaced("provider operation", input.operation),
    authorityReference: prefixed("authority reference", input.authorityReference, "authority-decision:"),
    idempotencyKey: namespaced("idempotency key", input.idempotencyKey),
    expectedEffect: {
      id: prefixed("expected effect id", input.expectedEffect.id, "expected-effect:"),
      effectClass: providerEffectClass(input.expectedEffect.effectClass),
      description: requiredText("expected effect description", input.expectedEffect.description),
    },
    reconciliation: {
      id: prefixed("reconciliation plan id", input.reconciliation.id, "reconciliation-plan:"),
      strategy: requiredText("reconciliation strategy", input.reconciliation.strategy),
      required: input.reconciliation.required,
    },
    input: cloneValue(input.input),
    requestedAt: normalizeInstant(input.requestedAt),
  });
}

function normalizeAdapterObservation(input: ProviderAdapterObservation): ProviderAdapterObservation {
  if (input.status !== "SUCCEEDED" && input.status !== "FAILED" && input.status !== "UNKNOWN") {
    throw new TypeError(`unsupported provider observation status: ${input.status}`);
  }
  return deepFreeze({ status: input.status, output: cloneValue(input.output), observedAt: normalizeInstant(input.observedAt) });
}

function providerKind(value: ProviderKind): ProviderKind {
  if (!PROVIDER_KINDS.includes(value)) throw new TypeError(`unsupported provider kind: ${value}`);
  return value;
}

function providerEffectClass(value: ProviderEffectClass): ProviderEffectClass {
  if (!EFFECT_CLASSES.includes(value)) throw new TypeError(`unsupported provider effect class: ${value}`);
  return value;
}

function semanticVersion(value: string): string {
  const normalized = requiredText("semantic version", value);
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) throw new TypeError(`version must use major.minor.patch: ${normalized}`);
  return normalized;
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

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`);
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return instant.toISOString();
}

function uniqueSorted(name: string, values: readonly string[], normalize: (value: string) => string): readonly string[] {
  const normalized = [...new Set(values.map(normalize))].sort();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return Object.freeze(normalized);
}

function cloneValue(value: ProviderValue): ProviderValue {
  return structuredClone(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(",")}}`;
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
