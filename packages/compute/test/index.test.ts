import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ComputeNodeRegistry,
  LocalComputeProvider,
  type WorkloadExecutor,
  type WorkloadSpec,
} from "../src/index.ts";

test("executes an authorized budgeted workload once and returns an observation-only usage receipt", async () => {
  const nodes = new ComputeNodeRegistry();
  nodes.register({
    id: "compute-node:laptop",
    workspaceId: "workspace:personal",
    capabilities: ["compute:text-transform", "runtime:typescript"],
    registeredAt: at(0),
    heartbeatTtlMs: 60_000,
  });
  const lease = nodes.lease({
    id: "compute-lease:transform-1",
    workspaceId: "workspace:personal",
    nodeId: "compute-node:laptop",
    workloadId: "workload:transform-1",
    requiredCapabilities: ["compute:text-transform"],
    leasedAt: at(1),
    ttlMs: 30_000,
  });
  const calls: string[] = [];
  const executor: WorkloadExecutor = {
    async execute(request) {
      calls.push(request.workload.id);
      return {
        outcome: "succeeded",
        output: { normalized: "hello woyengi" },
        usage: {
          durationMs: 42,
          outputBytes: 25,
          cost: { amount: 0.002, currency: "USD" },
        },
        finishedAt: at(2),
      };
    },
  };
  const provider = new LocalComputeProvider({
    nodes,
    executor,
    authorize: (request) =>
      request.operation === "EXECUTE_WORKLOAD" &&
      request.authorityReference === "capability:execute-transform",
    limits: {
      maxDurationMs: 10_000,
      maxOutputBytes: 10_000,
      maxCost: { amount: 1, currency: "USD" },
    },
  });
  const workload: WorkloadSpec = {
    id: "workload:transform-1",
    workspaceId: "workspace:personal",
    requestedByPrincipalId: "principal:owner",
    operation: "compute:text-transform",
    input: { text: "Hello Woyengi" },
    requiredCapabilities: ["compute:text-transform"],
    budget: {
      maxDurationMs: 1_000,
      maxOutputBytes: 1_000,
      maxCost: { amount: 0.1, currency: "USD" },
    },
    authorityReference: "capability:execute-transform",
    idempotencyKey: "idempotency:transform-1",
    createdAt: at(0),
  };

  const receipt = await provider.execute({
    executionId: "compute-execution:transform-1",
    workload,
    leaseId: lease.id,
    startedAt: at(1),
  });
  const retry = await provider.execute({
    executionId: "compute-execution:transform-1",
    workload,
    leaseId: lease.id,
    startedAt: at(1),
  });

  assert.strictEqual(retry, receipt);
  assert.deepEqual(calls, ["workload:transform-1"]);
  assert.equal(receipt.contract, "woyengi.compute-usage.v1");
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.observationOnly, true);
  assert.equal(receipt.semanticMutation, false);
  assert.deepEqual(receipt.output, { normalized: "hello woyengi" });
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.output), true);
});

test("fails closed before execution without consuming the lease when authority is denied", async () => {
  const nodes = new ComputeNodeRegistry();
  nodes.register({
    id: "compute-node:authority",
    workspaceId: "workspace:personal",
    capabilities: ["compute:text-transform"],
    registeredAt: at(0),
    heartbeatTtlMs: 60_000,
  });
  const lease = nodes.lease({
    id: "compute-lease:authority",
    workspaceId: "workspace:personal",
    nodeId: "compute-node:authority",
    workloadId: "workload:authority",
    requiredCapabilities: ["compute:text-transform"],
    leasedAt: at(1),
    ttlMs: 30_000,
  });
  let allowed = false;
  let calls = 0;
  const provider = new LocalComputeProvider({
    nodes,
    authorize: () => allowed,
    limits: budget(1),
    executor: {
      async execute() {
        calls += 1;
        return successObservation();
      },
    },
  });
  const workload = workloadSpec({ id: "workload:authority", key: "idempotency:authority" });

  await assert.rejects(
    provider.execute({
      executionId: "compute-execution:authority-denied",
      workload,
      leaseId: lease.id,
      startedAt: at(2),
    }),
    /compute authority denied/,
  );
  assert.equal(calls, 0);

  allowed = true;
  const receipt = await provider.execute({
    executionId: "compute-execution:authority-allowed",
    workload,
    leaseId: lease.id,
    startedAt: at(3),
  });
  assert.equal(receipt.status, "succeeded");
  assert.equal(calls, 1);
});

