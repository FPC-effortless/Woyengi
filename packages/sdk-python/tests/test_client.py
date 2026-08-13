import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from woyengi_platform.client import HTTP_ROUTES, PlatformClient


class PlatformClientTest(unittest.TestCase):
    def test_shared_routes_and_stable_idempotency_retry(self):
        fixture_path = pathlib.Path(__file__).parents[3] / "protocols" / "http-contract.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        calls = []

        def transport(url, method, headers, body):
            calls.append((url, method, headers, body))
            if len(calls) == 1:
                raise OSError("network reset")
            return 200, {"ok": True, "data": {"id": "ingestion:1"}, "meta": {"traceId": "trace:1"}}

        client = PlatformClient("https://platform.example", "token", transport=transport, retries=1)
        result = client.ingest({"source": "document"}, idempotency_key="request:stable")

        self.assertEqual(HTTP_ROUTES, fixture["routes"])
        self.assertEqual(result["id"], "ingestion:1")
        self.assertEqual(calls[0][2]["idempotency-key"], "request:stable")
        self.assertEqual(calls[1][2]["idempotency-key"], "request:stable")
        for method in ("state", "reconstruct", "control", "subscribe"):
            self.assertTrue(callable(getattr(client, method)))


if __name__ == "__main__":
    unittest.main()
