import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const script = new URL('./verify-offline-device-evidence.mjs', import.meta.url);
function check(value) {
  const dir = mkdtempSync(join(tmpdir(), 'offline-receipt-'));
  try {
    const path = join(dir, 'receipt.json');
    writeFileSync(path, JSON.stringify(value));
    return spawnSync(process.execPath, [script.pathname, path], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
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
  test(`zero ${field} cannot qualify physical evidence`, () =>
    assert.notEqual(check({ ...valid, measurements: { ...valid.measurements, [field]: 0 } }).status, 0));
}
test('future physical test timestamp fails closed', () =>
  assert.notEqual(check({ ...valid, tested_at_utc: '2999-01-01T00:00:00Z' }).status, 0));
test('timestamp without seconds fails closed', () =>
  assert.notEqual(check({ ...valid, tested_at_utc: '2026-11-03T00:00Z' }).status, 0));
