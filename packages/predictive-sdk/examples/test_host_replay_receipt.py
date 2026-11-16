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
        "runtime": "1.23.2",
        "modelSha256": "dd65519a9e4f3388966538af53119b56e9292b46a9209d63ad4927b87f0a176b",
        "checkpointSha256": "337b882e9a10631dc85700846ef2b15ca8908699499668186ad3a248dc108449",
        "apkSha256": "f17a9f9a5752c32ffe8da407b27754793925a87bddb7b51a8bae56d64fb1f318",
        "forecasts": [{
            "hour": hour, "status": "FORECAST", "actionAuthority": "NOT_GRANTED",
            "modelSha256": "dd65519a9e4f3388966538af53119b56e9292b46a9209d63ad4927b87f0a176b",
            "scientificQualification": "FAILED_MIXED_ME111",
            "sourceQualification": "STRUCTURAL_EXPORT_ONLY",
            "deviceQualification": "NOT_RUN",
            "units": "STANDARDIZED_LOG1P_POLLUTANT",
            "maxAbsError": {"forecast": 0.0, "state": 0.0},
        } for hour in (100, 101)],
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
    def run_receipt(self, payload):
        with tempfile.TemporaryDirectory() as directory:
            receipt = pathlib.Path(directory) / 'receipt.json'
            receipt.write_text(payload, encoding='utf-8')
            return subprocess.run([sys.executable, '-c',
                'import sys\nsys.argv = ["validator", sys.argv[1]]\n' + parser_source(),
                str(receipt)], capture_output=True, text=True)

    def check_receipt(self, payload, valid):
        result = self.run_receipt(payload)
        self.assertEqual(result.returncode == 0, valid, result.stderr)

    def test_valid_object(self):
        self.check_receipt(valid_receipt(), True)

    def test_empty_forecast_evidence(self):
        self.check_receipt(valid_receipt(forecasts=[{}, {}]), False)

    def test_wrong_forecast_hour(self):
        steps = json.loads(valid_receipt())["forecasts"]
        steps[1]["hour"] = 100
        self.check_receipt(valid_receipt(forecasts=steps), False)

    def test_missing_numerical_parity(self):
        steps = json.loads(valid_receipt())["forecasts"]
        del steps[0]["maxAbsError"]
        self.check_receipt(valid_receipt(forecasts=steps), False)

    def test_negative_numerical_error(self):
        steps = json.loads(valid_receipt())["forecasts"]
        steps[0]["maxAbsError"]["state"] = -1
        self.check_receipt(valid_receipt(forecasts=steps), False)

    def test_missing_evidence_fields(self):
        self.check_receipt('{"local":true}', False)

    def test_false_device_qualification(self):
        self.check_receipt(valid_receipt(physicalDeviceQualification='PASS'), False)

    def test_wrong_apk_identity(self):
        self.check_receipt(valid_receipt(apkSha256='0' * 64), False)

    def test_wrong_model_identity(self):
        self.check_receipt(valid_receipt(modelSha256='0' * 64), False)

    def test_wrong_checkpoint_identity(self):
        self.check_receipt(valid_receipt(checkpointSha256='0' * 64), False)

    def test_wrong_runtime_version(self):
        self.check_receipt(valid_receipt(runtime='0.0.0'), False)

    def test_false_scientific_qualification_is_rejected(self):
        steps = json.loads(valid_receipt())["forecasts"]
        steps[0]["scientificQualification"] = "QUALIFIED"
        self.check_receipt(valid_receipt(forecasts=steps), False)

    def test_integer_overflow_parity_error_is_rejected_without_traceback(self):
        for value in (10**1000, -(10**1000)):
            steps = json.loads(valid_receipt())["forecasts"]
            steps[0]["maxAbsError"]["forecast"] = value
            result = self.run_receipt(valid_receipt(forecasts=steps))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("FAIL: invalid host replay evidence: forecasts: invalid forecast error", result.stderr)
            self.assertNotIn("Traceback", result.stderr)

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
