import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const script = new URL('./verify-offline-device-evidence.mjs', import.meta.url);
function checkRaw(raw) {
  const dir = mkdtempSync(join(tmpdir(), 'offline-receipt-'));
  try {
    const path = join(dir, 'receipt.json');
    writeFileSync(path, raw);
    return spawnSync(process.execPath, [script.pathname, path], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function check(value) { return checkRaw(JSON.stringify(value)); }
const valid = {
  model_id: 'synthetic-example', model_sha256: 'a'.repeat(64),
  device_model: 'synthetic-example', device_os: 'Android', device_os_version: '16',
  runtime: 'synthetic-example', export_format: 'synthetic-example', operator_compatibility: 'synthetic-example',
  local_input_boundary: 'device', local_state_boundary: 'device', local_output_boundary: 'device',
  preprocessing_location: 'device', embedding_location: 'device', inference_location: 'device',
  state_update_location: 'device', speech_location: 'not_applicable',
  parity_reference: 'synthetic-example', test_operator: 'synthetic-example', tested_at_utc: '2026-11-03T00:00:00Z',
  measurements: { latency_p50_ms: 1, latency_p95_ms: 2, peak_ram_mb: 3,
    energy_mj_per_inference: 4, numerical_parity_max_abs_error: 0 },
  physical_device_tested: true, airplane_mode_tested: true,
  network_requests_observed: 0, cloud_fallback_observed: false, raw_evidence_path: 'synthetic-example'
};
test('complete synthetic fixture passes schema only', () => assert.equal(check(valid).status, 0));
test('missing physical evidence fails closed', () => assert.notEqual(check({ ...valid, physical_device_tested: false }).status, 0));
test('network activity fails closed', () => assert.notEqual(check({ ...valid, network_requests_observed: 1 }).status, 0));
test('remote preprocessing fails closed', () => assert.notEqual(check({ ...valid, preprocessing_location: 'cloud' }).status, 0));
test('unmeasured energy fails closed', () => assert.notEqual(check({ ...valid, measurements: { ...valid.measurements, energy_mj_per_inference: null } }).status, 0));
test('p95 below p50 fails closed', () => assert.notEqual(check({ ...valid, measurements: { ...valid.measurements, latency_p95_ms: 0.5 } }).status, 0));
test('placeholder operator compatibility fails closed', () => assert.notEqual(check({ ...valid, operator_compatibility: 'NOT RUN' }).status, 0));
test('remote output boundary fails closed', () => assert.notEqual(check({ ...valid, local_output_boundary: 'cloud' }).status, 0));
test('placeholder evidence path fails closed', () => assert.notEqual(check({ ...valid, raw_evidence_path: 'TBD' }).status, 0));
for (const field of ['latency_p50_ms','latency_p95_ms','peak_ram_mb','energy_mj_per_inference']) {
  test('zero ' + field + ' cannot qualify physical evidence', () =>
    assert.notEqual(check({ ...valid, measurements: { ...valid.measurements, [field]: 0 } }).status, 0));
}
test('future physical test timestamp fails closed', () =>
  assert.notEqual(check({ ...valid, tested_at_utc: '2999-01-01T00:00:00Z' }).status, 0));
test('timestamp without seconds fails closed', () =>
  assert.notEqual(check({ ...valid, tested_at_utc: '2026-11-03T00:00Z' }).status, 0));
test('impossible calendar date fails closed instead of Date.parse normalization', () =>
  assert.notEqual(check({ ...valid, tested_at_utc: '2026-02-30T00:00:00Z' }).status, 0));
test('non-leap-year February 29 fails closed', () =>
  assert.notEqual(check({ ...valid, tested_at_utc: '2025-02-29T00:00:00Z' }).status, 0));
test('valid leap-day timestamp remains accepted', () =>
  assert.equal(check({ ...valid, tested_at_utc: '2024-02-29T12:34:56Z' }).status, 0));
test('duplicate top-level JSON keys fail closed instead of taking the last value', () => {
  const raw = JSON.stringify(valid).replace(
    '"network_requests_observed":0',
    '"network_requests_observed":1,"network_requests_observed":0',
  );
  const result = checkRaw(raw);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate object key/);
});
test('duplicate nested measurement keys fail closed', () => {
  const raw = JSON.stringify(valid).replace(
    '"latency_p50_ms":1',
    '"latency_p50_ms":999,"latency_p50_ms":1',
  );
  const result = checkRaw(raw);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate object key/);
});
test('oversized receipts are rejected before JSON parsing', () => {
  const result = checkRaw(' '.repeat(1024 * 1024 + 1));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /1 MiB limit/);
});
test('excessively nested JSON is rejected with a bounded diagnostic', () => {
  const raw = '{"x":'.repeat(65) + '0' + '}'.repeat(65);
  const result = checkRaw(raw);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /nesting exceeds 64/);
});
test('escape-equivalent duplicate keys fail closed', () => {
  const raw = JSON.stringify(valid).replace(
    '"network_requests_observed":0',
    '"network_requests_observed":1,"network_\\u0072equests_observed":0',
  );
  const result = checkRaw(raw);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate object key/);
});
test('invalid UTF-8 receipt bytes fail closed', () => {
  const result = checkRaw(Buffer.from([0xff, 0x7b, 0x7d]));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unreadable, oversized or ambiguous JSON receipt/);
});
