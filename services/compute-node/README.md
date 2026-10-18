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

## PostgreSQL-authoritative hosted compute state port (WYG-019 increment)

`PostgresHostedComputeStatePort` now implements the full
`ComputeNodeStatePort` over canonical PostgreSQL state records for a
*single global, SQL-serialized compute control scope*. It accepts an
**explicit trusted policy callback** and the PostgreSQL observation journal:

```ts
import {
  PostgresHostedComputeStatePort,
  PostgresHostedObservationJournal,
  HostedComputeStateHttpApi,
} from "./index.ts";

const receipts = PostgresHostedObservationJournal.open({ pool });
const statePort = PostgresHostedComputeStatePort.open({
  pool,
  receipts,
  providerId: "provider:hosted-compute",
  authorize: async (request) => independentAuthorityEvaluator(request),
});
const api = new HostedComputeStateHttpApi({
  statePort,
  credentials: [{ nodeId: "compute-node:one", token: trustedNodeCredential }],
});

// A trusted state-side operator, never the node's HTTP API, queues
// a fully scoped, independently authorized Work lease:
await statePort.queueLease(approvedHostedLease);
```

The callback **must actually check governing authority** for the
requested principal (including AgentPrincipal delegation), workspace,
provider, operation and budget. It is required both at queue admission
and again before execution authorization. An opaque
`authorityReference` from the worker alone does not authorize anything.
There is **no public queue or policy-grant HTTP route**.

`register` and `heartbeat` establish immutable node/session history.
`queueLease` admits only a workload whose node, session, workspace,
capabilities and budget match the authoritative registration.
`nextLease` replays the canonical global history **inside the same SQL
transaction and counter-row lock** used for the `compute.lease.issued`
operation. Two independently connected state-server processes cannot
claim the same queued lease. `authorize` requires an issued,
envelope-identical lease, the expected provider, an active node session
and a fresh allow decision from the trusted policy.

`publishObservation` requires a previously issued lease and verifies
the observation's node, principal, workload, execution, budget, authority
reference, expected effect and reconciliation fields. It then delegates
the observation-only receipt to the existing PostgreSQL
`PostgresHostedObservationJournal` (durable and idempotent).
The trusted-policy result cannot be copied from an untrusted provider
observation, and these receipts **never apply semantic state changes**.

**Proof:** `services/compute-node/test/postgres-hosted-state-live.test.ts`
runs a real PostgreSQL 16 server with independent database pools, a
remote state HTTP API and a separate OS worker. It tests explicit policy
denial, forged node/session rejection, exclusive concurrent lease claims,
authorized child execution and PostgreSQL observation replay. Earlier
regression tests continue checking safe receipt retries and corrupted
privileged history.

**Outstanding production boundaries:** the state control journal is
globally serialized rather than sharded; the queue is *at-most-once
claimed*, with no lost-worker lease recovery or fencing tokens. Node
registration is not a fully renewable fleet enrollment protocol.
The lease record and observation receipt live in separate SQL
namespaces/transactions, so their correlation is checked but their
writes are not one atomic commit. The policy callback has no built-in
AgentPrincipal capability issuance or revocation mechanism.
The source of independent effect verification and reconciliation has not
yet been implemented. TLS proxy, credential rotation, multi-host
deployment/HA and human QA are not production-validated. These must be
closed before ticket WYG-019 can be accepted.
