import assert from "node:assert/strict";
import { test } from "node:test";

import { ApplicationInstaller, defineApplicationPackage } from "../../../packages/apps/src/index.ts";
import { ComputeNodeRegistry, LocalComputeProvider, type WorkloadSpec } from "../../../packages/compute/src/index.ts";
import { GovernedExecutionEngine, type ControlDecision } from "../../../packages/effects/src/index.ts";
import { CapabilityEngine, defineCapability } from "../../../packages/permissions/src/index.ts";
import { WorkRegistry } from "../../../packages/work/src/index.ts";
import { WorkspaceRegistry } from "../../../packages/workspace/src/index.ts";

const recordedAt = (minute: number): string =>
  `2026-08-22T10:${String(minute).padStart(2, "0")}:00+01:00`;

test("runs the first isolated local human-and-agent flow through a verified semantic commit", async () => {
  const workspaces = new WorkspaceRegistry();
  const owner = workspaces.registerPrincipal({
    operationId: "workspace-operation:principal-owner",
    id: "principal:owner",
    kind: "human",
    recordedAt: recordedAt(0),
  });
  const collaborator = workspaces.registerPrincipal({
    operationId: "workspace-operation:principal-collaborator",
    id: "principal:collaborator",
    kind: "human",
    recordedAt: recordedAt(1),
  });
  const agent = workspaces.registerPrincipal({
    operationId: "workspace-operation:principal-agent",
    id: "principal:release-agent",
    kind: "agent",
    recordedAt: recordedAt(2),
  });
  const account = workspaces.createAccount({
    operationId: "workspace-operation:account",
    id: "account:owner",
    ownerPrincipalId: owner.id,
    personalWorkspaceId: "workspace:personal-owner",
    recordedAt: recordedAt(3),
  });
  const organization = workspaces.createOrganization({
    operationId: "workspace-operation:organization",
    id: "organization:demo",
    workspaceId: "workspace:demo-organization",
    ownerMembershipId: "membership:owner-demo",
    ownerPrincipalId: owner.id,
    recordedAt: recordedAt(4),
  });
  const invitation = workspaces.inviteMember({
    operationId: "workspace-operation:invite-collaborator",
    id: "membership:collaborator-demo",
    organizationId: organization.organization.id,
    principalId: collaborator.id,
    invitedByPrincipalId: owner.id,
    recordedAt: recordedAt(5),
  });
  workspaces.acceptInvitation({
    operationId: "workspace-operation:accept-collaborator",
    membershipId: invitation.id,
    principalId: collaborator.id,
    recordedAt: recordedAt(6),
  });

  assert.equal(workspaces.switchWorkspace({ principalId: owner.id, workspaceId: account.workspace.id }).accountId, account.account.id);
  assert.equal(workspaces.switchWorkspace({ principalId: collaborator.id, workspaceId: organization.workspace.id }).organizationId, organization.organization.id);
  assert.throws(
    () => workspaces.switchWorkspace({ principalId: collaborator.id, workspaceId: account.workspace.id }),
    /workspace access denied/,
  );

  const applicationPackage = defineApplicationPackage({
    id: "application-package:release-desk",
    name: "Release Desk",
    version: "1.0.0",
    blueprintRef: "app-blueprint:release-desk-v1",
    dependencies: [],
    surfaces: ["surface:release-home"],
    activities: ["activity-type:release"],
    capabilityRequirements: ["capability-operation:execute"],
    automations: [],
    procedures: ["procedure:release"],
    optionalAgents: ["agent-role:release"],
    authorityRequirements: ["authority:release"],
    verificationContracts: ["verification-contract:release"],
    integrationRequirements: [],
    runtimeRequirements: ["runtime:local-compute"],
    migrations: [],
    compatibility: {
      platformApi: { minInclusive: "0.0.0", maxExclusive: "1.0.0" },
      compatibleFromVersions: [],
    },
    provenance: ["provenance:local-seed"],
    signature: { algorithm: "test", keyId: "key:local", value: "local-test-signature" },
  });
  const applications = new ApplicationInstaller({ platformApiVersion: "0.1.0" });
  const orgApp = applications.install(applicationPackage, {
    instanceId: "application-instance:release-desk-org",
    workspaceId: organization.workspace.id,
    semanticObjectBindings: { release: `${organization.workspace.id}/objects/release-1` },
    roleBindings: { owner: owner.id },
    participantBindings: { agent: agent.id, collaborator: collaborator.id },
    integrationBindings: {},
    surfaceConfiguration: { title: "Demo release" },
    configuration: { approvalMode: "verified" },
  });
  assert.equal(orgApp.workspaceId, organization.workspace.id);
  assert.throws(
    () => applications.install(applicationPackage, {
      instanceId: "application-instance:cross-workspace",
      workspaceId: account.workspace.id,
      semanticObjectBindings: { release: `${organization.workspace.id}/objects/release-1` },
      roleBindings: { owner: owner.id },
      participantBindings: {},
      integrationBindings: {},
      surfaceConfiguration: {},
      configuration: {},
    }),
    /cross-workspace semantic object binding is forbidden/,
  );

  const work = new WorkRegistry();
  const instance = work.createWorkInstance({
    operationId: "work-operation:create-release",
    id: "work-instance:release-1",
    workspaceId: organization.workspace.id,
    intent: "Ship the verified local release",
    createdByPrincipalId: owner.id,
    participants: [owner, collaborator, agent],
    roles: {
      workOwners: [owner.id],
      decisionAuthorities: [owner.id],
      reviewers: [collaborator.id],
      approvers: [owner.id],
    },
    context: { applicationInstanceId: orgApp.id },
    recordedAt: recordedAt(7),
  });
  const episode = work.startEpisode({
    operationId: "work-operation:start-release-episode",
    id: "work-episode:release-1",
    workspaceId: organization.workspace.id,
    workInstanceId: instance.id,
    expectedVersion: 1,
    objective: "Execute, reconcile, and verify the release",
    actorPrincipalId: agent.id,
    context: { delegatedByPrincipalId: owner.id },
    recordedAt: recordedAt(8),
  });
  const activity = work.addActivity({
    operationId: "work-operation:add-release-activity",
    id: "activity:release-1",
    activityType: "activity-type:release",
    workspaceId: organization.workspace.id,
    workInstanceId: instance.id,
    workEpisodeId: episode.id,
    expectedVersion: 2,
    actorPrincipalId: owner.id,
    context: { traceId: "trace:release-1" },
    recordedAt: recordedAt(9),
  });

  const capabilities = new CapabilityEngine();
  const agentGrant = defineCapability({
    id: "capability:agent-release",
    workspaceId: organization.workspace.id,
    principal: agent.id,
    principalKind: "agent",
    issuer: owner.id,
    resourcePrefixes: [`${organization.workspace.id}/workloads/release-1`],
    graphTypes: ["work"],
    entityIds: [instance.id],
    operations: ["EXECUTE"],
    purposes: ["release"],
    maxSensitivity: "internal",
    conditions: { episodeId: episode.id },
    validFrom: recordedAt(8),
    expiresAt: recordedAt(30),
    delegation: { canDelegate: false, depth: 0, maxDepth: 0 },
  });
  capabilities.register(agentGrant);
  const authority = capabilities.authorize({
    principal: agent.id,
    resourceId: `${organization.workspace.id}/workloads/release-1`,
    graphType: "work",
    entityId: instance.id,
    operation: "EXECUTE",
    purpose: "release",
    sensitivity: "internal",
    context: { episodeId: episode.id },
    workspaceContext: { workspaceId: organization.workspace.id, principalId: agent.id },
    at: recordedAt(10),
  });
  assert.equal(authority.allowed, true);
  work.assignActivity({
    operationId: "work-operation:assign-release-agent",
    id: "assignment:release-agent",
    workspaceId: organization.workspace.id,
    workInstanceId: instance.id,
    activityId: activity.id,
    expectedVersion: 3,
    assignedByPrincipalId: owner.id,
    assignee: agent,
    authorizationReference: agentGrant.id,
    context: { episodeId: episode.id },
    recordedAt: recordedAt(10),
  });

  const nodes = new ComputeNodeRegistry();
  const node = nodes.register({
    id: "compute-node:local",
    workspaceId: organization.workspace.id,
    capabilities: ["compute:release"],
    registeredAt: recordedAt(10),
    heartbeatTtlMs: 600_000,
  });
  const lease = nodes.lease({
    id: "compute-lease:release-1",
    workspaceId: organization.workspace.id,
    nodeId: node.id,
    workloadId: "workload:release-1",
    requiredCapabilities: ["compute:release"],
    leasedAt: recordedAt(11),
    ttlMs: 300_000,
  });
  const compute = new LocalComputeProvider({
    nodes,
    authorize: (request) => request.authorityReference === agentGrant.id && authority.allowed,
    limits: {
      maxDurationMs: 60_000,
      maxOutputBytes: 100_000,
      maxCost: { amount: 1, currency: "USD" },
    },
    executor: {
      async execute() {
        return {
          outcome: "succeeded",
          output: { releaseId: "release:local-1", status: "published" },
          usage: { durationMs: 120, outputBytes: 64, cost: { amount: 0.01, currency: "USD" } },
          finishedAt: recordedAt(12),
        };
      },
    },
  });
  const workload: WorkloadSpec = {
    id: "workload:release-1",
    workspaceId: organization.workspace.id,
    requestedByPrincipalId: agent.id,
    operation: "compute:release",
    input: { applicationInstanceId: orgApp.id },
    requiredCapabilities: ["compute:release"],
    budget: {
      maxDurationMs: 30_000,
      maxOutputBytes: 10_000,
      maxCost: { amount: 0.1, currency: "USD" },
    },
    authorityReference: agentGrant.id,
    idempotencyKey: "idempotency:release-1",
    createdAt: recordedAt(11),
  };
  const usageReceipt = await compute.execute({
    executionId: "compute-execution:release-1",
    workload,
    leaseId: lease.id,
    startedAt: recordedAt(11),
  });
  assert.equal(usageReceipt.observationOnly, true);
  assert.equal(usageReceipt.semanticMutation, false);

  const control = new GovernedExecutionEngine();
  const decision = (id: string, kind: ControlDecision["kind"]): ControlDecision => ({
    id: `decision:${id}`,
    kind,
    status: "ALLOWED",
    reason: kind === "AUTHORITY" ? `authorized by ${agentGrant.id}` : `${kind.toLowerCase()} constraints satisfied`,
  });
  const manifest = control.createManifest({
    id: "execution-manifest:release-1",
    actionIntent: {
      id: "action-intent:release-1",
      correlation: {
        workspaceId: organization.workspace.id,
        workInstanceId: instance.id,
        workEpisodeId: episode.id,
        traceId: "trace:release-1",
      },
      principalId: agent.id,
      objective: episode.objective,
    },
    effectPlan: {
      id: "effect-plan:release-1",
      effects: [
        {
          id: "expected-effect:release-state",
          effectClass: "SEMANTIC",
          description: "Record the verified release state",
          changeSetId: "change-set:release-1",
        },
        {
          id: "expected-effect:published-release",
          effectClass: "EXTERNAL",
          description: "Publish the release through local compute",
          idempotencyKey: workload.idempotencyKey,
          reconciliationRequired: true,
          correction: "COMPENSATION_OR_REPAIR",
        },
      ],
    },
    decisions: {
      authority: decision("authority-release-1", "AUTHORITY"),
      policy: decision("policy-release-1", "POLICY"),
      budget: decision("budget-release-1", "BUDGET"),
      risk: decision("risk-release-1", "RISK"),
    },
    verificationContract: {
      id: "verification-contract:release-1",
      requiredEvidenceIds: ["evidence:release-1"],
      independentVerifierRequired: true,
      budget: { maximumCost: 0.1, currency: "USD" },
      maximumAttempts: 1,
      stopCondition: "VERIFIED",
    },
    recordedAt: recordedAt(11),
  });
  control.recordReceipt({
    id: "execution-receipt:release-1",
    manifestId: manifest.id,
    providerId: node.id,
    status: usageReceipt.status === "succeeded" ? "SUCCEEDED" : "FAILED",
    recordedAt: recordedAt(12),
  });
  const semanticObservation = control.observeEffect({
    id: "observed-effect:release-state",
    manifestId: manifest.id,
    expectedEffectId: "expected-effect:release-state",
    effectClass: "SEMANTIC",
    providerId: "provider:semantic-state",
    observation: "change set staged pending acceptance",
    recordedAt: recordedAt(13),
  });
  const externalObservation = control.observeEffect({
    id: "observed-effect:published-release",
    manifestId: manifest.id,
    expectedEffectId: "expected-effect:published-release",
    effectClass: "EXTERNAL",
    providerId: node.id,
    observation: JSON.stringify(usageReceipt.output),
    recordedAt: recordedAt(13),
  });
  control.reconcile({
    id: "reconciliation:release-state",
    manifestId: manifest.id,
    expectedEffectId: "expected-effect:release-state",
    observedEffectId: semanticObservation.id,
    status: "CONFIRMED",
    strategy: "CANONICAL_READ",
    reason: "staged change set matches the expected semantic effect",
    recordedAt: recordedAt(14),
  });
  control.reconcile({
    id: "reconciliation:published-release",
    manifestId: manifest.id,
    expectedEffectId: "expected-effect:published-release",
    observedEffectId: externalObservation.id,
    status: "CONFIRMED",
    strategy: "IMMEDIATE_REREAD",
    reason: "published release was independently observed",
    recordedAt: recordedAt(14),
  });
  const evidence = control.attachEvidence({
    id: "evidence:release-1",
    manifestId: manifest.id,
    source: "artifact:release-observation-1",
    recordedAt: recordedAt(15),
  });
  const verification = control.recordVerification({
    id: "verification-result:release-1",
    manifestId: manifest.id,
    verifierId: "verifier:independent-local",
    status: "VERIFIED",
    independentFromProvider: true,
    evidenceIds: [evidence.id],
    attempt: 1,
    cost: { amount: 0.02, currency: "USD" },
    stopConditionMet: true,
    recordedAt: recordedAt(16),
  });
  const accepted = control.decide({
    id: "acceptance-decision:release-1",
    outcomeId: "accepted-outcome:release-1",
    semanticCommitId: "semantic-commit:release-1",
    manifestId: manifest.id,
    acceptedByPrincipalId: owner.id,
    recordedAt: recordedAt(17),
  });

  assert.equal(accepted.outcome.status, "ACCEPTED");
  assert.equal(accepted.outcome.acceptanceDecisionId, "acceptance-decision:release-1");
  assert.equal(accepted.semanticCommit?.verificationResultId, verification.id);
  assert.equal(accepted.semanticCommit?.id, "semantic-commit:release-1");
  assert.deepEqual(accepted.semanticCommit?.semanticEffectIds, ["expected-effect:release-state"]);
  const snapshot = control.execution(manifest.id);
  assert.equal(snapshot?.correlation.traceId, "trace:release-1");
  assert.equal(snapshot?.journal.every((entry) => entry.correlation.traceId === "trace:release-1"), true);
  assert.equal(work.activityStream({ workspaceId: organization.workspace.id, workInstanceId: instance.id }).at(-1)?.kind, "activity.assigned");
  assert.throws(
    () => work.workInstance({ workspaceId: account.workspace.id, id: instance.id }),
    /outside workspace/,
  );
});
