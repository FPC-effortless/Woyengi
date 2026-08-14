import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { LedgerRecord } from "../../../packages/ledger/src/index.ts";
import { LocalCanonicalLedger } from "../../../packages/storage/src/index.ts";
import { PlatformApi } from "./index.ts";

const token = requiredEnvironment("WOYENGI_API_TOKEN");
const dataDirectory = resolve(process.env.WOYENGI_DATA_DIR ?? "./.woyengi-data");
await mkdir(dataDirectory, { recursive: true });
const ledger = await LocalCanonicalLedger.open<LedgerRecord & Readonly<Record<string, unknown>>>(join(dataDirectory, "ledger", "records.json"));

const api = new PlatformApi({
  operational: async () => ({ healthy: true, ready: true, checks: { ledger: "up" } }),
  authenticate: (authorization) => authorization === `Bearer ${token}` ? { id: "user:local-operator" } : undefined,
  authorize: () => ({ allowed: true, rationale: "authenticated local operator" }),
  async ingest({ body }) {
    const object = asObject(body, "ingestion body");
    const records = Array.isArray(object.records) ? object.records : [object];
    const ids: string[] = [];
    for (const item of records) {
      const record = asLedgerRecord(item);
      await ledger.append(record);
      ids.push(record.id);
    }
    return { accepted: ids };
  },
  async state({ entityId, limit, cursor }) {
    const offset = cursor === undefined ? 0 : Number(cursor);
    const records = ledger.query().filter((record) => record.id === entityId || record.subject === entityId);
    const page = records.slice(offset, offset + limit);
    return { entityId, records: page, nextCursor: offset + page.length < records.length ? String(offset + page.length) : null };
  },
  async reconstruct({ body, principal, traceId }) {
    const object = asObject(body, "reconstruction body");
    const subject = typeof object.subject === "string" ? object.subject : undefined;
    const records = ledger.query().filter((record) => subject === undefined || record.id === subject || record.subject === subject);
    return { id: `reconstruction:${traceId.slice(traceId.indexOf(":") + 1)}`, request: object.request ?? "", principal, subjects: subject === undefined ? [] : [subject], currentState: records, provenanceManifest: records.map((record) => record.id), permissionContext: { allowed: true } };
  },
  async control({ action, principal, traceId, body }) {
    return { action, principal, traceId, accepted: true, proposal: body };
  },
});

const server = await api.listen({ hostname: process.env.WOYENGI_HOST ?? "0.0.0.0", port: Number(process.env.WOYENGI_PORT ?? 8080) });
process.stdout.write(`Woyengi Platform API listening on ${server.url}\n`);
let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`Received ${signal}; closing Platform API.\n`);
  await server.close();
  process.exitCode = 0;
}
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length < 16) throw new Error(`${name} must be set to at least 16 characters`);
  return value;
}
function asObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function asLedgerRecord(value: unknown): LedgerRecord & Readonly<Record<string, unknown>> {
  const object = asObject(value, "canonical record");
  if (typeof object.id !== "string" || typeof object.kind !== "string") throw new TypeError("canonical record requires string id and kind");
  const transactionTime = asObject(object.transactionTime, "transaction time");
  if (typeof transactionTime.from !== "string") throw new TypeError("canonical record requires transactionTime.from");
  return object as LedgerRecord & Readonly<Record<string, unknown>>;
}
