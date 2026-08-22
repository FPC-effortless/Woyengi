import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HostedComputeNodeRuntime,
  type ComputeNodeStatePort,
  type HostedComputeObservation,
  type HostedWorkloadLease,
} from "../index.ts";

test("registers, heartbeats, executes an authorized hosted lease once, and republishes after transport interruption", async () => {
  const calls: string[] = [];
  const published: HostedComputeObservation[] = [];
  let leaseRequests = 0;
  let providerExecutions = 0;
  let publishAttempts = 0;
  const lease = hostedLease();
  const statePort: ComputeNodeStatePort = {
    register: async (registration) => {
      calls.push(`register:${registration.nodeId}`);
      return {
        sessionId: "compute-node-session:node-one",
        nodeId: registration.nodeId,
        acceptedAt: "2026-08-22T13:00:00Z",
        heartbeatExpiresAt: "2026-08-22T13:05:00Z",
      };
    },
    heartbeat: async (heartbeat) => {
      calls.push(`heartbeat:${heartbeat.sessionId}`);
      return {
        sessionId: heartbeat.sessionId,
        nodeId: heartbeat.nodeId,
        acceptedAt: "2026-08-22T13:01:00Z",
        heartbeatExpiresAt: "2026-08-22T13:06:00Z",
      };
    },
    nextLease: async ({ sessionId }) => {
      calls.push(`lease:${sessionId}`);
      leaseRequests += 1;
      return lease;
    },
    authorize: async (request) => {
      calls.push(`authority:${request.envelope.authorityReference}`);
      return {
        allowed: true,
        decisionReference: "decision:authority-repair-19c",
        reason: "workspace execution grant",
      };
    },
    publishObservation: async (observation) => {
      publishAttempts += 1;
      published.push(observation);
      if (publishAttempts === 1) throw new Error("transport interrupted after receive");
    },
  };
  const runtime = new HostedComputeNodeRuntime({
    statePort,
    providerId: "provider:hosted-compute",
    workloadProvider: {
      execute: async (request) => {
        providerExecutions += 1;
        assert.equal(request.workload.id, "workload:repair-19c");
        assert.equal(request.node.id, "compute-node:one");
        assert.equal(request.lease.id, "compute-lease:repair-19c");
        return {
          outcome: "succeeded",
          output: { repaired: true },
          usage: {
            durationMs: 250,
            outputBytes: 32,
            cost: { amount: 2, currency: "USD" },
          },
          finishedAt: "2026-08-22T13:02:30Z",
        };
      },
    },
  });

  const session = await runtime.connect(nodeRegistration());
  assert.equal(session.sessionId, "compute-node-session:node-one");
  await runtime.heartbeat("2026-08-22T13:01:00Z");

  await assert.rejects(runtime.runNext("2026-08-22T13:02:00Z"), /transport interrupted after receive/);
  const retried = await runtime.runNext("2026-08-22T13:02:01Z");

  assert.equal(leaseRequests, 2);
  assert.equal(providerExecutions, 1);
  assert.equal(publishAttempts, 2);
  assert.deepEqual(published[1], published[0]);
  assert.deepEqual(retried, published[0]);
  assert.deepEqual(retried?.correlation, lease.envelope.correlation);
  assert.equal(retried?.authorityReference, "decision:authority-repair-19c");
  assert.equal(retried?.expectedEffectId, "expected-effect:ticket-update");
  assert.equal(retried?.reconciliation.id, "reconciliation:ticket-update");
  assert.equal(retried?.reconciliation.status, "PENDING");
  assert.equal(retried?.usage.cost.amount, 2);
  assert.equal(retried?.observationOnly, true);
  assert.equal(retried?.acceptedTruth, false);
  assert.equal(retried?.semanticMutation, false);
  assert.deepEqual(calls, [
    "register:compute-node:one",
    "heartbeat:compute-node-session:node-one",
    "lease:compute-node-session:node-one",
    "authority:decision:authority-repair-19c",
    "lease:compute-node-session:node-one",
    "authority:decision:authority-repair-19c",
  ]);
});

