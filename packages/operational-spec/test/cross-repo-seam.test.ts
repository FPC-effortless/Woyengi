import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defineWorldBundle,
  type WorldBundleInput,
} from "../src/index.ts";

test("WorldBundle preserves logical action system, declared parameters, and public cost metadata", () => {
  const decoded = {
    id: "world-bundle:adapter-seam:1",
    version: "0.1.0",
    sourceSpecRef: "operational-system-spec:adapter-seam",
    sourceSpecVersion: "0.1.0",
    compatibility: { minimumRuntimeVersion: "0.1.0" },
    public: {
      objective: "update a supplier record",
      actorRoles: ["operator"],
      actionSurface: [{
        id: "world-action:update-supplier",
        name: "update_supplier",
        kind: "WRITE",
        systemRef: "system:supplier-records",
        parameterNames: ["supplier_id", "status"],
        cost: { amount: 2, currency: "usd" },
      }],
      observationRefs: ["observation:supplier-record"],
      assetDescriptors: [],
      outcomeContractRefs: ["outcome-contract:supplier-updated"],
      provenanceRefs: ["operational-system-spec:adapter-seam"],
    },
    partitionManifest: [{ id: "world-member:public-task", partition: "public", kind: "TASK" }],
    provenanceRefs: ["operational-system-spec:adapter-seam"],
  } as unknown as WorldBundleInput;

  const bundle = defineWorldBundle(decoded);
  const action = bundle.public.actionSurface[0] as unknown as {
    readonly systemRef?: string;
    readonly parameterNames?: readonly string[];
    readonly cost?: { readonly amount: number; readonly currency: string };
  };

  assert.equal(action.systemRef, "system:supplier-records");
  assert.deepEqual(action.parameterNames, ["status", "supplier_id"]);
  assert.deepEqual(action.cost, { amount: 2, currency: "USD" });
});

test("WorldBundle rejects duplicate public action names even when IDs differ", () => {
  const decoded = {
    id: "world-bundle:duplicate-actions:1",
    version: "0.1.0",
    sourceSpecRef: "operational-system-spec:duplicate-actions",
    sourceSpecVersion: "0.1.0",
    compatibility: { minimumRuntimeVersion: "0.1.0" },
    public: {
      objective: "perform one unambiguous action",
      actorRoles: ["operator"],
      actionSurface: [
        {
          id: "world-action:first",
          name: "update_record",
          kind: "WRITE",
          systemRef: "system:records",
          parameterNames: ["record_id"],
        },
        {
          id: "world-action:second",
          name: "update_record",
          kind: "WRITE",
          systemRef: "system:records",
          parameterNames: ["record_id"],
        },
      ],
      observationRefs: [],
      assetDescriptors: [],
      outcomeContractRefs: ["outcome-contract:updated"],
      provenanceRefs: ["operational-system-spec:duplicate-actions"],
    },
    partitionManifest: [{ id: "world-member:public-task", partition: "public", kind: "TASK" }],
    provenanceRefs: ["operational-system-spec:duplicate-actions"],
  } as unknown as WorldBundleInput;

  assert.throws(() => defineWorldBundle(decoded), /duplicate world action name/i);
});
