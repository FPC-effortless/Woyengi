import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('./verify-offline-device-evidence.mjs', import.meta.url);
const kinds = [
  'source_provenance', 'preprocessing', 'operator_inventory', 'numerical_parity',
  'latency', 'memory', 'energy', 'airplane_mode_network', 'restart_replay',
];
const bytesFor = kind => Buffer.from('constructed:' + kind);
const sha = value => createHash('sha256').update(value).digest('hex');
const valid = {
  schema: 'woyengi.offline-device-evidence.v2',
  model_id: 'synthetic-example',
  model_sha256: 'a'.repeat(64),
  checkpoint_sha256: 'b'.repeat(64),
  preprocessing_sha256: 'c'.repeat(64),
  device_model: 'synthetic-example',
  device_os: 'Android',
  device_os_version: '16',
  device_build_fingerprint: 'synthetic-build-fingerprint',
  abi: 'arm64-v8a',
  runtime: 'ONNX Runtime CPU',
  runtime_version: '1.23.2',
  export_format: 'ONNX opset 18',
  operator_compatibility: 'ALL_REQUIRED_OPERATORS_SUPPORTED',
  local_input_boundary: 'device',
  local_state_boundary: 'device',
  local_output_boundary: 'device',
  preprocessing_location: 'device',
  embedding_location: 'device',
  inference_location: 'device',
  state_update_location: 'device',
  speech_location: 'not_applicable',
  parity_reference: 'synthetic reference',
  test_operator: 'synthetic operator',
  tested_at_utc: '2026-11-03T00:00:00Z',
  measurements: {
    latency_p50_ms: 1,
    latency_p95_ms: 2,
    peak_ram_mb: 3,
    energy_mj_per_inference: 4,
    numerical_parity_max_abs_error: 0,
  },
  measurement_method: {
    latency_sample_count: 100,
    latency_warmup_count: 5,
    parity_sample_count: 256,
    parity_tolerance: 0.0001,
    latency_method: 'monotonic clock; 100 measured samples after warmup',
    ram_method: 'process PSS plus native allocations',
    energy_method: 'external power monitor with baseline subtraction',
    thermal_state: 'steady',
    power_state: 'battery',
  },
  physical_device_tested: true,
  airplane_mode_tested: true,
  network_requests_observed: 0,
  cloud_fallback_observed: false,
  physical_restart_replay: true,
  evidence_files: kinds.map(kind => ({
    kind,
    path: 'evidence/' + kind + '.json',
    sha256: sha(bytesFor(kind)),
  })),
  raw_evidence_path: 'evidence/',
};