test("discovers only live workspace nodes and rejects expired leases, excess budgets, and duplicate execution", async () => {
  const nodes = new ComputeNodeRegistry();
  nodes.register({
    id: "compute-node:governed",
    workspaceId: "workspace:personal",
    capabilities: ["runtime:typescript", "compute:text-transform", "compute:text-transform"],
    registeredAt: at(0),
    heartbeatTtlMs: 10_000,
  });
  assert.deepEqual(
    nodes.discover({
      workspaceId: "workspace:personal",
      requiredCapabilities: ["compute:text-transform"],
      at: at(1),
    }).map((node) => node.id),
    ["compute-node:governed"],
  );
  assert.deepEqual(
    nodes.discover({
      workspaceId: "workspace:other",
      requiredCapabilities: ["compute:text-transform"],
      at: at(1),
    }),
    [],
  );
  assert.deepEqual(
    nodes.discover({
      workspaceId: "workspace:personal",
      requiredCapabilities: ["compute:vision"],
      at: at(1),
    }),
    [],
  );
  const heartbeat = nodes.heartbeat({
    workspaceId: "workspace:personal",
    nodeId: "compute-node:governed",
    expectedVersion: 1,
    recordedAt: at(2),
    heartbeatTtlMs: 60_000,
  });
  assert.equal(heartbeat.version, 2);
  assert.throws(
    () =>
      nodes.heartbeat({
        workspaceId: "workspace:personal",
        nodeId: "compute-node:governed",
        expectedVersion: 1,
        recordedAt: at(3),
        heartbeatTtlMs: 60_000,
      }),
    /compute node version conflict/,
  );
  assert.throws(
    () =>
      nodes.heartbeat({
        workspaceId: "workspace:personal",
        nodeId: "compute-node:governed",
        expectedVersion: 2,
        recordedAt: at(1),
        heartbeatTtlMs: 60_000,
      }),
    /heartbeat time cannot move backward/,
  );
  assert.throws(
    () =>
      nodes.lease({
        id: "compute-lease:wrong-workspace",
        workspaceId: "workspace:other",
        nodeId: "compute-node:governed",
        workloadId: "workload:wrong-workspace",
        requiredCapabilities: ["compute:text-transform"],
        leasedAt: at(3),
        ttlMs: 10_000,
      }),
    /compute node is outside workspace/,
  );

  let calls = 0;
  const provider = new LocalComputeProvider({
    nodes,
    authorize: () => true,
    limits: budget(1),
    executor: {
      async execute() {
        calls += 1;
        return successObservation();
      },
    },
  });
  const expiredLease = nodes.lease({
    id: "compute-lease:expired",
    workspaceId: "workspace:personal",
    nodeId: "compute-node:governed",
    workloadId: "workload:expired",
    requiredCapabilities: ["compute:text-transform"],
    leasedAt: at(3),
    ttlMs: 1_000,
  });
  await assert.rejects(
    provider.execute({
      executionId: "compute-execution:expired",
      workload: workloadSpec({ id: "workload:expired", key: "idempotency:expired" }),
      leaseId: expiredLease.id,
      startedAt: at(5),
    }),
    /compute lease expired/,
  );
  assert.equal(calls, 0);

  const firstLease = nodes.lease({
    id: "compute-lease:unique-first",
    workspaceId: "workspace:personal",
    nodeId: "compute-node:governed",
    workloadId: "workload:unique",
    requiredCapabilities: ["compute:text-transform"],
    leasedAt: at(6),
    ttlMs: 10_000,
  });
  await provider.execute({
    executionId: "compute-execution:unique-first",
    workload: workloadSpec({ id: "workload:unique", key: "idempotency:unique-first" }),
    leaseId: firstLease.id,
    startedAt: at(7),
  });
  const duplicateLease = nodes.lease({
    id: "compute-lease:unique-duplicate",
    workspaceId: "workspace:personal",
    nodeId: "compute-node:governed",
    workloadId: "workload:unique",
    requiredCapabilities: ["compute:text-transform"],
    leasedAt: at(8),
    ttlMs: 10_000,
  });
  await assert.rejects(
    provider.execute({
      executionId: "compute-execution:unique-duplicate",
      workload: workloadSpec({ id: "workload:unique", key: "idempotency:unique-duplicate" }),
      leaseId: duplicateLease.id,
      startedAt: at(9),
    }),
    /duplicate workload execution denied/,
  );
  assert.equal(calls, 1);

  const expensiveLease = nodes.lease({
    id: "compute-lease:expensive",
    workspaceId: "workspace:personal",
    nodeId: "compute-node:governed",
    workloadId: "workload:expensive",
    requiredCapabilities: ["compute:text-transform"],
    leasedAt: at(10),
    ttlMs: 10_000,
  });
  const expensive = workloadSpec({ id: "workload:expensive", key: "idempotency:expensive" });
  await assert.rejects(
    provider.execute({
      executionId: "compute-execution:expensive",
      workload: { ...expensive, budget: budget(2) },
      leaseId: expensiveLease.id,
      startedAt: at(11),
    }),
    /compute budget exceeds provider limits/,
  );
  assert.equal(calls, 1);
});

function workloadSpec(input: { readonly id: string; readonly key: string }): WorkloadSpec {
  return {
    id: input.id,
    workspaceId: "workspace:personal",
    requestedByPrincipalId: "principal:owner",
    operation: "compute:text-transform",
    input: { text: "Hello Woyengi" },
    requiredCapabilities: ["compute:text-transform"],
    budget: budget(0.1),
    authorityReference: "capability:execute-transform",
    idempotencyKey: input.key,
    createdAt: at(0),
  };
}

function budget(maxCost: number) {
  return {
    maxDurationMs: 1_000,
    maxOutputBytes: 1_000,
    maxCost: { amount: maxCost, currency: "USD" },
  } as const;
}

function successObservation() {
  return {
    outcome: "succeeded" as const,
    output: { normalized: "hello woyengi" },
    usage: {
      durationMs: 42,
      outputBytes: 25,
      cost: { amount: 0.002, currency: "USD" },
    },
    finishedAt: at(4),
  };
}

function at(second: number): string {
  return `2026-08-22T09:00:${String(second).padStart(2, "0")}+01:00`;
}
