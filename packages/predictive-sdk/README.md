# Woyengi local predictive advisory SDK — isolated review candidate

This is an additive **typed boundary**, not an Android/iOS inference engine or
a production SDK. It is stacked on Woyengi predictive-export draft #57 → #56.
Unmodified platform kernel, state, permissions and PRD govern all behavior.
Source authority remains with Woyengi; statistical predictions are never actions.

## Local source → typed prediction flow

`predictAuthorizedLocal(host, request, runtime)` does the following in order:

1. Refuses runtime declarations other than `DEVICE_LOCAL` and
   `remoteFallback: false` before reading any source.
2. Refuses an external Woyengi source destination; calls the real
   authorization-checked bitemporal `exportPredictiveState`.
3. Returns a `SOURCE_CONFLICT` advisory abstention, without running the model,
   whenever the authorized source includes competing claims.
4. Otherwise calls a **synchronous, in-process** runtime port and validates an
   exact, finite typed `FORECAST` (value, horizon, uncertainty score) or
   explicit `ABSTAIN` reason.
5. Returns a detached advisory result with `NOT_GRANTED` action authority,
   `STRUCTURAL_EXPORT_ONLY` source qualification, `NOT_QUALIFIED` science
   status and `UNCALIBRATED` uncertainty. No canonical write or effect.

**Input integrity hardening (review candidate):** before calling a pluggable local runtime, the SDK recursively freezes the detached export, including nested feature arrays and objects. This prevents a runtime from silently changing feature values after the source exporter computed `featureHash`. The new constructed regression test attempts nested mutations. This does **not** authenticate the original source, prevent a malicious runtime from opening sockets, or qualify physical offline operation.

**Security limitation:** `execution: DEVICE_LOCAL` is a *host assertion* and
is not proof that an arbitrary runtime implementation does not open sockets
or use cloud embeddings. The TypeScript surface alone cannot enforce network
isolation or on-device operators. Only a separately reviewed in-process
runtime with physical airplane-mode measurement, network tracing and state
persistence testing can qualify an actual customer product.

**Local input/state/output boundary (intended):** on-device authorized
observations → local feature projection → local preprocessing and embeddings
→ local TAC operators and persistent state → local typed forecast/uncertainty/
abstention. Optional speech stays local. The current adapter does not implement
ONNX loading, learned inference, state serialization or speech.

## Constructed contract verification

Node 24.12+ is required:

```bash
node --test packages/predictive-sdk/test/local.test.ts
pnpm typecheck
pnpm boundaries
pnpm test:all
```

The tests use constructed Woyengi `ClaimLedger`, `CapabilityEngine` and a
fake synchronous arithmetic rule, **not** an actual trained TAC checkpoint.
They cover unauthorized source access, remote destination and fallback
rejection, conflict abstention, malformed/unsafe model output, uncalibrated
forecast and unchanged canonical history. No network/offline physical test
is claimed by these constructed checks.

## Device and release acceptance gates

| Gate | Status |
| --- | --- |
| First actual target: Samsung Galaxy A07 SM-A075F, Android 16 | TARGET ONLY |
| Android library/API integration, real model export and operator coverage | NOT RUN |
| Numerical parity with original source checkpoint | NOT RUN |
| State serialization, restart and replay on device | NOT RUN |
| Physical device p50/p95 decode latency, peak RAM, energy | NOT RUN |
| Airplane-mode inference and network/socket tracing | NOT RUN |
| iOS iPhone 13 and Raspberry Pi 5 8GB | NOT RUN |
| Publisher permission, authentic outcomes and Veritas qualification | BLOCKED |
| Independent security/architecture review and Woyengi ticket | PENDING |

Do not merge or ship this extension without ticket approval, exact-head CI
and independent review. Preserve draft #56/#57, original research checkpoints
and historical tests. This SDK concerns typed output and authority boundaries;
TAC-OSM+PNDS model architecture research remains a separate agent's work.

Commercial positioning: **open local models and SDKs**, paid device integration,
optimization, deployment/evidence verification and support. Never hosted
per-inference customer services or hidden remote fallback.


## Fresh-checkout SDK smoke demo (constructed, no install)

With Node.js **24.12+** already installed, from the repository root:

```bash
node packages/predictive-sdk/examples/constructed_quickstart.ts
node --test packages/predictive-sdk/test/quickstart.test.ts
```

These two commands require no package installation, provider account, model download,
API key, or cloud service. The first prints a deterministic JSON report; the
second executes the same demo twice in fresh Node subprocesses and checks its
output. CI also runs the source-export and SDK contract suites.

The demo exercises **real Woyengi software contracts** using **constructed
claims**, explicit capability grants, a fixed bitemporal cutoff, and a fake
synchronous arithmetic rule. It demonstrates a typed forecast, a conflict-driven
abstention **without executing the rule**, a denied unauthorized principal,
a rejected remote fallback **before source access**, and unchanged canonical
history. The printed `NODE_HOST_CONTRACT_ONLY` and `NOT_QUALIFIED` statuses
are deliberate. It is not a trained model, a real-source rights audit, an
independent Veritas qualification, or a physical airplane-mode test. Running
Node locally does **not** prove that arbitrary plugins cannot access a network.

**Acceptance evidence still missing:** physical Samsung Galaxy A07
(SM-A075F, Android 16) APK/operator and original-checkpoint identity, local
preprocessing/embeddings/inference/state/output/speech boundaries, export
operator support, numerical parity, p50/p95 latency, peak RAM, energy,
network/socket tracing in airplane mode, restart/replay, publisher permissions,
and independent review. All physical metrics remain **NOT RUN/BLOCKED**.
See issue #60. Do not use the constructed demo as a customer qualification.
