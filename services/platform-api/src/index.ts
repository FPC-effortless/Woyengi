import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { StateValue } from "../../../packages/core/src/index.ts";
import type { CapabilityOperation } from "../../../packages/permissions/src/index.ts";

export interface PlatformApiPorts {
  readonly operational?: () => Promise<{ readonly healthy: boolean; readonly ready: boolean; readonly checks: Readonly<Record<string, "up" | "down">> }>;
  readonly rateLimit?: (input: { readonly key: string; readonly at: string }) => { readonly allowed: boolean; readonly retryAfterSeconds: number };
  readonly authenticate: (authorization: string | undefined) => { readonly id: string } | undefined;
  readonly authorize: (input: {
    readonly principal: string;
    readonly operation: CapabilityOperation;
    readonly resourceId: string;
    readonly purpose: string;
  }) => { readonly allowed: boolean; readonly rationale: string };
  readonly ingest: (input: {
    readonly principal: string;
    readonly idempotencyKey: string;
    readonly body: StateValue;
    readonly traceId: string;
  }) => Promise<StateValue>;
  readonly state: (input: {
    readonly principal: string;
    readonly entityId: string;
    readonly limit: number;
    readonly cursor?: string;
    readonly validAt: string;
    readonly recordedAt: string;
    readonly traceId: string;
  }) => Promise<StateValue>;
  readonly reconstruct: (input: {
    readonly principal: string;
    readonly body: StateValue;
    readonly traceId: string;
  }) => Promise<StateValue>;
  readonly control: (input: {
    readonly principal: string;
    readonly action: string;
    readonly idempotencyKey: string;
    readonly body: StateValue;
    readonly traceId: string;
  }) => Promise<StateValue>;
  readonly subscribe: (input: {
    readonly principal: string;
    readonly subscriptionId: string;
    readonly limit: number;
    readonly cursor?: string;
    readonly traceId: string;
  }) => Promise<StateValue>;
}

export class PlatformApi {
  readonly #ports: PlatformApiPorts;

  constructor(ports: PlatformApiPorts) {
    this.#ports = ports;
  }

  async listen(input: { readonly hostname: string; readonly port: number }): Promise<{
    readonly url: string;
    close(): Promise<void>;
  }> {
    const server = createServer((request, response) => {
      void this.#handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(input.port, input.hostname, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    return {
      url: `http://${input.hostname}:${address.port}`,
      close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    };
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const traceId = trace(request.headers["x-trace-id"]);
    try {
      const operational = matchOperationalRoute(request.method ?? "GET", request.url ?? "/");
      if (operational !== undefined) {
        const status = await (this.#ports.operational?.() ?? Promise.resolve({ healthy: true, ready: true, checks: {} }));
        const available = operational === "health" ? status.healthy : status.ready;
        send(response, available ? 200 : 503, { ok: available, data: { status: available ? "up" : "down", checks: status.checks }, meta: { traceId } });
        return;
      }
      const rateLimit = this.#ports.rateLimit?.({ key: request.socket.remoteAddress ?? "unknown", at: new Date().toISOString() });
      if (rateLimit !== undefined && !rateLimit.allowed) throw new PlatformApiError(429, "RATE_LIMITED", `Request rate exceeded; retry after ${rateLimit.retryAfterSeconds} seconds.`);
      const principal = this.#ports.authenticate(singleHeader(request.headers.authorization));
      if (principal === undefined) throw new PlatformApiError(401, "UNAUTHENTICATED", "A valid principal credential is required.");
      const url = new URL(request.url ?? "/", "http://platform.local");
      const route = matchRoute(request.method ?? "GET", url.pathname);
      const purpose = singleHeader(request.headers["x-purpose"]) ?? "platform-api";
      const permission = this.#ports.authorize({
        principal: principal.id,
        operation: route.operation,
        resourceId: route.resourceId,
        purpose,
      });
      if (!permission.allowed) throw new PlatformApiError(403, "FORBIDDEN", permission.rationale);

      let data: StateValue;
      if (route.family === "ingest") {
        data = await this.#ports.ingest({
          principal: principal.id,
          idempotencyKey: requiredIdempotency(request),
          body: await readJson(request),
          traceId,
        });
      } else if (route.family === "state") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const now = new Date().toISOString();
        const validAt = parseInstant(url.searchParams.get("validAt"), "validAt") ?? now;
        const recordedAt = parseInstant(url.searchParams.get("recordedAt"), "recordedAt") ?? now;
        data = await this.#ports.state({
          principal: principal.id,
          entityId: route.entityId,
          limit,
          ...(cursor === undefined ? {} : { cursor }),
          validAt,
          recordedAt,
          traceId,
        });
      } else if (route.family === "reconstruct") {
        data = await this.#ports.reconstruct({
          principal: principal.id,
          body: await readJson(request),
          traceId,
        });
      } else if (route.family === "control") {
        data = await this.#ports.control({
          principal: principal.id,
          action: route.action,
          idempotencyKey: requiredIdempotency(request),
          body: await readJson(request),
          traceId,
        });
      } else {
        const limit = parseLimit(url.searchParams.get("limit"));
        const cursor = url.searchParams.get("cursor") ?? undefined;
        data = await this.#ports.subscribe({
          principal: principal.id,
          subscriptionId: route.subscriptionId,
          limit,
          ...(cursor === undefined ? {} : { cursor }),
          traceId,
        });
      }
      send(response, 200, { ok: true, data, meta: { traceId } });
    } catch (error) {
      const apiError = error instanceof PlatformApiError ? error : new PlatformApiError(500, "INTERNAL_ERROR", "Request failed.");
      send(response, apiError.status, {
        ok: false,
        error: { code: apiError.code, message: apiError.message },
        meta: { traceId },
      });
    }
  }
}

