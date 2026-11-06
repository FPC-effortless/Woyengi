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
cmp "$tmp/first.json" "$tmp/second.json" || { echo "FAIL: host replay receipt changed" >&2; exit 1; }
"$PY" - "$tmp/first.json" <<'PY'
import json,sys
with open(sys.argv[1], encoding="utf-8") as f:
    receipt=json.load(f)
assert isinstance(receipt, dict), "receipt must be an object"
print("PASS: two identical host replay receipts; independent physical-device qualification NOT RUN")
PY
