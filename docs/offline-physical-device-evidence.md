# Offline physical-device evidence gate (draft)

This is a **receipt and evidence-bundle validator**, not a device test, certification, model-quality claim, or proof of zero network traffic. It must never turn a NOT RUN/BLOCKED result into PASS without authentic physical measurements and independent review.

From a fresh checkout, with Node.js 24+:

~~~sh
node tools/verify-offline-device-evidence.mjs evidence/device-receipt.json
~~~

The command exits nonzero for missing, malformed, ambiguous, unqualified, or unbound evidence. A structurally valid receipt still requires an independent reviewer to inspect raw traces, measurement methodology, operator coverage, model artifact hash, device identity, source rights, and the truth of the recorded measurements.

## Receipt v2 and evidence bundle

The validator requires the schema identifier woyengi.offline-device-evidence.v2. In addition to the model and ONNX export identity, a physical receipt binds:

- original checkpoint SHA256 and on-device preprocessing implementation SHA256;
- exact device build fingerprint, ABI, runtime name and version;
- all local input/state/output, preprocessing, embedding, inference and state-update boundaries;
- a declared latency sample count (at least 100), warmup count (at least 5), parity sample count and predeclared parity tolerance;
- latency, memory and energy measurement methods plus thermal and power conditions;
- physical restart/state replay, airplane-mode test, zero observed requests and no cloud fallback;
- nine raw evidence categories: source provenance, preprocessing, operator inventory, numerical parity, latency, memory, energy, airplane-mode/network trace, and restart/replay.

Every evidence entry contains a relative POSIX path and SHA256. The validator reads each referenced file, rejects symlinks, absolute paths and parent traversal, limits each file to 16 MiB and the complete evidence set to 64 MiB, and checks the bytes against the declared hash. Evidence paths are resolved relative to the receipt file. These checks bind local bytes; they do **not** prove publisher authenticity, legal rights, reviewer independence, or that the measurements were honestly produced.

## Input hardening

The receipt itself is read only from a regular file and capped at **1 MiB** before parsing. UTF-8 decoding is strict. A bounded JSON grammar scan rejects duplicate keys at every object depth (including keys that become identical after JSON escape decoding), nesting deeper than 64 levels, and more than 200,000 JSON values. Nonfinite numbers, unknown receipt fields, duplicate evidence kinds/paths, missing evidence categories and hash mismatches fail closed.

The parser and bundle limits are software safeguards, not device-qualification results. A structurally valid synthetic fixture remains synthetic. The test suite uses constructed files solely to test the validator.

UTC timestamps are checked for calendar validity and limited to millisecond precision. JavaScript's Date.parse can normalize impossible dates such as February 30; the validator round-trips the complete accepted timestamp and rejects normalized date/time values.

Example receipt template (intentionally **fails** until physical evidence exists):

~~~json
{
  "schema": "woyengi.offline-device-evidence.v2",
  "model_id": "NOT RUN",
  "model_sha256": "NOT RUN",
  "checkpoint_sha256": "NOT RUN",
  "preprocessing_sha256": "NOT RUN",
  "device_model": "Samsung Galaxy A07 SM-A075F",
  "device_os": "Android",
  "device_os_version": "16",
  "device_build_fingerprint": "NOT RUN",
  "abi": "NOT RUN",
  "runtime": "NOT RUN",
  "runtime_version": "NOT RUN",
  "export_format": "NOT RUN",
  "operator_compatibility": "NOT RUN",
  "local_input_boundary": "device",
  "local_state_boundary": "device",
  "local_output_boundary": "device",
  "preprocessing_location": "device",
  "embedding_location": "device",
  "inference_location": "device",
  "state_update_location": "device",
  "speech_location": "not_applicable",
  "parity_reference": "NOT RUN",
  "test_operator": "NOT RUN",
  "tested_at_utc": "NOT RUN",
  "measurements": {
    "latency_p50_ms": null,
    "latency_p95_ms": null,
    "peak_ram_mb": null,
    "energy_mj_per_inference": null,
    "numerical_parity_max_abs_error": null
  },
  "measurement_method": {
    "latency_sample_count": 0,
    "latency_warmup_count": 0,
    "parity_sample_count": 0,
    "parity_tolerance": null,
    "latency_method": "NOT RUN",
    "ram_method": "NOT RUN",
    "energy_method": "NOT RUN",
    "thermal_state": "NOT RUN",
    "power_state": "NOT RUN"
  },
  "physical_device_tested": false,
  "airplane_mode_tested": false,
  "network_requests_observed": null,
  "cloud_fallback_observed": null,
  "physical_restart_replay": false,
  "evidence_files": [],
  "raw_evidence_path": "NOT RUN"
}
~~~

For actual qualification, capture a model and export hash, complete supported/unsupported operator inventory, numerical comparison against a pinned reference, real physical p50/p95 under stated thermal and power conditions, peak RAM and energy measurement methodology, restart/state replay, airplane-mode network traces, and proof that **all** preprocessing, embeddings, inference, state updates and optional speech remain on-device. No network fallback is permitted. Store raw traces in an independently inspectable, rights-cleared evidence bundle. A populated receipt is only a claim until reviewed.

Related development interfaces: Woyengi draft PRs #59 (typed offline SDK), #62 (constructed quickstart), #64 (ME111 source bridge), #69 (frozen-model host replay); Veritas PR #480 (numeric evidence validation). These are separate gates; do not imply model scientific qualification or deployment approval.
