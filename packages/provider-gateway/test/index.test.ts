import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ProviderContractRegistry,
  ProviderGateway,
  type ProviderAdapterObservation,
  type ProviderAdapterRequest,
  type ProviderAuthorityDecision,
  type ProviderAuthorityRequest,
  type ProviderCredentialRequest,
  type ProviderOperationEnvelope,
  type ProviderAvailabilityEvent,
  type ProviderKind,
} from "../src/index.ts";

test("registers provider-neutral capabilities and tool contracts for every first provider kind", () => {
  const registry = new ProviderContractRegistry();
  registry.registerCapability({
    id: "capability:content-operation",
    version: "1.0.0",
    description: "Operate on content through a provider-neutral boundary",
  });

  const kinds: readonly ProviderKind[] = ["FILESYSTEM", "GIT", "REST", "MCP", "MODEL"];
  for (const kind of kinds) {
    registry.registerToolContract({
      id: `tool-contract:${kind.toLowerCase()}`,
      version: "1.0.0",
      kind,
      capabilityId: "capability:content-operation",
      operations: [{ name: `${kind.toLowerCase()}:invoke`, effectClass: "EXTERNAL" }],
    });
  }

  assert.deepEqual(registry.toolContracts().map((contract) => contract.kind), kinds);
  assert.equal(registry.toolContract("tool-contract:rest")?.capabilityId, "capability:content-operation");
  assert.equal(Object.isFrozen(registry.toolContract("tool-contract:model")), true);
  assert.throws(() => registry.registerToolContract({
    id: "tool-contract:unknown-capability",
    version: "1.0.0",
    kind: "REST",
    capabilityId: "capability:missing",
    operations: [{ name: "rest:get", effectClass: "EXTERNAL" }],
  }), /capability is not registered/);
});

