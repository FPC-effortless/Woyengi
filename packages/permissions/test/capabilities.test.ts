import assert from "node:assert/strict";
import { test } from "node:test";

import { CapabilityEngine, defineCapability } from "../src/index.ts";

test("default-denies leakage and evaluates contextual delegated capabilities", () => {
  const engine = new CapabilityEngine();
  engine.register(
    defineCapability({
      id: "capability:project-reader",
      principal: "user:owner",
      issuer: "organization:acme",
      resourcePrefixes: ["workspace:acme/project-alpha"],
      graphTypes: ["graph:projects"],
      entityIds: ["entity:project-alpha"],
      operations: ["READ", "RECONSTRUCT"],
      purposes: ["project-review"],
      maxSensitivity: "confidential",
      conditions: { deviceTrust: "managed" },
      validFrom: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      delegation: { canDelegate: true },
    }),
  );
  engine.register(
    defineCapability({
      id: "capability:agent-reader",
      principal: "agent:briefing",
      issuer: "user:owner",
      resourcePrefixes: ["workspace:acme/project-alpha"],
      graphTypes: ["graph:projects"],
      entityIds: ["entity:project-alpha"],
      operations: ["RECONSTRUCT"],
      purposes: ["project-review"],
      maxSensitivity: "internal",
      conditions: { deviceTrust: "managed" },
      validFrom: "2026-06-01T00:00:00Z",
      expiresAt: "2026-07-01T00:00:00Z",
      delegation: {
        canDelegate: false,
        parentCapabilityId: "capability:project-reader",
      },
    }),
  );
  const baseRequest = {
    principal: "agent:briefing",
    resourceId: "workspace:acme/project-alpha/claims/42",
    graphType: "graph:projects",
    entityId: "entity:project-alpha",
    purpose: "project-review",
    sensitivity: "internal" as const,
    context: { deviceTrust: "managed" },
    at: "2026-06-15T00:00:00Z",
  };

  assert.equal(engine.authorize({ ...baseRequest, operation: "RECONSTRUCT" }).allowed, true);
  assert.equal(engine.authorize({ ...baseRequest, operation: "PROPOSE_WRITE" }).allowed, false);
  assert.equal(
    engine.authorize({
      ...baseRequest,
      operation: "RECONSTRUCT",
      resourceId: "workspace:acme/project-alphabet/claims/42",
    }).allowed,
    false,
  );
  assert.equal(
    engine.authorize({
      ...baseRequest,
      operation: "RECONSTRUCT",
      sensitivity: "confidential",
    }).allowed,
    false,
  );
  assert.equal(
    engine.authorize({
      ...baseRequest,
      operation: "RECONSTRUCT",
      context: { deviceTrust: "unmanaged" },
    }).allowed,
    false,
  );
  assert.equal(engine.authorize({ ...baseRequest, principal: "agent:unknown", operation: "READ" }).allowed, false);
});
