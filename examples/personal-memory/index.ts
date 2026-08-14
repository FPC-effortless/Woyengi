import { defineDomainPackage } from "../../packages/domain-sdk/src/index.ts";

export const personalMemoryDomain = defineDomainPackage({
  name: "@example/woyengi-personal-memory",
  version: "1.0.0",
  platformApi: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
  entityTypes: [{ id: "memory:person" }, { id: "memory:topic" }],
  claimPredicates: [{ id: "memory:preference" }, { id: "memory:commitment" }],
  eventTypes: [{ id: "memory:conversation" }],
  relationshipTypes: [{ id: "memory:knows" }],
  graphDefinitions: [{ id: "memory:episodes" }],
  lifecycleRules: [{ id: "memory:inference-lifecycle" }],
  authorityPolicies: [{ id: "memory:self-declaration-authority" }],
  stateReducers: [{ id: "memory:current-preferences" }],
  verificationRules: [{ id: "memory:source-span-verifier" }],
  reconstructionPolicies: [{ id: "memory:meeting-preparation" }],
  permissionPolicies: [{ id: "memory:private-by-default" }],
  procedures: [{ id: "memory:recurring-workflow" }],
  connectors: [{ id: "memory:conversation-import" }],
});
