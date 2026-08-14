import assert from "node:assert/strict";
import { test } from "node:test";

import { DomainPackageRegistry } from "../packages/domain-sdk/src/index.ts";
import { hotelStateDomain } from "./hotel-state/index.ts";
import { personalMemoryDomain } from "./personal-memory/index.ts";
import { regulatoryStateDomain } from "./regulatory-state/index.ts";

test("installs independent personal-memory, regulatory-state, and hotel-state examples without kernel changes", () => {
  const registry = new DomainPackageRegistry("1.0.0");
  for (const domainPackage of [personalMemoryDomain, regulatoryStateDomain, hotelStateDomain]) registry.install(domainPackage);
  assert.deepEqual(registry.installed().map((domainPackage) => domainPackage.name), [
    "@example/woyengi-hotel-state",
    "@example/woyengi-personal-memory",
    "@example/woyengi-regulatory-state",
  ]);
  assert.equal(regulatoryStateDomain.verificationRules[0]?.id, "regulation:licence-validity");
  assert.equal(personalMemoryDomain.permissionPolicies[0]?.id, "memory:private-by-default");
  assert.equal(hotelStateDomain.procedures[0]?.id, "hospitality:service-request");
});
