import assert from "node:assert/strict";
import { test } from "node:test";

import { IngestionFabric } from "../src/index.ts";

test("ingests every source kind through one idempotent provenance-ready envelope", async () => {
  const ledger: unknown[] = [];
  const objects = new Map<string, Uint8Array>();
  const events: unknown[] = [];
  const fabric = new IngestionFabric({
    async append(record) {
      ledger.push(record);
    },
    async put(hash, bytes) {
      objects.set(hash, bytes);
    },
    async publish(event) {
      events.push(event);
    },
  });
  const kinds = ["document", "application-event", "api-payload", "agent-proposal", "human-action"] as const;
  const receipts = [];
  for (const [index, sourceKind] of kinds.entries()) {
    receipts.push(
      await fabric.ingest({
        id: `ingestion:item-${index}`,
        idempotencyKey: `connector:key-${index}`,
        source: { kind: sourceKind, id: `source:item-${index}`, principal: "user:owner" },
        mediaType: "application/json",
        content: new TextEncoder().encode(JSON.stringify({ sourceKind })),
        storagePolicy: {
          locality: "local-only",
          allowedRegions: ["device"],
          allowedAgents: sourceKind === "agent-proposal" ? ["agent:compiler"] : [],
          encryption: "device-key",
        },
        recordedAt: `2026-03-01T00:0${index}:00Z`,
      }),
    );
  }
  const duplicate = await fabric.ingest({
    id: "ingestion:different-id",
    idempotencyKey: "connector:key-0",
    source: { kind: "document", id: "source:different", principal: "user:owner" },
    mediaType: "text/plain",
    content: new TextEncoder().encode("different"),
    storagePolicy: {
      locality: "cloud-allowed",
      allowedRegions: [],
      allowedAgents: [],
      encryption: "organization-key",
    },
    recordedAt: "2026-03-01T01:00:00Z",
  });

  assert.deepEqual(receipts.map((receipt) => receipt.envelope.source.kind), kinds);
  assert.match(receipts[0]?.envelope.contentHash ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.equal(receipts[3]?.envelope.lifecycle, "provisional");
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.envelope.id, "ingestion:item-0");
  assert.equal(ledger.length, 5);
  assert.equal(objects.size, 5);
  assert.equal(events.length, 5);
});
