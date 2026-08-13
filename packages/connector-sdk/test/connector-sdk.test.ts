import assert from "node:assert/strict";
import { test } from "node:test";

import { AGENT_SDK_VERSION } from "../../agent-sdk/src/index.ts";
import { DOMAIN_SDK_VERSION, defineDomainPackage } from "../../domain-sdk/src/index.ts";
import { CONNECTOR_SDK_VERSION, ConnectorRunner, defineConnector } from "../src/index.ts";

test("exposes versioned compatible domain, agent, and idempotent connector contracts", async () => {
  const domain = defineDomainPackage({
    name: "@example/domain-minimal",
    version: "1.0.0",
    platformApi: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
    entityTypes: [], claimPredicates: [], eventTypes: [], relationshipTypes: [], graphDefinitions: [],
    lifecycleRules: [], authorityPolicies: [], stateReducers: [], verificationRules: [],
    reconstructionPolicies: [], permissionPolicies: [], procedures: [], connectors: [],
  });
  let polls = 0;
  const connector = defineConnector({
    id: "connector:sample",
    version: "1.0.0",
    platformApi: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
    sourceKinds: ["api-payload"],
    deprecated: false,
    async pull(cursor) {
      polls += 1;
      return cursor === undefined
        ? { items: [{ externalId: "external:1", content: { value: 1 } }], nextCursor: "cursor:1" }
        : { items: [], nextCursor: cursor };
    },
  });
  const delivered: string[] = [];
  const runner = new ConnectorRunner("1.0.0", async (item) => delivered.push(item.idempotencyKey));

  await runner.poll(connector);
  await runner.poll(connector);

  assert.equal(domain.version, "1.0.0");
  assert.equal(DOMAIN_SDK_VERSION, "1.0.0");
  assert.equal(AGENT_SDK_VERSION, "1.0.0");
  assert.equal(CONNECTOR_SDK_VERSION, "1.0.0");
  assert.deepEqual(delivered, ["connector:sample:external:1"]);
  assert.equal(polls, 2);
  assert.equal(runner.cursor("connector:sample"), "cursor:1");
  assert.throws(
    () => defineConnector({ ...connector, id: "connector:future", platformApi: { minInclusive: "2.0.0", maxExclusive: "3.0.0" } }),
    /incompatible with Platform API 1.0.0/,
  );
});
