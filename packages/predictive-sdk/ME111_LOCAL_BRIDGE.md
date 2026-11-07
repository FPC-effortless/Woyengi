# ME111 frozen ONNX → Woyengi offline source bridge (REVIEW ONLY)

This addon connects an **authorization-checked, historical Woyengi source projection**
to the **actual pinned neural contract** documented in
[TAC-OSM Android PR #544](https://github.com/FPC-effortless/TAC-OSM/pull/544).
It does not ship an Android APK, implement an ONNX session, import source data,
sign a model, change the TAC architecture, or run on a real phone.

## Previously misclassified blocker — corrected evidence

An original trained model **already exists** under the TAC repository's frozen
source branch. It should not be described as "missing":

| Source-controlled engineering evidence | Identity / status |
| --- | --- |
| ME111 frozen original seed111001 learned parameters | **104,663** |
| Original PyTorch checkpoint SHA256 | `337b882e9a10631dc85700846ef2b15ca8908699499668186ad3a248dc108449` |
| ONNX opset 18 model SHA256 | `dd65519a9e4f3388966538af53119b56e9292b46a9209d63ad4927b87f0a176b` |
| Original source/exporter commit | `3fc2fbe8e4974491349caecd8d6171e738810b54` |
| Pinned Android interoperability source | `eda076507f5762fa4413848cd3f0fd87a55c3681` |
| Host ONNX/PyTorch 512 constructed streaming step comparison | **PASS in TAC PR #544 CI**; the host example below checks two steps |
| Android emulator native ONNX/state test | **PASS in TAC PR #544 CI**; emulator is not a physical phone |
| Original ME111 real-source scientific joint forecast gate | **FAIL/MIXED**; PM2.5/NO2 coverage gates failed |
| Original customer Galaxy A07 (SM-A075F, Android 16) native execution | **NOT RUN/BLOCKED** |
| First physical target named in historical TAC prototype | Samsung A15 4G; **different device** from current company A07 target |

Original model bytes and training checkpoint remain in TAC-OSM. The model
artifact itself is not imported or copied into this Woyengi review branch.
An immutable upstream source checkout in the targeted CI validates this
adapter's frozen Java/ONNX **interface** dimensions and model SHA constants;
that test neither runs a model nor qualifies hardware, science, source rights,
energy, network isolation or numerical parity on Samsung A07.

## What the bridge now enforces

`predictMe111AuthorizedLocal(host, request, port)`:

1. Requires exact frozen checkpoint and ONNX fingerprints, a trusted port
   **declared** `DEVICE_LOCAL` and `remoteFallback: false`, before reading
   source data. A declaration is **not proof** of network isolation.
2. Checks Woyengi's existing actual `RECONSTRUCT`, `READ`, `EXPORT`
   capabilities, temporal as-of and availability rules. Full opposing source
   claims cause abstention **without native inference**.
3. Accepts exactly one eligible source record and six explicit features:
   `owner`, `hour`, `values`, `observed`, `ages`, `clock`. Owner
   must be in 0–11, hour 0–20M, 13 original normalized floats/masks/ages,
   six clocks. Invalid values, shapes, missing mask zeros and extra/future
   features fail closed; no missing observations or timestamps are fabricated.
4. Requires six finite `logLocation` predictions and six **strictly
   positive** `leftScale`/`rightScale` fields from the trusted synchronous
   device port. Results are in `STANDARDIZED_LOG1P_POLLUTANT` units;
   never silently convert them into real pollutant units or calibrated risks.
5. Returns frozen typed advisory outputs with
   `sourceQualification: STRUCTURAL_EXPORT_ONLY`,
   `scientificQualification: FAILED_MIXED_ME111`,
   `deviceQualification: NOT_RUN` and `actionAuthority: NOT_GRANTED`.

**Important preprocessor limitation:** `Me111SourceFeatures.java` requires
**source-faithful FIT-only statistics and complete contiguous hourly original
PRSA source history from 2013-03-01** for exact age parity. The Woyengi
adapter only checks the *shape and range* of the preprocessed event; it does
**not** prove the original publisher, archival completeness, source owner,
site mapping, timezone, FIT statistics or reconstruction history. The
host-supplied `featureProjection` therefore requires separate signed,
source-specific verification before any real use. Do not feed a short
history, fabricated zeros or generic telemetry as a real PRSA event.

The Java ME111 local engine maintains its own app-private 8×8 associative
state and count in the TAC prototype. The Woyengi bridge **does not** itself
persist that state, enforce device network isolation or manage native ABI.
It must not be called a complete device integration.

## Reproducible constructed/software checks

Node.js 24.12+ from a checkout:

```sh
node --test packages/predictive-sdk/test/me111-bridge.test.ts
node --test packages/predictive-sdk/test/local.test.ts
pnpm typecheck
pnpm boundaries
pnpm test:all
```

GitHub Actions additionally check out frozen TAC commit
`eda076507f5762fa4413848cd3f0fd87a55c3681` with no runtime credentials
and run `me111-upstream-contract.test.ts` against the original Java source.
No training, real publisher data, model-weight download at inference time,
protected TEST, real Android hardware, merge or release is involved.

## Remaining actual Android qualification (issue #60)

- **Named hardware:** Samsung Galaxy A07 SM-A075F, Android 16. Confirm
  actual build/SoC/ABI; the TAC A15 historical reference does not qualify A07.
- **Local boundary:** authorized original device observations → original FIT
  preprocessing/embedding as applicable → pinned ONNX operators → private
  memory/count and restart replay → six typed uncalibrated forecasts/scales.
  **No** cloud embeddings, speech, model calls, state sync or fallback.
- **Required physical evidence:** installation/APK and embedded model hash,
  ONNX native operator inventory, checkpoint numerical parity on the real
  device, p50/p95 warm+cold latency, peak RAM/PSS, independently measured
  energy/uncertainty, airplane-mode+network capture, app restart, source
  rights, independent Veritas qualification and review.
- **Status:** all physical measurements **NOT RUN/BLOCKED**. Absence of
  Android `INTERNET` permission and host/emulator parity do not satisfy the
  independent radio/power/device tests.
- **Research suitability:** ME111 original multi-seed real-data scientific
  gate is **FAILED/MIXED**; an Android successful demo alone cannot justify
  a pilot or medical/safety consequential use.

Commercial path remains open research models, **fully offline** local
SDKs and paid integration/optimization, deployment support and evidence
tools—not hosted inference. No customer or commercial suitability claim
follows from these constructed checks.

## Trained-model developer replay on a host

This review-only example runs the real authorization checks, frozen ONNX graph and
local CPU inference on a developer machine. It compares two constructed events
with the frozen PyTorch reference, including the recurrent tensors and count. The
second runtime process reads the state serialized by the first. The example also
checks source denial, conflict abstention, disabled remote fallback, and unchanged
canonical history during prediction.

Use Node.js 24.12+ and Python 3.12. Save the original
`TAC-OSM-ME111-Android16-ARM64-offline-debug.apk` locally. The example only reads the
APK's model and constructed reference vector assets and verifies their SHA-256
digests before running. It never installs the APK. The known APK SHA-256 is
`f17a9f9a5752c32ffe8da407b27754793925a87bddb7b51a8bae56d64fb1f318`.
See the [TAC-OSM APK build and installer evidence](https://github.com/FPC-effortless/TAC-OSM/actions/runs/40802404972).

From the Woyengi checkout, set `APK` to the local absolute APK path and run the
following commands. The clone, APK download and wheel installation are setup
steps. With those bytes present, prediction can run offline.

```sh
python3 -m venv .venv-me111
.venv-me111/bin/python -m pip install 'numpy==2.5.4' 'onnxruntime==1.23.2'
node packages/predictive-sdk/examples/me111_host_quickstart.ts "$APK" .venv-me111/bin/python > receipt.json
node packages/predictive-sdk/examples/me111_host_quickstart.ts "$APK" .venv-me111/bin/python > replay.json
cmp receipt.json replay.json
```

Inspect the two `FORECAST` outcomes, `maxAbsError` per step, and
`PASSED_ACROSS_TWO_LOCAL_RUNTIME_PROCESSES` in the receipt. Each of the three
forecast tensors and each floating-point state tensor must match the pinned
reference within `atol=2e-5, rtol=2e-5`. Count and hour must match exactly.
The example only exercises constructed data, and the receipt records
`physicalDeviceQualification: NOT_RUN`. Independent developer acceptance,
authorized real-source preprocessing, physical Android and customer use remain
separate gates under [issue #60](https://github.com/FPC-effortless/Woyengi/issues/60).
