import { defineDomainPackage } from "../../packages/domain-sdk/src/index.ts";

export const regulatoryStateDomain = defineDomainPackage({
  name: "@example/woyengi-regulatory-state",
  version: "1.0.0",
  platformApi: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
  entityTypes: [{ id: "regulation:company" }, { id: "regulation:licence" }, { id: "regulation:requirement" }],
  claimPredicates: [{ id: "regulation:eligibility" }],
  eventTypes: [{ id: "regulation:filing-submitted" }],
  relationshipTypes: [{ id: "regulation:governed-by" }],
  graphDefinitions: [{ id: "regulation:compliance-evidence" }],
  lifecycleRules: [{ id: "regulation:licence-lifecycle" }],
  authorityPolicies: [{ id: "regulation:regulator-authority" }],
  stateReducers: [{ id: "regulation:eligibility-state" }],
  verificationRules: [{ id: "regulation:licence-validity" }],
  reconstructionPolicies: [{ id: "regulation:eligibility-decision" }],
  permissionPolicies: [{ id: "regulation:restricted-evidence" }],
  procedures: [{ id: "regulation:filing-procedure" }],
  connectors: [{ id: "regulation:register-import" }],
});
