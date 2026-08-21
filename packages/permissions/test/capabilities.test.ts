import assert from "node:assert/strict";
import { test } from "node:test";

import { CapabilityEngine, defineCapability } from "../src/index.ts";

test("default-denies leakage and evaluates contextual delegated capabilities", () => {
  const engine = new CapabilityEngine();
  engine.register(
    defineCapability({
      id: "capability:project-reader",
      workspaceId: "workspace:acme",
      principal: "principal:owner",
      principalKind: "human",
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
      delegation: { canDelegate: true, depth: 0, maxDepth: 1 },
    }),
  );
  engine.register(
    defineCapability({
      id: "capability:agent-reader",
      workspaceId: "workspace:acme",
      principal: "principal:briefing-agent",
      principalKind: "agent",
      issuer: "principal:owner",
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
        canDelegate: true,
        parentCapabilityId: "capability:project-reader",
        depth: 1,
        maxDepth: 1,
      },
    }),
  );
  const baseRequest = {
    principal: "principal:briefing-agent",
    resourceId: "workspace:acme/project-alpha/claims/42",
    graphType: "graph:projects",
    entityId: "entity:project-alpha",
    purpose: "project-review",
    sensitivity: "internal" as const,
    context: { deviceTrust: "managed" },
    workspaceContext: { workspaceId: "workspace:acme", principalId: "principal:briefing-agent" },
    at: "2026-06-15T00:00:00Z",
  };

  assert.equal(engine.authorize({ ...baseRequest, operation: "RECONSTRUCT" }).allowed, true);
  const crossWorkspace = engine.authorize({
    ...baseRequest,
    operation: "RECONSTRUCT",
    workspaceContext: { workspaceId: "workspace:other", principalId: "principal:briefing-agent" },
  });
  assert.equal(crossWorkspace.allowed, false);
  assert.ok(crossWorkspace.evaluations[0]?.failures.includes("workspace-out-of-scope"));
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
  assert.equal(
    engine.authorize({
      ...baseRequest,
      principal: "principal:unknown-agent",
      operation: "READ",
      workspaceContext: { workspaceId: "workspace:acme", principalId: "principal:unknown-agent" },
    }).allowed,
    false,
  );
  assert.equal(engine.authorize({ ...baseRequest, operation: "RECONSTRUCT", at: "2026-07-01T00:00:00Z" }).allowed, false);

  assert.throws(
    () => engine.register(defineCapability({
      id: "capability:agent-full-copy",
      workspaceId: "workspace:acme",
      principal: "principal:full-copy-agent",
      principalKind: "agent",
      issuer: "principal:owner",
      resourcePrefixes: ["workspace:acme/project-alpha"],
      graphTypes: ["graph:projects"],
      entityIds: ["entity:project-alpha"],
      operations: ["READ", "RECONSTRUCT"],
      purposes: ["project-review"],
      maxSensitivity: "confidential",
      conditions: { deviceTrust: "managed" },
      validFrom: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      delegation: { canDelegate: false, parentCapabilityId: "capability:project-reader", depth: 1, maxDepth: 1 },
    })),
    /strictly narrow/i,
  );

  assert.throws(
    () => engine.register(defineCapability({
      id: "capability:grandchild",
      workspaceId: "workspace:acme",
      principal: "principal:summary-automation",
      principalKind: "automation",
      issuer: "principal:briefing-agent",
      resourcePrefixes: ["workspace:acme/project-alpha/claims"],
      graphTypes: ["graph:projects"],
      entityIds: ["entity:project-alpha"],
      operations: ["RECONSTRUCT"],
      purposes: ["project-review"],
      maxSensitivity: "public",
      conditions: { deviceTrust: "managed" },
      validFrom: "2026-06-02T00:00:00Z",
      expiresAt: "2026-06-30T00:00:00Z",
      delegation: { canDelegate: false, parentCapabilityId: "capability:agent-reader", depth: 2, maxDepth: 1 },
    })),
    /delegation depth/i,
  );

  assert.throws(
    () => engine.register(defineCapability({
      id: "capability:cross-workspace-agent",
      workspaceId: "workspace:other",
      principal: "principal:other-agent",
      principalKind: "agent",
      issuer: "principal:owner",
      resourcePrefixes: ["workspace:other/project-alpha"],
      graphTypes: ["graph:projects"],
      entityIds: ["entity:project-alpha"],
      operations: ["RECONSTRUCT"],
      purposes: ["project-review"],
      maxSensitivity: "internal",
      conditions: { deviceTrust: "managed" },
      validFrom: "2026-06-01T00:00:00Z",
      expiresAt: "2026-07-01T00:00:00Z",
      delegation: { canDelegate: false, parentCapabilityId: "capability:project-reader", depth: 1, maxDepth: 1 },
    })),
    /workspace scope/i,
  );

  engine.revoke({ capabilityId: "capability:agent-reader", revokedAt: "2026-06-16T00:00:00Z" });
  const revoked = engine.authorize({ ...baseRequest, operation: "RECONSTRUCT", at: "2026-06-17T00:00:00Z" });
  assert.equal(revoked.allowed, false);
  assert.ok(revoked.evaluations[0]?.failures.includes("revoked"));

  assert.throws(
    () => defineCapability({
      ...engineCapabilityFixture(),
      principal: "agent:legacy",
    }),
    /principal must start with principal:/,
  );
});

function engineCapabilityFixture() {
  return {
    id: "capability:legacy-principal",
    workspaceId: "workspace:acme",
    principal: "principal:owner",
    principalKind: "human" as const,
    issuer: "organization:acme",
    resourcePrefixes: ["workspace:acme"],
    graphTypes: [],
    entityIds: [],
    operations: ["READ" as const],
    purposes: ["project-review"],
    maxSensitivity: "internal" as const,
    conditions: {},
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
    delegation: { canDelegate: false, depth: 0, maxDepth: 0 },
  };
}
