#!/usr/bin/env node
// Dependency-free, fail-closed validation of physical-device offline evidence.
// Usage: node tools/verify-offline-device-evidence.mjs path/to/receipt.json
import { createHash } from 'node:crypto';
import {
  closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 200_000;
const MAX_EVIDENCE_FILE_BYTES = 16 * 1024 * 1024;
const MAX_EVIDENCE_TOTAL_BYTES = 64 * 1024 * 1024;
const REQUIRED_EVIDENCE_KINDS = [
  'source_provenance',
  'preprocessing',
  'operator_inventory',
  'numerical_parity',
  'latency',
  'memory',
  'energy',
  'airplane_mode_network',
  'restart_replay',
];
const path = process.argv[2];
if (!path || process.argv.length !== 3) {
  console.error('Usage: node tools/verify-offline-device-evidence.mjs RECEIPT.json');
  process.exit(2);
}

function readBoundedBytes(filePath, limit, label) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const fd = openSync(filePath, flags);
  try {
    const metadata = fstatSync(fd);
    if (!metadata.isFile()) throw new Error(label + ' must be a regular file');
    if (metadata.size > limit) throw new Error(label + ' exceeds byte limit');
    const buffer = Buffer.alloc(limit + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > limit) throw new Error(label + ' exceeds byte limit');
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function readBoundedUtf8(filePath) {
  return new TextDecoder('utf-8', { fatal: true })
    .decode(readBoundedBytes(filePath, MAX_RECEIPT_BYTES, 'receipt'));
}

// JSON.parse silently accepts duplicate object keys and keeps the last value.
// Scan the complete JSON grammar first so ambiguous receipts fail closed.
function assertUniqueJsonKeys(source) {
  let offset = 0;
  let nodes = 0;
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const fail = message => { throw new Error('invalid JSON: ' + message); };
  const whitespace = () => {
    while (offset < source.length && /[\u0020\u0009\u000a\u000d]/.test(source[offset])) offset += 1;
  };
  const string = () => {
    if (source[offset] !== '"') fail('string expected');
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      const character = source[offset];
      offset += 1;
      if (character === '"') {
        try { return JSON.parse(source.slice(start, offset)); }
        catch { fail('invalid string escape'); }
      }
      if (character === '\\') {
        if (offset >= source.length) fail('unterminated escape');
        offset += 1;
      } else if (code < 0x20) {
        fail('unescaped control character');
      }
    }
    fail('unterminated string');
  };
  const value = depth => {
    whitespace();
    if (depth > MAX_JSON_DEPTH) fail('nesting exceeds ' + MAX_JSON_DEPTH);
    nodes += 1;
    if (nodes > MAX_JSON_NODES) fail('node count exceeds ' + MAX_JSON_NODES);
    const character = source[offset];
    if (character === '"') { string(); return; }
    if (character === '{') {
      offset += 1;
      whitespace();
      if (source[offset] === '}') { offset += 1; return; }
      const keys = new Set();
      while (true) {
        whitespace();
        const key = string();
        if (keys.has(key)) fail('duplicate object key ' + JSON.stringify(key));
        keys.add(key);
        whitespace();
        if (source[offset] !== ':') fail('colon expected');
        offset += 1;
        value(depth + 1);
        whitespace();
        if (source[offset] === '}') { offset += 1; return; }
        if (source[offset] !== ',') fail('comma or object end expected');
        offset += 1;
      }
    }
    if (character === '[') {
      offset += 1;
      whitespace();
      if (source[offset] === ']') { offset += 1; return; }
      while (true) {
        value(depth + 1);
        whitespace();
        if (source[offset] === ']') { offset += 1; return; }
        if (source[offset] !== ',') fail('comma or array end expected');
        offset += 1;
      }
    }
    for (const literal of ['true', 'false', 'null']) {
      if (source.startsWith(literal, offset)) { offset += literal.length; return; }
    }
    numberPattern.lastIndex = offset;
    const match = numberPattern.exec(source);
    if (match) { offset = numberPattern.lastIndex; return; }
    fail('JSON value expected');
  };

  value(0);
  whitespace();
  if (offset !== source.length) fail('trailing content');
}

let receipt;
try {
  const source = readBoundedUtf8(path);
  assertUniqueJsonKeys(source);
  receipt = JSON.parse(source);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('INVALID: unreadable, oversized or ambiguous JSON receipt:', message);
  process.exit(1);
}

const errors = [];
const own = (o, k) => Object.hasOwn(o, k);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const placeholder = x => typeof x === 'string' &&
  /^(?:not[ _-]?run|blocked|todo|tbd|unknown|fixture-only|placeholder|n\/a)$/i.test(x.trim());
const finitePositive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const sha256 = x => typeof x === 'string' && /^[a-f0-9]{64}$/i.test(x);
const exactKeys = (value, keys) =>
  object(value) && Object.keys(value).length === keys.length && keys.every(key => own(value, key));

function assertFiniteJson(value, location = 'receipt') {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    errors.push(location + ': nonfinite JSON number');
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteJson(item, location + '[' + index + ']'));
  } else if (object(value)) {
    for (const [key, item] of Object.entries(value)) {
      assertFiniteJson(item, location + '.' + key);
    }
  }
}