test("fails closed before provider execution for invalid hosted authority, scope, principal, budget, or idempotency", async () => {
  const base = hostedLease();
  const highBudget = {
    maxDurationMs: 20_000,
    maxOutputBytes: 2_048,
    maxCost: { amount: 20, currency: "USD" },
  };
  const cases = [
    { name: "authority", lease: base, allowed: false, error: /authority denied/ },
    {
      name: "workspace",
      lease: {
        ...base,
        envelope: {
          ...base.envelope,
          correlation: { ...base.envelope.correlation, workspaceId: "workspace:two" },
          workload: { ...base.envelope.workload, workspaceId: "workspace:two" },
        },
      },
      allowed: true,
      error: /workspace is not registered/,
    },
    {
      name: "principal",
      lease: { ...base, envelope: { ...base.envelope, principalId: "principal:human-two" } },
      allowed: true,
      error: /principal correlation mismatch/,
    },
    {
      name: "budget",
      lease: { ...base, envelope: { ...base.envelope, budget: highBudget, workload: { ...base.envelope.workload, budget: highBudget } } },
      allowed: true,
      error: /budget exceeds node limit/,
    },
    {
      name: "idempotency",
      lease: { ...base, envelope: { ...base.envelope, idempotencyKey: "compute:conflicting-envelope" } },
      allowed: true,
      error: /idempotency correlation mismatch/,
    },
  ] as const;

  for (const scenario of cases) {
    let providerExecutions = 0;
    let publications = 0;
    const statePort: ComputeNodeStatePort = {
      register: async ({ nodeId }) => ({
        sessionId: "compute-node-session:node-one",
        nodeId,
        acceptedAt: "2026-08-22T13:00:00Z",
        heartbeatExpiresAt: "2026-08-22T13:05:00Z",
      }),
      heartbeat: async () => { throw new Error("heartbeat not expected"); },
      nextLease: async () => scenario.lease,
      authorize: async ({ envelope }) => ({
        allowed: scenario.allowed,
        decisionReference: envelope.authorityReference,
        reason: scenario.allowed ? "allowed" : "denied",
      }),
      publishObservation: async () => { publications += 1; },
    };
    const runtime = new HostedComputeNodeRuntime({
      statePort,
      providerId: "provider:hosted-compute",
      workloadProvider: {
        execute: async () => {
          providerExecutions += 1;
          return {
            outcome: "succeeded",
            output: null,
            usage: { durationMs: 1, outputBytes: 0, cost: { amount: 0, currency: "USD" } },
            finishedAt: "2026-08-22T13:02:30Z",
          };
        },
      },
    });
    await runtime.connect({ ...nodeRegistration(), nodeId: "compute-node:one" });
    await assert.rejects(runtime.runNext("2026-08-22T13:02:00Z"), scenario.error);
    assert.equal(providerExecutions, 0, `${scenario.name} invoked provider`);
    assert.equal(publications, 0, `${scenario.name} published observation`);
  }
});

function nodeRegistration() {
  return {
    nodeId: "compute-node:one",
    version: "1.0.0",
    workspaceIds: ["workspace:one"],
    capabilities: ["compute:typescript"],
    budgetLimit: {
      maxDurationMs: 10_000,
      maxOutputBytes: 1_024,
      maxCost: { amount: 10, currency: "USD" },
    },
    heartbeatTtlMs: 300_000,
    registeredAt: "2026-08-22T13:00:00Z",
  };
}

function hostedLease(): HostedWorkloadLease {
  return {
    id: "compute-lease:repair-19c",
    nodeId: "compute-node:one",
    sessionId: "compute-node-session:node-one",
    leasedAt: "2026-08-22T13:01:30Z",
    expiresAt: "2026-08-22T13:04:00Z",
    envelope: {
      executionId: "compute-execution:repair-19c",
      correlation: {
        workspaceId: "workspace:one",
        workInstanceId: "work-instance:incident-19c",
        workEpisodeId: "work-episode:repair-19c",
        traceId: "trace:repair-19c",
      },
      principalId: "principal:agent-one",
      authorityReference: "decision:authority-repair-19c",
      budget: {
        maxDurationMs: 1_000,
        maxOutputBytes: 128,
        maxCost: { amount: 5, currency: "USD" },
      },
      idempotencyKey: "compute:repair-19c",
      workload: {
        id: "workload:repair-19c",
        workspaceId: "workspace:one",
        requestedByPrincipalId: "principal:agent-one",
        operation: "repair:ticket",
        input: { ticketId: "ticket:19c" },
        requiredCapabilities: ["compute:typescript"],
        budget: {
          maxDurationMs: 1_000,
          maxOutputBytes: 128,
          maxCost: { amount: 5, currency: "USD" },
        },
        authorityReference: "decision:authority-repair-19c",
        idempotencyKey: "compute:repair-19c",
        createdAt: "2026-08-22T13:01:00Z",
      },
      expectedEffect: {
        id: "expected-effect:ticket-update",
        effectClass: "EXTERNAL",
      },
      reconciliation: {
        id: "reconciliation:ticket-update",
        strategy: "CANONICAL_READ",
        required: true,
      },
      startedAt: "2026-08-22T13:02:00Z",
    },
  };
}