test("executes injected adapters through scoped bindings and returns observations rather than accepted truth", async () => {
  const registry = restRegistry();
  const authorityChecks: unknown[] = [];
  const adapterCalls: ProviderAdapterRequest[] = [];
  const gateway = new ProviderGateway({
    registry,
    authorize: (request) => {
      authorityChecks.push(request);
      return { allowed: true, decisionId: "authority-decision:rest-read", reason: "explicit grant" };
    },
    resolveCredential: ({ credentialReference }) => {
      assert.equal(credentialReference, "credential-ref:rest-one");
      return { token: "resolved-only-inside-gateway" };
    },
  });
  gateway.registerProvider({
    id: "provider:rest-one",
    kind: "REST",
    version: "1.0.0",
    toolContractIds: ["tool-contract:rest"],
    invoke: async (request) => {
      adapterCalls.push(request);
      return {
        status: "SUCCEEDED",
        output: { statusCode: 200, bodyDigest: "sha256:abc" },
        observedAt: "2026-08-22T10:01:00Z",
      };
    },
  });

  const binding = gateway.bindProvider({
    id: "provider-binding:rest-app",
    workspaceId: "workspace:one",
    appInstanceId: "application-instance:one",
    providerId: "provider:rest-one",
    toolContractIds: ["tool-contract:rest"],
    principalIds: ["principal:human-one"],
    credentialReference: "credential-ref:rest-one",
  });
  assert.deepEqual(binding, {
    id: "provider-binding:rest-app",
    workspaceId: "workspace:one",
    appInstanceId: "application-instance:one",
    providerId: "provider:rest-one",
    toolContractIds: ["tool-contract:rest"],
    principalIds: ["principal:human-one"],
  });
  assert.equal(JSON.stringify(binding).includes("credential-ref"), false);

  const result = await gateway.execute({
    id: "provider-operation:rest-read",
    workspaceId: "workspace:one",
    principalId: "principal:human-one",
    appInstanceId: "application-instance:one",
    bindingId: binding.id,
    toolContractId: "tool-contract:rest",
    operation: "rest:request",
    authorityReference: "authority-decision:rest-read",
    idempotencyKey: "idempotency:rest-read",
    expectedEffect: {
      id: "expected-effect:remote-read",
      effectClass: "EXTERNAL",
      description: "Observe the remote resource",
    },
    reconciliation: {
      id: "reconciliation-plan:remote-read",
      strategy: "CANONICAL_READ",
      required: true,
    },
    input: { method: "GET", resource: "/items/one" },
    requestedAt: "2026-08-22T10:00:00Z",
  });

  assert.equal(authorityChecks.length, 1);
  assert.equal(adapterCalls.length, 1);
  assert.deepEqual(adapterCalls[0]?.credential, { token: "resolved-only-inside-gateway" });
  assert.equal(adapterCalls[0]?.envelope.authorityReference, "authority-decision:rest-read");
  assert.equal(adapterCalls[0]?.envelope.expectedEffect.id, "expected-effect:remote-read");
  assert.equal(adapterCalls[0]?.envelope.reconciliation.strategy, "CANONICAL_READ");
  assert.deepEqual(result.receipt, {
    contract: "woyengi.provider-receipt.v1",
    id: "provider-receipt:rest-read",
    operationId: "provider-operation:rest-read",
    workspaceId: "workspace:one",
    principalId: "principal:human-one",
    providerId: "provider:rest-one",
    bindingId: "provider-binding:rest-app",
    idempotencyKey: "idempotency:rest-read",
    authorityReference: "authority-decision:rest-read",
    status: "SUCCEEDED",
    providerOutput: { statusCode: 200, bodyDigest: "sha256:abc" },
    observedAt: "2026-08-22T10:01:00.000Z",
    observationOnly: true,
    acceptedTruth: false,
  });
  assert.deepEqual(result.observedEffects, [{
    contract: "woyengi.observed-provider-effect.v1",
    id: "observed-effect:rest-read",
    operationId: "provider-operation:rest-read",
    expectedEffectId: "expected-effect:remote-read",
    effectClass: "EXTERNAL",
    providerId: "provider:rest-one",
    observation: { statusCode: 200, bodyDigest: "sha256:abc" },
    reconciliationPlanId: "reconciliation-plan:remote-read",
    reconciliationStatus: "PENDING",
    observedAt: "2026-08-22T10:01:00.000Z",
    observationOnly: true,
    acceptedTruth: false,
  }]);
  assert.equal(result.governanceStatus, "OBSERVED_NOT_ACCEPTED");
});