function evidenceFilePath(receiptPath, value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\\') ||
      value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error('path must be a relative POSIX path');
  }
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('path contains an empty, dot or parent segment');
  }
  const root = resolve(dirname(receiptPath));
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink()) throw new Error('symbolic links are not allowed');
    if (index < segments.length - 1 && !metadata.isDirectory()) {
      throw new Error('evidence parent must be a directory');
    }
    if (index === segments.length - 1 && !metadata.isFile()) {
      throw new Error('evidence entry must be a regular file');
    }
  }
  const resolved = resolve(current);
  const fromRoot = relative(root, resolved);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('path escapes receipt directory');
  }
  return resolved;
}

function validateEvidenceFiles(receiptPath, entries) {
  if (!Array.isArray(entries)) {
    errors.push('evidence_files: exactly nine hashed evidence entries required');
    return;
  }
  if (entries.length !== REQUIRED_EVIDENCE_KINDS.length) {
    errors.push('evidence_files: exactly nine hashed evidence entries required');
  }
  const kinds = new Set();
  const paths = new Set();
  let totalBytes = 0;
  // The receipt is capped at 1 MiB, but bound work independently of its node budget.
  for (const entry of entries.slice(0, REQUIRED_EVIDENCE_KINDS.length)) {
    if (!exactKeys(entry, ['kind', 'path', 'sha256'])) {
      errors.push('evidence_files: each entry requires exactly kind, path and sha256');
      continue;
    }
    if (!REQUIRED_EVIDENCE_KINDS.includes(entry.kind)) {
      errors.push('evidence_files: unsupported evidence kind');
      continue;
    }
    if (kinds.has(entry.kind)) errors.push('evidence_files: duplicate kind ' + entry.kind);
    kinds.add(entry.kind);
    if (paths.has(entry.path)) errors.push('evidence_files: duplicate path ' + entry.path);
    paths.add(entry.path);
    if (!sha256(entry.sha256)) {
      errors.push('evidence_files.' + entry.kind + ': invalid SHA256');
      continue;
    }
    try {
      const filePath = evidenceFilePath(receiptPath, entry.path);
      const bytes = readBoundedBytes(filePath, MAX_EVIDENCE_FILE_BYTES, 'evidence file');
      totalBytes += bytes.length;
      if (totalBytes > MAX_EVIDENCE_TOTAL_BYTES) {
        errors.push('evidence_files: total evidence exceeds 64 MiB');
        break;
      }
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== entry.sha256) {
        errors.push('evidence_files.' + entry.kind + ': SHA256 mismatch');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push('evidence_files.' + entry.kind + ': ' + message);
    }
  }
  for (const kind of REQUIRED_EVIDENCE_KINDS) {
    if (!kinds.has(kind)) errors.push('evidence_files: missing ' + kind);
  }
}

