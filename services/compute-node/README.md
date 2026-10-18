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

## PostgreSQL-backed hosted compute observation receipts

`PostgresHostedObservationJournal` adds **canonical, append-only**
PostgreSQL persistence for hosted compute observations. The trusted
state-side `ComputeNodeStatePort.publishObservation` implementation may
delegate to this journal after its own node/workspace/lease checks.
It stores the observation, originating Workspace scope, transaction
timestamp and SQL-assigned causal sequence. Separate API instances can
replay the same workspace-specific receipt history.

All persisted records must declare `observationOnly=true`,
`acceptedTruth=false`, `semanticMutation=false`, and
`reconciliation.status="PENDING"`. The receipt also includes the actual
usage/cost, the governed authority reference, a correlation, expected-effect
ID/class and the reconciliation plan ID. A duplicate publication of the
**same observation** (including concurrent retries through independent
PostgreSQL pools) converges to one immutable record; conflicting payloads
are rejected and never overwrite prior history.

The live PostgreSQL CI test launches the compute runtime in **another OS
process**, receives its observation via HTTP on the state-side port and
persists it to PostgreSQL. A second pool replays and verifies the receipt,
its expected-effect/reconciliation references, idempotent retries and
corrupted privileged history rejection.

This is still **observation storage**, not semantic effect acceptance.
State-side issuance and proof of the original authority/lease must come
from the injected state port, and a separate verifier must perform
reconciliation of external effects before recording an accepted result.
The journal's `history` method is trusted-operator only and must not be
exposed as an unscoped public read endpoint. Production PostgreSQL role
isolation, scoped authorization, durable lease queue and independent
effect verification remain required.
