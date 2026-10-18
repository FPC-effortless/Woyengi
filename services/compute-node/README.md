# Hosted compute node

## Remote state-server transport (WYG-019)

The `HostedComputeNodeRuntime` can now use `HttpComputeNodeStatePort`
to communicate with a separately hosted state server through authenticated
JSON requests. The state process exposes `HostedComputeStateHttpApi` with
a supplied trusted `ComputeNodeStatePort`; it binds to loopback only.
For a real remote host, deploy an HTTPS/TLS terminating reverse proxy or an
authenticated network tunnel in front of that listener. Remote node clients
reject plaintext HTTP except on the IPv4/IPv6 loopback interface. Never
reuse a human bearer token as a compute-node credential.

```ts
// Trusted state service:
const api = new HostedComputeStateHttpApi({
  statePort: authoritativeComputeStatePort,
  credentials: [{ nodeId: "compute-node:one", token: securelyIssuedNodeToken }],
});
const listener = await api.listen({ hostname: "127.0.0.1", port: 8142 });

// Separately running compute-node process:
const remote = new HttpComputeNodeStatePort({
  baseUrl: "https://woyengi-state.example.com",
  nodeToken: securelyIssuedNodeToken,
});
const runtime = new HostedComputeNodeRuntime({
  statePort: remote, providerId: "provider:hosted-compute",
  workloadProvider: governedWorkloadProvider,
});
```

The state server authenticates the node credential before parsing payloads,
binds it to a single node ID, enforces strict route and top-level field
names, and caps request size to 64KiB. Each `register`, `heartbeat`,
`lease`, `authorize` and `observations` call uses this channel.
`HostedComputeNodeRuntime` performs its own lease, authority,
capability, workspace, idempotency, and budget checks before executing any
provider code. Result publications contain usage, expected-effect and
reconciliation identifiers and are explicitly **observation-only**;
a separate verifier must reconcile expected effects before treating the
result as accepted truth.

`services/compute-node/test/http.test.ts` spawns an actual **different
operating-system process** and runs the compute runtime through loopback
HTTP to a state-side port in its parent. The test asserts credential and
scope rejection, authority verification before provider execution, output,
usage and reconciliation fields in the published observation.

This bridge does **not** implement a durable PostgreSQL state-side lease
queue or journal for compute observations; those remain responsibilities
of the injected state port. Production work still requires durable
at-least-once publication handling, state-side idempotency, TLS/proxy
hardening, node credential rotation, trusted authorization policy and
proof of effect reconciliation. This is not full WYG-019 acceptance.
