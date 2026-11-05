# Offline physical-device evidence gate (draft)

This is a **receipt schema validator**, not a device test, certification, model-quality claim, or evidence of zero network traffic. It must never turn a NOT RUN/BLOCKED result into PASS without authentic physical measurements and independent review.

From a fresh checkout, with Node.js 24+:

```sh
node tools/verify-offline-device-evidence.mjs evidence/device-receipt.json
```

The command exits nonzero for missing, malformed or unqualified receipts. A structurally valid receipt still requires an independent reviewer to inspect raw traces, measurement methodology, operator coverage, model artifact hash, and device identity.

Example receipt template (intentionally **fails** until physical evidence exists):

```json
{
  "model_id": "NOT RUN",
  "model_sha256": "NOT RUN",
  "device_model": "Samsung Galaxy A07 SM-A075F",
  "device_os": "Android",
  "device_os_version": "16",
  "runtime": "NOT RUN",
  "export_format": "NOT RUN",
  "operator_compatibility": "NOT RUN",
  "local_input_boundary": "NOT RUN",
  "local_state_boundary": "NOT RUN",
  "local_output_boundary": "NOT RUN",
  "preprocessing_location": "NOT RUN",
  "embedding_location": "NOT RUN",
  "inference_location": "NOT RUN",
  "state_update_location": "NOT RUN",
  "speech_location": "NOT RUN",
  "parity_reference": "NOT RUN",
  "test_operator": "NOT RUN",
  "tested_at_utc": "NOT RUN",
  "physical_device_tested": false,
  "airplane_mode_tested": false,
  "network_requests_observed": null,
  "cloud_fallback_observed": null,
  "measurements": {
    "latency_p50_ms": null,
    "latency_p95_ms": null,
    "peak_ram_mb": null,
    "energy_mj_per_inference": null,
    "numerical_parity_max_abs_error": null
  },
  "raw_evidence_path": "NOT RUN"
}
```

For actual qualification, capture a model and export hash, complete supported/unsupported operator inventory, numerical comparison against a pinned reference, real physical p50/p95 under stated thermal and power conditions, peak RAM and energy measurement methodology, restart/state replay, airplane-mode network traces, and proof that **all** preprocessing, embeddings, inference, state updates and optional speech remain on-device. No network fallback is permitted. Store raw traces in an independently inspectable, rights-cleared evidence bundle. A populated receipt is only a claim until reviewed.

Related development interfaces: Woyengi draft PRs #59 (typed offline SDK), #62 (constructed quickstart), #64 (ME111 source bridge); Veritas draft PR #480 (numeric evidence validation). These are separate gates; do not imply model scientific qualification or deployment approval.
