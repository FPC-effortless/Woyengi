import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { LocalEventBus, createPlatformEvent } from "../src/index.ts";

test("resumes from durable cursors with deterministic duplicate-detectable deliveries", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "woyengi-events-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const first = await LocalEventBus.open(root);
  await first.publish(
    createPlatformEvent({
      id: "platform-event:claim-created",
      topic: "claim.created",
      aggregateId: "claim:1",
      causedBy: "command:1",
      payload: { claimId: "claim:1" },
      recordedAt: "2026-03-01T00:00:00Z",
    }),
  );
  await first.publish(
    createPlatformEvent({
      id: "platform-event:claim-verified",
      topic: "claim.verified",
      aggregateId: "claim:1",
      causedBy: "verification:1",
      payload: { claimId: "claim:1" },
      recordedAt: "2026-03-01T00:01:00Z",
    }),
  );

  const seen: string[] = [];
  await assert.rejects(
    () =>
      first.consume(
        { id: "subscription:regulation", topicPrefixes: ["claim."] },
        async (delivery) => {
          seen.push(delivery.deliveryId);
          if (delivery.event.topic === "claim.verified") throw new Error("consumer crashed");
        },
      ),
    /consumer crashed/,
  );

  const reopened = await LocalEventBus.open(root);
  const resumed: string[] = [];
  await reopened.consume(
    { id: "subscription:regulation", topicPrefixes: ["claim."] },
    async (delivery) => resumed.push(delivery.deliveryId),
  );

  assert.equal(seen.length, 2);
  assert.deepEqual(resumed, [seen[1]]);
  assert.equal((await reopened.pending({ id: "subscription:regulation", topicPrefixes: ["claim."] })).length, 0);
});
