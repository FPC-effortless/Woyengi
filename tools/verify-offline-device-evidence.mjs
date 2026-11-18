#!/usr/bin/env node
// Dependency-free, fail-closed validation of physical-device offline evidence.
// Usage: node tools/verify-offline-device-evidence.mjs path/to/receipt.json
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { TextDecoder } from 'node:util';

const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 200_000;
const path = process.argv[2];
if (!path || process.argv.length !== 3) {
  console.error('Usage: node tools/verify-offline-device-evidence.mjs RECEIPT.json');
  process.exit(2);
}

function readBoundedUtf8(filePath) {
  const fd = openSync(filePath, 'r');
  try {
    const metadata = fstatSync(fd);
    if (!metadata.isFile()) throw new Error('receipt must be a regular file');
    if (metadata.size > MAX_RECEIPT_BYTES) throw new Error('receipt exceeds 1 MiB limit');
    const buffer = Buffer.alloc(MAX_RECEIPT_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > MAX_RECEIPT_BYTES) throw new Error('receipt exceeds 1 MiB limit');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
  } finally {
    closeSync(fd);
  }
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
