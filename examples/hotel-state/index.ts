import { defineDomainPackage } from "../../packages/domain-sdk/src/index.ts";

export const hotelStateDomain = defineDomainPackage({
  name: "@example/woyengi-hotel-state",
  version: "1.0.0",
  platformApi: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
  entityTypes: [{ id: "hospitality:room" }, { id: "hospitality:guest" }, { id: "hospitality:reservation" }],
  claimPredicates: [{ id: "hospitality:availability" }],
  eventTypes: [{ id: "hospitality:check-in" }],
  relationshipTypes: [{ id: "hospitality:reserved-by" }],
  graphDefinitions: [{ id: "hospitality:stay-operations" }],
  lifecycleRules: [{ id: "hospitality:reservation-lifecycle" }],
  authorityPolicies: [{ id: "hospitality:property-authority" }],
  stateReducers: [{ id: "hospitality:room-state" }],
  verificationRules: [{ id: "hospitality:availability-verifier" }],
  reconstructionPolicies: [{ id: "hospitality:reservation-action" }],
  permissionPolicies: [{ id: "hospitality:guest-data-boundary" }],
  procedures: [{ id: "hospitality:service-request" }],
  connectors: [{ id: "hospitality:pms-import" }],
});