function checkRaw(raw) {
  const dir = mkdtempSync(join(tmpdir(), 'offline-receipt-'));
  try {
    const path = join(dir, 'receipt.json');
    writeFileSync(path, raw);
    return spawnSync(process.execPath, [script.pathname, path], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function check(value, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'offline-receipt-'));
  try {
    for (const entry of value.evidence_files ?? []) {
      if (typeof entry.path !== 'string') continue;
      const target = resolve(dir, entry.path);
      const fromRoot = relative(dir, target);
      if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) continue;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, options.files?.[entry.kind] ?? bytesFor(entry.kind));
    }
    if (options.symlinkKind) {
      const entry = value.evidence_files.find(item => item.kind === options.symlinkKind);
      const target = resolve(dir, entry.path);
      const outside = join(dir, 'outside-evidence.json');
      writeFileSync(outside, bytesFor(entry.kind));
      unlinkSync(target);
      symlinkSync(outside, target);
    }
    const path = join(dir, 'receipt.json');
    writeFileSync(path, JSON.stringify(value));
    return spawnSync(process.execPath, [script.pathname, path], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('complete synthetic receipt and all nine evidence hashes pass schema only', () => {
  const result = check(valid);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /evidence file hashes verified/);
});
test('missing physical evidence fails closed', () =>
  assert.notEqual(check({ ...valid, physical_device_tested: false }).status, 0));
test('network activity fails closed', () =>
  assert.notEqual(check({ ...valid, network_requests_observed: 1 }).status, 0));
test('remote preprocessing fails closed', () =>
  assert.notEqual(check({ ...valid, preprocessing_location: 'cloud' }).status, 0));
test('unmeasured energy fails closed', () =>
  assert.notEqual(check({ ...valid, measurements: { ...valid.measurements, energy_mj_per_inference: null } }).status, 0));
test('p95 below p50 fails closed', () =>
  assert.notEqual(check({ ...valid, measurements: { ...valid.measurements, latency_p95_ms: 0.5 } }).status, 0));
test('placeholder operator compatibility fails closed', () =>
  assert.notEqual(check({ ...valid, operator_compatibility: 'NOT RUN' }).status, 0));
test('remote output boundary fails closed', () =>
  assert.notEqual(check({ ...valid, local_output_boundary: 'cloud' }).status, 0));
test('placeholder evidence path fails closed', () =>
  assert.notEqual(check({ ...valid, raw_evidence_path: 'TBD' }).status, 0));
for (const field of ['latency_p50_ms', 'latency_p95_ms', 'peak_ram_mb', 'energy_mj_per_inference']) {
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
  assert.match(result.stderr, /byte limit/);
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
test('checkpoint and preprocessing identities are mandatory SHA256 values', () => {
  for (const field of ['checkpoint_sha256', 'preprocessing_sha256']) {
    assert.notEqual(check({ ...valid, [field]: 'NOT RUN' }).status, 0);
  }
});
test('runtime version, ABI and device build identity are mandatory', () => {
  for (const field of ['runtime_version', 'abi', 'device_build_fingerprint']) {
    assert.notEqual(check({ ...valid, [field]: 'NOT RUN' }).status, 0);
  }
});
test('missing evidence category fails closed', () => {
  const evidence_files = valid.evidence_files.filter(item => item.kind !== 'energy');
  const result = check({ ...valid, evidence_files });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing energy/);
});
test('duplicate evidence category fails closed', () => {
  const evidence_files = [...valid.evidence_files, { ...valid.evidence_files[0], path: 'evidence/duplicate.json' }];
  assert.notEqual(check({ ...valid, evidence_files }).status, 0);
});
test('duplicate evidence path fails closed', () => {
  const evidence_files = valid.evidence_files.map(item => ({ ...item }));
  evidence_files[1].path = evidence_files[0].path;
  assert.notEqual(check({ ...valid, evidence_files }).status, 0);
});
test('evidence path traversal fails closed', () => {
  const evidence_files = valid.evidence_files.map(item => ({ ...item }));
  evidence_files[0].path = '../outside.json';
  const result = check({ ...valid, evidence_files });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /relative POSIX path|path contains/);
});
test('evidence bytes must match their declared SHA256', () => {
  const result = check(valid, { files: { latency: Buffer.from('changed evidence') } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /latency: SHA256 mismatch/);
});
test('symbolic-link evidence is rejected', () => {
  const result = check(valid, { symlinkKind: 'airplane_mode_network' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic links are not allowed/);
});
test('evidence file size is bounded', () => {
  const result = check(valid, { files: { operator_inventory: Buffer.alloc(16 * 1024 * 1024 + 1) } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /evidence file exceeds byte limit/);
});
test('latency sample count must be at least 100', () =>
  assert.notEqual(check({ ...valid, measurement_method: { ...valid.measurement_method, latency_sample_count: 99 } }).status, 0));
test('latency warmup count must be at least five and below measured count', () =>
  assert.notEqual(check({ ...valid, measurement_method: { ...valid.measurement_method, latency_warmup_count: 100 } }).status, 0));
test('parity error above its predeclared tolerance fails closed', () =>
  assert.notEqual(check({ ...valid, measurements: { ...valid.measurements, numerical_parity_max_abs_error: 0.01 } }).status, 0));
test('physical restart replay is mandatory', () =>
  assert.notEqual(check({ ...valid, physical_restart_replay: false }).status, 0));
test('unrecognized receipt fields fail closed', () =>
  assert.notEqual(check({ ...valid, cloud_inference_fallback: false }).status, 0));