function matchOperationalRoute(method: string, rawUrl: string): "health" | "readiness" | undefined {
  if (method !== "GET") return undefined;
  const pathname = new URL(rawUrl, "http://platform.local").pathname;
  return pathname === "/healthz" ? "health" : pathname === "/readyz" ? "readiness" : undefined;
}

type Route =
  | { readonly family: "ingest"; readonly operation: "CREATE"; readonly resourceId: "ingestion" }
  | { readonly family: "state"; readonly operation: "READ"; readonly resourceId: string; readonly entityId: string }
  | { readonly family: "reconstruct"; readonly operation: "RECONSTRUCT"; readonly resourceId: "reconstruction" }
  | { readonly family: "control"; readonly operation: CapabilityOperation; readonly resourceId: string; readonly action: string }
  | { readonly family: "subscribe"; readonly operation: "SUBSCRIBE"; readonly resourceId: string; readonly subscriptionId: string };

function matchRoute(method: string, pathname: string): Route {
  if (method === "POST" && pathname === "/v1/ingest") {
    return { family: "ingest", operation: "CREATE", resourceId: "ingestion" };
  }
  const state = /^\/v1\/state\/entities\/([^/]+)$/.exec(pathname);
  if (method === "GET" && state !== null) {
    const entityId = decodeURIComponent(state[1] as string);
    return { family: "state", operation: "READ", resourceId: entityId, entityId };
  }
  if (method === "POST" && pathname === "/v1/reconstruct") {
    return { family: "reconstruct", operation: "RECONSTRUCT", resourceId: "reconstruction" };
  }
  const control = /^\/v1\/control\/([a-z-]+)$/.exec(pathname);
  if (method === "POST" && control !== null) {
    const action = control[1] as string;
    const operation = controlOperation(action);
    return { family: "control", operation, resourceId: `control:${action}`, action };
  }
  const subscription = /^\/v1\/subscriptions\/([^/]+)$/.exec(pathname);
  if (method === "GET" && subscription !== null) {
    const subscriptionId = decodeURIComponent(subscription[1] as string);
    if (!subscriptionId.startsWith("subscription:")) throw new PlatformApiError(400, "INVALID_SUBSCRIPTION", "subscriptionId must start with subscription:.");
    return { family: "subscribe", operation: "SUBSCRIBE", resourceId: subscriptionId, subscriptionId };
  }
  throw new PlatformApiError(404, "NOT_FOUND", "Route not found.");
}

function controlOperation(action: string): CapabilityOperation {
  const values: Readonly<Record<string, CapabilityOperation>> = {
    authorize: "READ",
    verify: "VERIFY",
    supersede: "SUPERSEDE",
    retract: "RETRACT",
    execute: "EXECUTE",
    subscribe: "SUBSCRIBE",
  };
  const operation = values[action];
  if (operation === undefined) throw new PlatformApiError(404, "NOT_FOUND", "Control action not found.");
  return operation;
}

async function readJson(request: IncomingMessage): Promise<StateValue> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    size += bytes.byteLength;
    if (size > 1_048_576) throw new PlatformApiError(413, "PAYLOAD_TOO_LARGE", "JSON body exceeds 1 MiB.");
    chunks.push(bytes);
  }
  try {
    const bytes = Buffer.concat(chunks);
    return JSON.parse(bytes.toString("utf8")) as StateValue;
  } catch {
    throw new PlatformApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function parseLimit(value: string | null): number {
  if (value === null) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new PlatformApiError(400, "INVALID_PAGINATION", "limit must be an integer from 1 through 100.");
  }
  return parsed;
}

function parseInstant(value: string | null, name: string): string | undefined {
  if (value === null) return undefined;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new PlatformApiError(400, "INVALID_TIME", `${name} requires an explicit UTC offset.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new PlatformApiError(400, "INVALID_TIME", `${name} must be a valid timestamp.`);
  return date.toISOString();
}

function requiredIdempotency(request: IncomingMessage): string {
  const value = singleHeader(request.headers["idempotency-key"]);
  if (value === undefined || value.trim().length === 0) {
    throw new PlatformApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for this operation.");
  }
  return value.trim();
}

function trace(value: string | string[] | undefined): string {
  const header = singleHeader(value);
  return header === undefined || header.trim().length === 0 ? `trace:${randomUUID()}` : header.trim();
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload), "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
  response.end(payload);
}

export class PlatformApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
