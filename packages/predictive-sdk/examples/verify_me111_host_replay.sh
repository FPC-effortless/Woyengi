#!/usr/bin/env bash
# Independent, fail-closed HOST replay only. This is not physical-device qualification.
set -euo pipefail
if [[ $# -ne 2 ]]; then
  echo "Usage: bash packages/predictive-sdk/examples/verify_me111_host_replay.sh /absolute/path/model.apk /absolute/path/python-with-numpy-onnxruntime" >&2
  exit 2
fi
APK="$1"
PY="$2"
[[ -f "$APK" && -x "$PY" ]] || { echo "BLOCKED: pinned APK or executable Python unavailable" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
expected=f17a9f9a5752c32ffe8da407b27754793925a87bddb7b51a8bae56d64fb1f318
actual="$(sha256sum "$APK" | awk '{print $1}')"
[[ "$actual" == "$expected" ]] || { echo "FAIL: APK SHA256 mismatch" >&2; exit 1; }
command -v node >/dev/null || { echo "BLOCKED: Node.js missing" >&2; exit 2; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
node packages/predictive-sdk/examples/me111_host_quickstart.ts "$APK" "$PY" > "$tmp/first.json"
node packages/predictive-sdk/examples/me111_host_quickstart.ts "$APK" "$PY" > "$tmp/second.json"
cmp -s "$tmp/first.json" "$tmp/second.json" || { echo "FAIL: host replay receipt changed" >&2; exit 1; }
"$PY" - "$tmp/first.json" <<'PY'
import json, math, sys

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result

def reject_nonfinite(value):
    raise ValueError(f"nonfinite JSON constant: {value}")

def finite_float(token):
    try:
        value = float(token)
    except (OverflowError, ValueError) as exc:
        raise ValueError("invalid JSON floating-point number") from exc
    if not math.isfinite(value):
        raise ValueError("nonfinite JSON floating-point number")
    return value

try:
    # Bound untrusted receipt size before loading it into memory.
    if __import__("os").path.getsize(sys.argv[1]) > 1024 * 1024:
        raise ValueError("host replay receipt exceeds 1 MiB")
    with open(sys.argv[1], encoding="utf-8") as f:
        receipt = json.load(f, object_pairs_hook=unique_object, parse_constant=reject_nonfinite, parse_float=finite_float)
    if not isinstance(receipt, dict) or not receipt:
        raise ValueError("receipt must be a nonempty JSON object")
except (ValueError, UnicodeError) as exc:
    print(f"FAIL: invalid host replay receipt: {exc}", file=sys.stderr)
    sys.exit(1)
# A syntactically valid arbitrary object is not evidence of an actual host replay.
expected_fields = {
    "schema": "woyengi.me111-host-demonstration.v1",
    "data": "CONSTRUCTED_PYTORCH_REFERENCE",
    "execution": "HOST_ONNX_CPU",
    "physicalDeviceQualification": "NOT_RUN",
    "physicalNetworkTrace": "NOT_RUN",
    "stateReplay": "PASSED_ACROSS_TWO_LOCAL_RUNTIME_PROCESSES",
}
try:
    for key, expected in expected_fields.items():
        if receipt.get(key) != expected:
            raise ValueError(f"{key}: expected {expected}")
    if receipt.get("apkSha256") != "f17a9f9a5752c32ffe8da407b27754793925a87bddb7b51a8bae56d64fb1f318":
        raise ValueError("apkSha256: pinned artifact mismatch")
    if not isinstance(receipt.get("forecasts"), list) or len(receipt["forecasts"]) != 2:
        raise ValueError("forecasts: expected two local steps")
    cases = receipt.get("cases")
    if not isinstance(cases, dict) or cases.get("unauthorizedSource") != "DENIED" or cases.get("remoteFallback") != "REJECTED" or cases.get("canonicalHistoryDuringPrediction") != "UNCHANGED":
        raise ValueError("cases: required authority and state checks absent")
    if not isinstance(cases.get("conflict"), dict) or cases["conflict"].get("status") != "ABSTAIN" or cases["conflict"].get("reason") != "SOURCE_CONFLICT":
        raise ValueError("cases: source-conflict abstention absent")
except ValueError as exc:
    print(f"FAIL: invalid host replay evidence: {exc}", file=sys.stderr)
    sys.exit(1)
print("PASS: two identical, strict-JSON host replay receipts; independent physical-device qualification NOT RUN")
PY