test("fails closed across authority, provider, credential, scope, and idempotency boundaries", async () => {
  const noAuthority = configuredRestGateway({ resolveCredential: () => ({ token: "test" }) });
  await assert.rejects(noAuthority.gateway.execute(restOperation()), /provider authority denied/);

  const throwingAuthority = configuredRestGateway({
    authorize: () => { throw new Error("authority service offline"); },
    resolveCredential: () => ({ token: "test" }),
  });
  await assert.rejects(throwingAuthority.gateway.execute(restOperation()), /provider authority denied/);

  const missingProviderGateway = new ProviderGateway({ registry: restRegistry() });
  assert.throws(() => missingProviderGateway.bindProvider({
    id: "provider-binding:missing",
    workspaceId: "workspace:one",
    appInstanceId: "application-instance:one",
    providerId: "provider:missing",
    toolContractIds: ["tool-contract:rest"],
    principalIds: ["principal:human-one"],
  }), /provider is unavailable/);

  const lostProvider = configuredRestGateway({
    authorize: allowAuthority,
    resolveCredential: () => ({ token: "test" }),
  });
  lostProvider.gateway.unregisterProvider("provider:rest-one", "connection lost");
  await assert.rejects(lostProvider.gateway.execute(restOperation()), /provider is unavailable/);
  assert.equal(lostProvider.invocations.length, 0);

  const credentialFailure = configuredRestGateway({
    authorize: allowAuthority,
    resolveCredential: () => { throw new Error("vault unavailable"); },
  });
  await assert.rejects(credentialFailure.gateway.execute(restOperation()), /credential resolution failed/);
  assert.equal(credentialFailure.invocations.length, 0);

  const scopeMismatch = configuredRestGateway({
    authorize: allowAuthority,
    resolveCredential: () => ({ token: "test" }),
  });
  await assert.rejects(scopeMismatch.gateway.execute(restOperation({ workspaceId: "workspace:two" })), /scope mismatch/);
  assert.equal(scopeMismatch.invocations.length, 0);

  const unreconciledExternal = configuredRestGateway({
    authorize: allowAuthority,
    resolveCredential: () => ({ token: "test" }),
  });
  await assert.rejects(unreconciledExternal.gateway.execute(restOperation({
    reconciliation: { id: "reconciliation-plan:remote-read", strategy: "CANONICAL_READ", required: false },
  })), /external provider effects require reconciliation/);
  assert.equal(unreconciledExternal.invocations.length, 0);

  const idempotent = configuredRestGateway({
    authorize: allowAuthority,
    resolveCredential: () => ({ token: "test" }),
  });
  const first = await idempotent.gateway.execute(restOperation());
  const replay = await idempotent.gateway.execute(restOperation());
  assert.deepEqual(replay, first);
  assert.equal(idempotent.invocations.length, 1);
  await assert.rejects(idempotent.gateway.execute(restOperation({
    id: "provider-operation:conflicting-reuse",
    input: { method: "DELETE", resource: "/items/one" },
  })), /idempotency key reused with different provider operation/);
  assert.equal(idempotent.invocations.length, 1);
});

test("publishes provider availability changes without replaying consequential operations", () => {
  const events: ProviderAvailabilityEvent[] = [];
  let adapterInvocations = 0;
  const instants = [
    "2026-08-22T11:00:00Z",
    "2026-08-22T11:01:00Z",
    "2026-08-22T11:02:00Z",
    "2026-08-22T11:03:00Z",
  ];
  const gateway = new ProviderGateway({
    registry: restRegistry(),
    now: () => instants.shift() ?? "2026-08-22T11:04:00Z",
  });
  const unsubscribe = gateway.subscribeAvailability((event) => { events.push(event); });
  const adapter = {
    id: "provider:rest-one",
    kind: "REST" as const,
    version: "1.0.0",
    toolContractIds: ["tool-contract:rest"],
    invoke: async (): Promise<ProviderAdapterObservation> => {
      adapterInvocations += 1;
      return { status: "SUCCEEDED", output: null, observedAt: "2026-08-22T11:00:00Z" };
    },
  };

  gateway.registerProvider(adapter);
  gateway.unregisterProvider(adapter.id, "connection lost");
  gateway.registerProvider({ ...adapter, version: "1.1.0" });

  assert.deepEqual(events, [
    {
      sequence: 1,
      providerId: "provider:rest-one",
      kind: "REST",
      version: "1.0.0",
      toolContractIds: ["tool-contract:rest"],
      availability: "AVAILABLE",
      reason: "provider registered",
      recordedAt: "2026-08-22T11:00:00.000Z",
      replayConsequentialActions: false,
    },
    {
      sequence: 2,
      providerId: "provider:rest-one",
      kind: "REST",
      version: "1.0.0",
      toolContractIds: ["tool-contract:rest"],
      availability: "UNAVAILABLE",
      reason: "connection lost",
      recordedAt: "2026-08-22T11:01:00.000Z",
      replayConsequentialActions: false,
    },
    {
      sequence: 3,
      providerId: "provider:rest-one",
      kind: "REST",
      version: "1.1.0",
      toolContractIds: ["tool-contract:rest"],
      availability: "AVAILABLE",
      reason: "provider registered",
      recordedAt: "2026-08-22T11:02:00.000Z",
      replayConsequentialActions: false,
    },
  ]);
  assert.equal(events.every(Object.isFrozen), true);
  assert.equal(adapterInvocations, 0);

  unsubscribe();
  gateway.unregisterProvider(adapter.id, "shut down");
  assert.equal(events.length, 3);
});

