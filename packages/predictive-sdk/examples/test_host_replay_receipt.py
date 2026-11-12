"""Dependency-free tests of the receipt parser embedded in the host acceptance wrapper.

These test receipt parsing only; they do not run the authenticated APK or qualify a device.
"""
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
        self.check_receipt('{"local":true,"error":0.0}', True)

    def test_empty_object(self):
        self.check_receipt('{}', False)

    def test_duplicate_key(self):
        self.check_receipt('{"a":1,"a":2}', False)

    def test_nested_duplicate_key(self):
        self.check_receipt('{"outer":{"a":1,"a":2}}', False)

    def test_exact_size_limit_valid(self):
        # The 1 MiB boundary is inclusive; only larger receipts are rejected.
        prefix = '{"payload":"'
        suffix = '"}'
        self.check_receipt(prefix + 'x' * (1024 * 1024 - len(prefix) - len(suffix)) + suffix, True)

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
