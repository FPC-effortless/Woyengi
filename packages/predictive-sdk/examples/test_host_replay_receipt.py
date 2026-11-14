"""Dependency-free tests of the receipt parser embedded in the host acceptance wrapper.

These test receipt parsing only; they do not run the authenticated APK or qualify a device.
"""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name('verify_me111_host_replay.sh')


def parser_source():
    text = SCRIPT.read_text(encoding='utf-8')
    marker = "<<'PY'\n"
    assert text.count(marker) == 1, 'expected one embedded receipt validator'
    return text.split(marker, 1)[1].split('\nPY\n', 1)[0]


def valid_receipt(**overrides):
    receipt = {
        "schema": "woyengi.me111-host-demonstration.v1",
        "data": "CONSTRUCTED_PYTORCH_REFERENCE",
        "execution": "HOST_ONNX_CPU",
        "physicalDeviceQualification": "NOT_RUN",
        "physicalNetworkTrace": "NOT_RUN",
        "stateReplay": "PASSED_ACROSS_TWO_LOCAL_RUNTIME_PROCESSES",
        "apkSha256": "f17a9f9a5752c32ffe8da407b27754793925a87bddb7b51a8bae56d64fb1f318",
        "forecasts": [{}, {}],
        "cases": {
            "unauthorizedSource": "DENIED",
            "remoteFallback": "REJECTED",
            "canonicalHistoryDuringPrediction": "UNCHANGED",
            "conflict": {"status": "ABSTAIN", "reason": "SOURCE_CONFLICT"},
        },
    }
    receipt.update(overrides)
    return json.dumps(receipt, ensure_ascii=False, separators=(',', ':'))


class ReceiptParserTests(unittest.TestCase):
    def check_receipt(self, payload, valid):
        with tempfile.TemporaryDirectory() as directory:
            receipt = pathlib.Path(directory) / 'receipt.json'
            receipt.write_text(payload, encoding='utf-8')
            result = subprocess.run([sys.executable, '-c',
                'import sys\nsys.argv = ["validator", sys.argv[1]]\n' + parser_source(),
                str(receipt)], capture_output=True, text=True)
            self.assertEqual(result.returncode == 0, valid, result.stderr)

    def test_valid_object(self):
        self.check_receipt(valid_receipt(), True)

    def test_missing_evidence_fields(self):
        self.check_receipt('{"local":true}', False)

    def test_false_device_qualification(self):
        self.check_receipt(valid_receipt(physicalDeviceQualification='PASS'), False)

    def test_wrong_apk_identity(self):
        self.check_receipt(valid_receipt(apkSha256='0' * 64), False)

    def test_missing_conflict_abstention(self):
        self.check_receipt(valid_receipt(cases={'unauthorizedSource':'DENIED','remoteFallback':'REJECTED','canonicalHistoryDuringPrediction':'UNCHANGED'}), False)

    def test_empty_object(self):
        self.check_receipt('{}', False)

    def test_duplicate_key(self):
        self.check_receipt('{"a":1,"a":2}', False)

    def test_nested_duplicate_key(self):
        self.check_receipt('{"outer":{"a":1,"a":2}}', False)

    def test_exact_size_limit_valid(self):
        base = valid_receipt(payload='')
        self.check_receipt(valid_receipt(payload='x' * (1024 * 1024 - len(base.encode('utf-8')))), True)

    def test_truncated_json(self):
        self.check_receipt('{"local":true', False)

    def test_top_level_scalar(self):
        self.check_receipt('42', False)

    def test_nested_nonfinite_constant(self):
        self.check_receipt('{"events":[{"score":NaN}]}', False)

    def test_exact_limit_utf8_bytes(self):
        base = valid_receipt(payload='')
        budget = 1024 * 1024 - len(base.encode('utf-8'))
        filler = 'é' * (budget // 2) + 'x' * (budget % 2)
        self.check_receipt(valid_receipt(payload=filler), True)
        self.check_receipt(valid_receipt(payload=filler + 'é'), False)

    def test_nan(self):
        self.check_receipt('{"a":NaN}', False)

    def test_infinity(self):
        self.check_receipt('{"a":Infinity}', False)

    def test_exponent_overflow(self):
        self.check_receipt('{"a":1e999}', False)

    def test_nested_exponent_overflow(self):
        self.check_receipt('{"a":[{"b":-1e999}]}', False)

    def test_oversized_receipt(self):
        self.check_receipt('{"payload":"' + 'x' * (1024 * 1024) + '"}', False)

    def test_array_top_level(self):
        self.check_receipt('[1,2]', False)


if __name__ == '__main__':
    unittest.main()
