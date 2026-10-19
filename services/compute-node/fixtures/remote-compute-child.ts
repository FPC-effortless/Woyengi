import { HostedComputeNodeRuntime, HttpComputeNodeStatePort } from "../index.ts";

const baseUrl = process.env.WOYENGI_TEST_REMOTE_COMPUTE_URL;
const nodeToken = process.env.WOYENGI_TEST_REMOTE_NODE_TOKEN;
if (!baseUrl || !nodeToken) throw new Error("missing test compute transport context");

const port = new HttpComputeNodeStatePort({ baseUrl, nodeToken });
const runtime = new HostedComputeNodeRuntime({
  statePort: port,
  providerId: "provider:hosted-compute",
  workloadProvider: {
    execute: async (request) => {
      if (request.workload.id !== (process.env.WOYENGI_TEST_REMOTE_WORKLOAD_ID ?? "workload:repair-19c")) throw new Error("unapproved workload");
      return {
        outcome: "succeeded",
        output: { repaired: true },
        usage: { durationMs: 240, outputBytes: 32, cost: { amount: 2, currency: "USD" } },
        finishedAt: "2026-08-22T13:02:30Z",
      };
    },
  },
});
await runtime.connect({
  nodeId: "compute-node:one",
  version: "1.0.0",
  workspaceIds: ["workspace:one"],
  capabilities: ["compute:typescript"],
  budgetLimit: {
    maxDurationMs: 10_000,
    maxOutputBytes: 1024,
    maxCost: { amount: 10, currency: "USD" },
  },
  heartbeatTtlMs: 300_000,
  registeredAt: "2026-08-22T13:00:00Z",
});
await runtime.heartbeat("2026-08-22T13:01:00Z");
const observation = await runtime.runNext("2026-08-22T13:02:00Z");
process.stdout.write(JSON.stringify({ observation }) + "\n");
