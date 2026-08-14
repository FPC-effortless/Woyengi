import json
import urllib.parse
import urllib.request


HTTP_ROUTES = {
    "ingest": {"method": "POST", "path": "/v1/ingest", "idempotent": True},
    "state": {"method": "GET", "path": "/v1/state/entities/{entityId}", "paginated": True, "query": ["validAt", "recordedAt"]},
    "reconstruct": {"method": "POST", "path": "/v1/reconstruct"},
    "control": {"method": "POST", "path": "/v1/control/{action}", "idempotent": True},
    "subscribe": {"method": "GET", "path": "/v1/subscriptions/{subscriptionId}", "paginated": True},
}


def _default_transport(url, method, headers, body):
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


class PlatformClient:
    def __init__(self, base_url, token, *, transport=None, retries=2):
        self.base_url = base_url.rstrip("/")
        self.token = token.strip()
        if not self.token:
            raise ValueError("token must not be empty")
        if not isinstance(retries, int) or retries < 0:
            raise ValueError("retries must be a non-negative integer")
        self.transport = transport or _default_transport
        self.retries = retries

    def ingest(self, body, *, idempotency_key):
        return self._request("POST", HTTP_ROUTES["ingest"]["path"], body, idempotency_key=idempotency_key)

    def state(self, entity_id, *, limit=None, cursor=None, valid_at=None, recorded_at=None):
        path = HTTP_ROUTES["state"]["path"].replace("{entityId}", urllib.parse.quote(entity_id, safe=""))
        return self._request("GET", path, query={"limit": limit, "cursor": cursor, "validAt": valid_at, "recordedAt": recorded_at})

    def reconstruct(self, body):
        return self._request("POST", HTTP_ROUTES["reconstruct"]["path"], body)

    def control(self, action, body, *, idempotency_key):
        path = HTTP_ROUTES["control"]["path"].replace("{action}", urllib.parse.quote(action, safe=""))
        return self._request("POST", path, body, idempotency_key=idempotency_key)

    def subscribe(self, subscription_id, *, limit=None, cursor=None):
        path = HTTP_ROUTES["subscribe"]["path"].replace(
            "{subscriptionId}", urllib.parse.quote(subscription_id, safe="")
        )
        return self._request("GET", path, query={"limit": limit, "cursor": cursor})

    def _request(self, method, path, body=None, *, idempotency_key=None, query=None):
        encoded_query = urllib.parse.urlencode({key: value for key, value in (query or {}).items() if value is not None})
        url = f"{self.base_url}{path}" + (f"?{encoded_query}" if encoded_query else "")
        headers = {"authorization": f"Bearer {self.token}", "accept": "application/json"}
        encoded_body = None
        if body is not None:
            headers["content-type"] = "application/json"
            encoded_body = json.dumps(body, separators=(",", ":")).encode("utf-8")
        if idempotency_key is not None:
            headers["idempotency-key"] = idempotency_key
        last_error = None
        for attempt in range(self.retries + 1):
            try:
                status, envelope = self.transport(url, method, headers, encoded_body)
                if status >= 500 and attempt < self.retries:
                    continue
                if status < 200 or status >= 300 or envelope.get("ok") is not True:
                    error = envelope.get("error") or {}
                    raise RuntimeError(f"{error.get('code', 'HTTP_ERROR')}: {error.get('message', f'HTTP {status}')}" )
                return envelope.get("data")
            except (OSError, TimeoutError) as error:
                last_error = error
                if attempt >= self.retries:
                    raise
        raise last_error
