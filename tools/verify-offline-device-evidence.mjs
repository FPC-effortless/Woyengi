#!/usr/bin/env node
// Dependency-free, fail-closed validation of physical-device offline evidence.
// Usage: node tools/verify-offline-device-evidence.mjs path/to/receipt.json
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path || process.argv.length !== 3) {
  console.error('Usage: node tools/verify-offline-device-evidence.mjs RECEIPT.json');
  process.exit(2);
}
let receipt;
try { receipt = JSON.parse(readFileSync(path, 'utf8')); }
catch (error) { console.error('INVALID: unreadable JSON receipt:', error.message); process.exit(1); }

const errors = [];
const own = (o, k) => Object.hasOwn(o, k);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const placeholder = x => typeof x === 'string' && /^(?:not[ _-]?run|blocked|todo|tbd|unknown|fixture-only|placeholder|n\/a)$/i.test(x.trim());
const finitePositive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
if (!object(receipt)) errors.push('root must be an object');
else {
  for (const field of ['model_id','model_sha256','device_model','device_os','device_os_version',
    'runtime','export_format','operator_compatibility','local_input_boundary',
    'local_state_boundary','local_output_boundary','preprocessing_location',
    'embedding_location','inference_location','state_update_location',
    'speech_location','parity_reference','test_operator','tested_at_utc']) {
    if (!own(receipt, field) || !nonempty(receipt[field]) || placeholder(receipt[field])) errors.push(field + ': required non-placeholder string');
  }
  if (!/^[a-f0-9]{64}$/i.test(receipt.model_sha256 ?? '')) errors.push('model_sha256: expected 64 hex characters');
  if (nonempty(receipt.tested_at_utc)) {
    const testedAt = Date.parse(receipt.tested_at_utc);
    if (Number.isNaN(testedAt) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(receipt.tested_at_utc)) errors.push('tested_at_utc: expected ISO UTC timestamp');
    else if (testedAt > Date.now() + 5 * 60 * 1000) errors.push('tested_at_utc: cannot be in the future');
  }
  for (const field of ['local_input_boundary','local_state_boundary','local_output_boundary','preprocessing_location','embedding_location','inference_location','state_update_location']) {
    if (receipt[field] !== 'device') errors.push(field + ': must equal device');
  }
  if (!['device','not_applicable'].includes(receipt.speech_location)) errors.push('speech_location: device or not_applicable required');
  if (!object(receipt.measurements)) errors.push('measurements: required object');
  else for (const field of ['latency_p50_ms','latency_p95_ms','peak_ram_mb','energy_mj_per_inference','numerical_parity_max_abs_error']) {
    const value = receipt.measurements[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) errors.push('measurements.' + field + ': finite nonnegative number required');
  }
  if (object(receipt.measurements)) for (const field of ['latency_p50_ms','latency_p95_ms','peak_ram_mb','energy_mj_per_inference']) {
    if (!finitePositive(receipt.measurements[field])) errors.push('measurements.' + field + ': positive physical measurement required');
  }
  if (object(receipt.measurements) && finitePositive(receipt.measurements.latency_p50_ms) &&
      receipt.measurements.latency_p95_ms < receipt.measurements.latency_p50_ms) errors.push('p95 must be >= p50');
  if (receipt.physical_device_tested !== true) errors.push('physical_device_tested must be true');
  if (receipt.airplane_mode_tested !== true) errors.push('airplane_mode_tested must be true');
  if (receipt.network_requests_observed !== 0) errors.push('network_requests_observed must be zero');
  if (receipt.cloud_fallback_observed !== false) errors.push('cloud_fallback_observed must be false');
  if (!nonempty(receipt.raw_evidence_path) || placeholder(receipt.raw_evidence_path)) errors.push('raw_evidence_path: non-placeholder path required');
}
if (errors.length) {
  console.error('INVALID physical-device receipt:\n' + errors.map(x => '- ' + x).join('\n'));
  process.exit(1);
}
console.log('STRUCTURALLY VALID physical-device receipt; independent evidence review still required.');