if (!object(receipt)) errors.push('root must be an object');
else {
  const allowedFields = [
    'schema', 'model_id', 'model_sha256', 'checkpoint_sha256', 'preprocessing_sha256',
    'device_model', 'device_os', 'device_os_version', 'device_build_fingerprint', 'abi',
    'runtime', 'runtime_version', 'export_format', 'operator_compatibility',
    'local_input_boundary', 'local_state_boundary', 'local_output_boundary',
    'preprocessing_location', 'embedding_location', 'inference_location',
    'state_update_location', 'speech_location', 'parity_reference', 'test_operator',
    'tested_at_utc', 'measurements', 'measurement_method', 'physical_device_tested',
    'airplane_mode_tested', 'network_requests_observed', 'cloud_fallback_observed',
    'physical_restart_replay', 'evidence_files', 'raw_evidence_path',
  ];
  for (const field of Object.keys(receipt)) {
    if (!allowedFields.includes(field)) errors.push('unexpected receipt field: ' + field);
  }
  assertFiniteJson(receipt);
  if (receipt.schema !== 'woyengi.offline-device-evidence.v2') {
    errors.push('schema: expected woyengi.offline-device-evidence.v2');
  }
  for (const field of [
    'model_id', 'device_model', 'device_os', 'device_os_version',
    'device_build_fingerprint', 'abi', 'runtime', 'runtime_version',
    'export_format', 'operator_compatibility', 'local_input_boundary',
    'local_state_boundary', 'local_output_boundary', 'preprocessing_location',
    'embedding_location', 'inference_location', 'state_update_location',
    'parity_reference', 'test_operator', 'tested_at_utc',
  ]) {
    if (!own(receipt, field) || !nonempty(receipt[field]) || placeholder(receipt[field])) {
      errors.push(field + ': required non-placeholder string');
    }
  }
  for (const field of ['model_sha256', 'checkpoint_sha256', 'preprocessing_sha256']) {
    if (!sha256(receipt[field])) errors.push(field + ': expected 64 hex characters');
  }
  if (nonempty(receipt.tested_at_utc)) {
    const pattern = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,3}))?Z$/;
    const match = pattern.exec(receipt.tested_at_utc);
    const testedAt = Date.parse(receipt.tested_at_utc);
    if (!match || Number.isNaN(testedAt)) {
      errors.push('tested_at_utc: expected ISO UTC timestamp with at most millisecond precision');
    } else {
      const fraction = match[2] ? '.' + match[2].padEnd(3, '0') : '';
      const normalized = new Date(testedAt).toISOString();
      const canonical = !match[2] ? normalized.replace('.000Z', 'Z') : normalized;
      if (canonical !== match[1] + fraction + 'Z') {
        errors.push('tested_at_utc: invalid calendar date or time');
      }
      if (testedAt > Date.now() + 5 * 60 * 1000) {
        errors.push('tested_at_utc: cannot be in the future');
      }
    }
  }
  for (const field of [
    'local_input_boundary', 'local_state_boundary', 'local_output_boundary',
    'preprocessing_location', 'embedding_location', 'inference_location',
    'state_update_location',
  ]) {
    if (receipt[field] !== 'device') errors.push(field + ': must equal device');
  }
  if (!['device', 'not_applicable'].includes(receipt.speech_location)) {
    errors.push('speech_location: device or not_applicable required');
  }
  const measurementFields = [
    'latency_p50_ms', 'latency_p95_ms', 'peak_ram_mb',
    'energy_mj_per_inference', 'numerical_parity_max_abs_error',
  ];
  if (!exactKeys(receipt.measurements, measurementFields)) {
    errors.push('measurements: exact five-field object required');
  } else {
    for (const field of measurementFields) {
      const value = receipt.measurements[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        errors.push('measurements.' + field + ': finite nonnegative number required');
      }
    }
    for (const field of [
      'latency_p50_ms', 'latency_p95_ms', 'peak_ram_mb', 'energy_mj_per_inference',
    ]) {
      if (!finitePositive(receipt.measurements[field])) {
        errors.push('measurements.' + field + ': positive physical measurement required');
      }
    }
    if (finitePositive(receipt.measurements.latency_p50_ms) &&
        receipt.measurements.latency_p95_ms < receipt.measurements.latency_p50_ms) {
      errors.push('p95 must be >= p50');
    }
  }
  const methodFields = [
    'latency_sample_count', 'latency_warmup_count', 'parity_sample_count',
    'parity_tolerance', 'latency_method', 'ram_method', 'energy_method',
    'thermal_state', 'power_state',
  ];
  if (!exactKeys(receipt.measurement_method, methodFields)) {
    errors.push('measurement_method: exact method and sample-count object required');
  } else {
    for (const field of ['latency_sample_count', 'latency_warmup_count', 'parity_sample_count']) {
      if (!Number.isSafeInteger(receipt.measurement_method[field]) ||
          receipt.measurement_method[field] < 1) {
        errors.push('measurement_method.' + field + ': positive integer required');
      }
    }
    if (receipt.measurement_method.latency_sample_count < 100) {
      errors.push('measurement_method.latency_sample_count: at least 100 samples required');
    }
    if (receipt.measurement_method.latency_warmup_count < 5 ||
        receipt.measurement_method.latency_warmup_count >= receipt.measurement_method.latency_sample_count) {
      errors.push('measurement_method.latency_warmup_count: at least five and fewer than measured samples required');
    }
    if (typeof receipt.measurement_method.parity_tolerance !== 'number' ||
        !Number.isFinite(receipt.measurement_method.parity_tolerance) ||
        receipt.measurement_method.parity_tolerance < 0) {
      errors.push('measurement_method.parity_tolerance: finite nonnegative value required');
    } else if (typeof receipt.measurements?.numerical_parity_max_abs_error === 'number' &&
        Number.isFinite(receipt.measurements.numerical_parity_max_abs_error) &&
        receipt.measurements.numerical_parity_max_abs_error > receipt.measurement_method.parity_tolerance) {
      errors.push('numerical parity error exceeds declared tolerance');
    }
    for (const field of [
      'latency_method', 'ram_method', 'energy_method', 'thermal_state', 'power_state',
    ]) {
      if (!nonempty(receipt.measurement_method[field]) || placeholder(receipt.measurement_method[field])) {
        errors.push('measurement_method.' + field + ': non-placeholder description required');
      }
    }
  }
  if (receipt.physical_device_tested !== true) errors.push('physical_device_tested must be true');
  if (receipt.airplane_mode_tested !== true) errors.push('airplane_mode_tested must be true');
  if (receipt.network_requests_observed !== 0) errors.push('network_requests_observed must be zero');
  if (receipt.cloud_fallback_observed !== false) errors.push('cloud_fallback_observed must be false');
  if (receipt.physical_restart_replay !== true) errors.push('physical_restart_replay must be true');
  if (!nonempty(receipt.raw_evidence_path) || placeholder(receipt.raw_evidence_path)) {
    errors.push('raw_evidence_path: non-placeholder path required');
  }
  validateEvidenceFiles(resolve(path), receipt.evidence_files);
}
if (errors.length) {
  console.error('INVALID physical-device receipt:\n' + errors.map(x => '- ' + x).join('\n'));
  process.exit(1);
}
console.log('STRUCTURALLY VALID physical-device receipt; evidence file hashes verified; independent evidence review still required.');
