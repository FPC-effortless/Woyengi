import assert from "node:assert/strict";
import { test } from "node:test";

import { CompositionRuntime } from "../src/index.ts";

test("keeps a component pending until a compatible authorized provider appears", async () => {
  const checks: string[] = [];
  const activatedWith: unknown[] = [];
  const runtime = new CompositionRuntime({
    evaluateApplicability: async ({ componentId, bindings }) => {
      checks.push(`applicability:${componentId}:${bindings[0]?.providerId}`);
      return { allowed: true, reason: "applicable" };
    },
    authorize: async ({ componentId, bindings }) => {
      checks.push(`authority:${componentId}:${bindings[0]?.providerId}`);
      return { allowed: true, reason: "authorized" };
    },
  });

  await runtime.registerComponent({
    id: "component:consumer",
    version: "1.0.0",
    scope: { workspaceId: "workspace:one" },
    requirements: [{ capability: "capability:clock" }],
    effects: {
      acquireRuntime: async (context) => {
        activatedWith.push(context.resolve("capability:clock"));
        return [];
      },
      semantic: [{ id: "semantic-effect:proposal" }],
      external: [{ id: "external-effect:email" }],
    },
  });

  assert.equal(runtime.component("component:consumer")?.state, "PENDING");
  assert.deepEqual(checks, []);

  await runtime.registerProvider({
    id: "provider:clock",
    capability: "capability:clock",
    version: "1.0.0",
    scope: { workspaceId: "workspace:one" },
    value: { now: "2026-08-21T00:00:00Z" },
  });

  assert.equal(runtime.component("component:consumer")?.state, "ACTIVE");
  assert.deepEqual(checks, [
    "applicability:component:consumer:provider:clock",
    "authority:component:consumer:provider:clock",
  ]);
  assert.deepEqual(activatedWith, [{ now: "2026-08-21T00:00:00Z" }]);
  assert.deepEqual(runtime.component("component:consumer")?.providerIds, ["provider:clock"]);
});

test("fails closed when no authority evaluator is configured", async () => {
  const runtime = new CompositionRuntime();
  await runtime.registerComponent({
    id: "component:consumer",
    version: "1.0.0",
    scope: { workspaceId: "workspace:one" },
    requirements: [{ capability: "capability:clock" }],
  });

  const reconciliation = await runtime.registerProvider({
    id: "provider:clock",
    capability: "capability:clock",
    version: "1.0.0",
    scope: { workspaceId: "workspace:one" },
    value: "clock",
  });

  assert.equal(runtime.component("component:consumer")?.state, "PENDING");
  assert.deepEqual(runtime.component("component:consumer")?.providerIds, []);
  assert.match(reconciliation.transitions.at(-1)?.reason ?? "", /^authority-rejected:/);
});

test("provider loss unwinds runtime leases, surfaces disposer failures, and replaces stale bindings without replaying world effects", async () => {
  const resolvedValues: string[] = [];
  const disposed: string[] = [];
  let worldEffectExecutions = 0;
  const semanticEffects = [{ id: "semantic-effect:proposal", execute: () => { worldEffectExecutions += 1; } }];
  const externalEffects = [{ id: "external-effect:email", execute: () => { worldEffectExecutions += 1; } }];
  const runtime = new CompositionRuntime({
    authorize: async () => ({ allowed: true, reason: "authorized for test" }),
    now: () => "2026-08-21T01:00:00Z",
  });

  await runtime.registerProvider({
    id: "provider:clock-a",
    capability: "capability:clock",
    version: "1.0.0",
    scope: { workspaceId: "workspace:one" },
    value: "clock-a",
  });
  await runtime.registerComponent({
    id: "component:consumer",
    version: "1.0.0",
    scope: { workspaceId: "workspace:one" },
    requirements: [{ capability: "capability:clock" }],
    effects: {
      semantic: semanticEffects,
      external: externalEffects,
      acquireRuntime: async (context) => {
        resolvedValues.push(context.resolve<string>("capability:clock"));
        return [
          {
            id: "runtime-effect-lease:subscription",
            effectClass: "RUNTIME",
            dispose: () => { disposed.push("subscription"); },
          },
          {
            id: "runtime-effect-lease:broken-timer",
            effectClass: "RUNTIME",
            dispose: () => { throw new Error("timer disposer failed"); },
          },
        ];
      },
    },
  });

  const loss = await runtime.unregisterProvider("provider:clock-a", "provider disconnected");

  assert.equal(runtime.component("component:consumer")?.state, "PENDING");
  assert.deepEqual(runtime.component("component:consumer")?.providerIds, []);
  assert.deepEqual(runtime.component("component:consumer")?.runtimeEffectLeaseIds, []);
  assert.deepEqual(disposed, ["subscription"]);
  assert.deepEqual(loss.disposerFailures, [{
    componentId: "component:consumer",
    leaseId: "runtime-effect-lease:broken-timer",
    message: "timer disposer failed",
  }]);
  assert.deepEqual(loss.transitions.map((transition) => transition.to), ["SUSPENDED", "UNLOADING", "PENDING"]);
  assert.deepEqual(loss.transitions.at(-1)?.disposerFailures, [{
    leaseId: "runtime-effect-lease:broken-timer",
    message: "timer disposer failed",
  }]);

  await runtime.registerProvider({
    id: "provider:clock-b",
    capability: "capability:clock",
    version: "1.1.0",
    scope: { workspaceId: "workspace:one" },
    value: "clock-b",
  });

  assert.equal(runtime.component("component:consumer")?.state, "ACTIVE");
  assert.deepEqual(runtime.component("component:consumer")?.providerIds, ["provider:clock-b"]);
  assert.deepEqual(resolvedValues, ["clock-a", "clock-b"]);
  assert.equal(worldEffectExecutions, 0);
});

test("isolates scoped providers and exposes a persistable lifecycle journal", async () => {
  const persisted: unknown[] = [];
  const runtime = new CompositionRuntime({
    authorize: async () => ({ allowed: true, reason: "authorized for test" }),
    transitionSink: (transition) => { persisted.push(transition); },
  });
  for (const workspaceId of ["workspace:one", "workspace:two"]) {
    await runtime.registerComponent({
      id: `component:${workspaceId.split(":")[1]}`,
      version: "1.0.0",
      scope: { workspaceId },
      requirements: [{ capability: "capability:clock" }],
    });
  }

  await runtime.registerProvider({
    id: "provider:clock-one",
    capability: "capability:clock",
    version: "1.0.0",
    scope: { workspaceId: "workspace:one" },
    value: "clock-one",
  });

  assert.equal(runtime.component("component:one")?.state, "ACTIVE");
  assert.equal(runtime.component("component:two")?.state, "PENDING");
  assert.equal(runtime.component("component:two")?.providerIds.length, 0);
  assert.deepEqual(persisted, runtime.journal());
  assert.equal(runtime.journal().every((transition) => transition.reason.length > 0), true);
});
