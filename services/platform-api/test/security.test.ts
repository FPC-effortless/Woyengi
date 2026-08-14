import assert from "node:assert/strict";
import { test } from "node:test";

import { createBearerAuthenticator, SlidingWindowRateLimiter } from "../src/security.ts";

test("compares bearer credentials safely and bounds pre-auth request bursts", () => {
  const token = `test-${"x".repeat(32)}`;
  const authenticate = createBearerAuthenticator({ token, principal: "user:local-operator" });
  assert.deepEqual(authenticate(`Bearer ${token}`), { id: "user:local-operator" });
  assert.equal(authenticate(`Bearer test-${"y".repeat(32)}`), undefined);
  assert.equal(authenticate(undefined), undefined);
  assert.equal(authenticate(`Basic ${token}`), undefined);

  const limiter = new SlidingWindowRateLimiter({ maximumRequests: 2, windowMilliseconds: 1_000, maximumKeys: 10 });
  assert.equal(limiter.allow({ key: "address:1", at: "2026-08-14T00:00:00.000Z" }).allowed, true);
  assert.equal(limiter.allow({ key: "address:1", at: "2026-08-14T00:00:00.100Z" }).allowed, true);
  const denied = limiter.allow({ key: "address:1", at: "2026-08-14T00:00:00.200Z" });
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 1);
  assert.equal(limiter.allow({ key: "address:1", at: "2026-08-14T00:00:01.001Z" }).allowed, true);
});
