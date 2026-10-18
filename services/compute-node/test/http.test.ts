import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  HostedComputeStateHttpApi, HttpComputeNodeStatePort,
  type ComputeNodeStatePort, type HostedComputeObservation,
  type HostedWorkloadLease,
} from "../index.ts";

const nodeToken = "remote-" + "m".repeat(48);
const wrongToken = "remote-" + "n".repeat(48);

test("runs authorized hosted compute in an independent OS process over authenticated state RPC", async (t) => {
  const observations: HostedComputeObservation[] = [];
  let leaseRequests = 0;
  let authorityChecks = 0;
  const state: ComputeNodeStatePort = {
    register: async input => {
      assert.equal(input.nodeId, "compute-node:one");
      assert.deepEqual(input.workspaceIds, ["workspace:one"]);
      return {
        sessionId: "compute-node-session:node-one", nodeId: input.nodeId,
        acceptedAt: "2026-08-22T13:00:00Z", heartbeatExpiresAt: "2026-08-22T13:05:00Z",
      };
    },
    heartbeat: async input => ({
      sessionId: input.sessionId, nodeId: input.nodeId,
      acceptedAt: "2026-08-22T13:01:00Z", heartbeatExpiresAt: "2026-08-22T13:06:00Z",
    }),
    nextLease: async input => {
      assert.equal(input.nodeId, "compute-node:one");
      leaseRequests += 1;
      return leaseRequests === 1 ? hostedLease() : undefined;
    },
    authorize: async input => {
      authorityChecks += 1;
      assert.equal(input.operation, "EXECUTE_HOSTED_WORKLOAD");
      assert.equal(input.envelope.authorityReference, "decision:authority-repair-19c");
      return {
        allowed: true, decisionReference: input.envelope.authorityReference,
        reason: "scope and capability grant verified by state service",
      };
    },
    publishObservation: async input => { observations.push(input); },
  };
  const api = new HostedComputeStateHttpApi({
    statePort: state,
    credentials: [{ nodeId: "compute-node:one", token: nodeToken }],
  });
  const server = await api.listen({ hostname: "127.0.0.1", port: 0 });
  t.after(() => server.close());
  const url = server.url + "/v1/compute/register";
  const request = (token: string, body: unknown) => fetch(url, {
    method: "POST", headers: {
      authorization: "Bearer " + token, "content-type": "application/json",
    }, body: JSON.stringify(body),
  });
  const attempt = {
    nodeId: "compute-node:one", version: "1.0.0",
    workspaceIds: ["workspace:one"], capabilities: ["compute:typescript"],
    budgetLimit: { maxDurationMs: 1000, maxOutputBytes: 32,
      maxCost: { amount: 1, currency: "USD" } },
    heartbeatTtlMs: 300000, registeredAt: "2026-08-22T13:00:00Z",
  };
  assert.equal((await request(wrongToken, attempt)).status, 401);
  assert.equal((await request(nodeToken, { ...attempt, nodeId: "compute-node:other" })).status, 403);
  assert.equal((await request(nodeToken, { ...attempt, unexpectedAuthority: true })).status, 400);
  assert.equal((await fetch(url)).status, 401);

  const child = spawn(process.execPath, [
    fileURLToPath(new URL("./remote-compute-child.ts", import.meta.url)),
  ], {
    shell: false,
    env: { ...process.env, WOYENGI_TEST_REMOTE_COMPUTE_URL: server.url,
      WOYENGI_TEST_REMOTE_NODE_TOKEN: nodeToken },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on("data", (x: Buffer) => output.push(x));
  child.stderr.on("data", (x: Buffer) => errors.push(x));
  const exit = await new Promise<number>((resolve, reject) => {
    const kill = setTimeout(() => { child.kill(); reject(new Error("compute child timed out")); }, 15_000);
    child.once("error", (error) => { clearTimeout(kill); reject(error); });
    child.once("close", (code) => { clearTimeout(kill); resolve(code ?? -1); });
  });
  assert.equal(exit, 0, Buffer.concat(errors).toString("utf8"));
  const childReceipt = JSON.parse(Buffer.concat(output).toString("utf8")) as {
    readonly observation: HostedComputeObservation;
  };
  assert.equal(childReceipt.observation?.status, "succeeded");
  assert.deepEqual(observations, [childReceipt.observation]);
  assert.equal(authorityChecks, 1);
  assert.equal(leaseRequests, 1);
  assert.equal(observations[0]?.observationOnly, true);
  assert.equal(observations[0]?.acceptedTruth, false);
  assert.equal(observations[0]?.semanticMutation, false);
  assert.equal(observations[0]?.usage.cost.amount, 2);
  assert.equal(observations[0]?.expectedEffectId, "expected-effect:ticket-update");
  assert.equal(observations[0]?.reconciliation.status, "PENDING");
});

test("remote compute client requires TLS outside loopback and bounded bearer credentials", () => {
  assert.throws(() => new HttpComputeNodeStatePort({
    baseUrl: "http://example.com", nodeToken,
  }), /HTTPS or loopback/);
  assert.throws(() => new HttpComputeNodeStatePort({
    baseUrl: "https://example.com/user@other.com", nodeToken,
  }), /HTTPS or loopback/);
  assert.throws(() => new HttpComputeNodeStatePort({
    baseUrl: "https://example.com", nodeToken: "short",
  }), /at least 32/);
});

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
      expectedEffect: { id: "expected-effect:ticket-update", effectClass: "EXTERNAL" },
      reconciliation: {
        id: "reconciliation:ticket-update", strategy: "CANONICAL_READ", required: true,
      },
      startedAt: "2026-08-22T13:02:00Z",
    },
  };
}