test("retains consequential adapter uncertainty so an identical retry cannot replay the operation", async () => {
  const uncertain = configuredRestGateway({
    authorize: allowAuthority,
    resolveCredential: () => ({ token: "test" }),
    invoke: () => { throw new Error("connection lost after send"); },
  });

  const firstAttempt = uncertain.gateway.execute(restOperation());
  await assert.rejects(firstAttempt, /connection lost after send/);
  const identicalRetry = uncertain.gateway.execute(restOperation());
  assert.equal(identicalRetry, firstAttempt);
  await assert.rejects(identicalRetry, /connection lost after send/);
  assert.equal(uncertain.invocations.length, 1);
});

function restRegistry(): ProviderContractRegistry {
  const registry = new ProviderContractRegistry();
  registry.registerCapability({ id: "capability:http", version: "1.0.0", description: "Provider-neutral HTTP operations" });
  registry.registerToolContract({
    id: "tool-contract:rest",
    version: "1.0.0",
    kind: "REST",
    capabilityId: "capability:http",
    operations: [{ name: "rest:request", effectClass: "EXTERNAL" }],
  });
  return registry;
}

function configuredRestGateway(options: {
  readonly authorize?: (request: ProviderAuthorityRequest) => ProviderAuthorityDecision | Promise<ProviderAuthorityDecision>;
  readonly resolveCredential?: (request: ProviderCredentialRequest) => unknown | Promise<unknown>;
  readonly invoke?: (request: ProviderAdapterRequest) => ProviderAdapterObservation | Promise<ProviderAdapterObservation>;
}) {
  const invocations: ProviderAdapterRequest[] = [];
  const gateway = new ProviderGateway({
    registry: restRegistry(),
    ...(options.authorize === undefined ? {} : { authorize: options.authorize }),
    ...(options.resolveCredential === undefined ? {} : { resolveCredential: options.resolveCredential }),
  });
  gateway.registerProvider({
    id: "provider:rest-one",
    kind: "REST",
    version: "1.0.0",
    toolContractIds: ["tool-contract:rest"],
    invoke: async (request): Promise<ProviderAdapterObservation> => {
      invocations.push(request);
      if (options.invoke !== undefined) return options.invoke(request);
      return { status: "SUCCEEDED", output: { statusCode: 200 }, observedAt: "2026-08-22T10:01:00Z" };
    },
  });
  gateway.bindProvider({
    id: "provider-binding:rest-app",
    workspaceId: "workspace:one",
    appInstanceId: "application-instance:one",
    providerId: "provider:rest-one",
    toolContractIds: ["tool-contract:rest"],
    principalIds: ["principal:human-one"],
    credentialReference: "credential-ref:rest-one",
  });
  return { gateway, invocations };
}

function allowAuthority(): ProviderAuthorityDecision {
  return { allowed: true, decisionId: "authority-decision:rest-read", reason: "explicit grant" };
}

function restOperation(overrides: Partial<ProviderOperationEnvelope> = {}): ProviderOperationEnvelope {
  return {
    id: "provider-operation:rest-read",
    workspaceId: "workspace:one",
    principalId: "principal:human-one",
    appInstanceId: "application-instance:one",
    bindingId: "provider-binding:rest-app",
    toolContractId: "tool-contract:rest",
    operation: "rest:request",
    authorityReference: "authority-decision:rest-read",
    idempotencyKey: "idempotency:rest-read",
    expectedEffect: { id: "expected-effect:remote-read", effectClass: "EXTERNAL", description: "Observe remote resource" },
    reconciliation: { id: "reconciliation-plan:remote-read", strategy: "CANONICAL_READ", required: true },
    input: { method: "GET", resource: "/items/one" },
    requestedAt: "2026-08-22T10:00:00Z",
    ...overrides,
  };
}
