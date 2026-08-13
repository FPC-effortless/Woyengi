import assert from "node:assert/strict";
import { test } from "node:test";

import { DomainPackageRegistry, defineDomainPackage } from "../src/index.ts";

test("installs a complete compatible domain package and rejects incompatible versions", () => {
  const sample = defineDomainPackage({
    name: "@example/domain-operations",
    version: "1.2.0",
    platformApi: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
    entityTypes: [{ id: "operations:asset" }],
    claimPredicates: [{ id: "operations:status" }],
    eventTypes: [{ id: "operations:inspection-completed" }],
    relationshipTypes: [{ id: "operations:assigned-to" }],
    graphDefinitions: [{ id: "operations:asset-graph" }],
    lifecycleRules: [{ id: "operations:asset-lifecycle" }],
    authorityPolicies: [{ id: "operations:asset-authority" }],
    stateReducers: [{ id: "operations:asset-state" }],
    verificationRules: [{ id: "operations:inspection-verifier" }],
    reconstructionPolicies: [{ id: "operations:inspection-context" }],
    permissionPolicies: [{ id: "operations:asset-permissions" }],
    procedures: [{ id: "operations:inspect-asset" }],
    connectors: [{ id: "operations:asset-import" }],
  });
  const registry = new DomainPackageRegistry("1.4.0");

  registry.install(sample);

  assert.equal(registry.get("@example/domain-operations")?.version, "1.2.0");
  assert.equal(registry.get("@example/domain-operations")?.entityTypes[0]?.id, "operations:asset");
  assert.equal(Object.isFrozen(registry.get("@example/domain-operations")), true);
  assert.throws(
    () =>
      registry.install(
        defineDomainPackage({
          ...sample,
          name: "@example/domain-future",
          platformApi: { minInclusive: "2.0.0", maxExclusive: "3.0.0" },
        }),
      ),
    /incompatible with platform API/,
  );
});
