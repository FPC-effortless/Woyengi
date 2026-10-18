import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type {
  ComputeNodeStatePort, HostedAuthorityRequest, HostedComputeNodeHeartbeat,
  HostedComputeNodeRegistration, HostedComputeObservation, HostedLeaseRequest,
} from "./index.ts";

interface NodeCredential {
  readonly nodeId: string;
  readonly token: string;
}

type Method = "register" | "heartbeat" | "lease" | "authorize" | "observations";

const allowedFields: Readonly<Record<Method, readonly string[]>> = {
  register: ["nodeId", "version", "workspaceIds", "capabilities", "budgetLimit", "heartbeatTtlMs", "registeredAt"],
  heartbeat: ["sessionId", "nodeId", "recordedAt"],
  lease: ["nodeId", "sessionId", "workspaceIds", "capabilities", "requestedAt"],
  authorize: ["operation", "nodeId", "providerId", "envelope"],
  observations: ["contract", "id", "executionId", "correlation", "nodeId", "sessionId",
    "leaseId", "providerId", "workloadId", "principalId", "authorityReference",
    "budget", "idempotencyKey", "expectedEffectId", "expectedEffectClass",
    "reconciliation", "status", "output", "usage", "startedAt", "finishedAt",
    "observationOnly", "acceptedTruth", "semanticMutation"],
};

function checkToken(token: string): void {
  if (typeof token !== "string" || token.length < 32 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new TypeError("compute bearer token must have at least 32 printable non-space characters");
  }
}

class TransportError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function responseJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function jsonRequest(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers["content-type"] !== "application/json") {
    throw new TransportError(415, "UNSUPPORTED_MEDIA_TYPE");
  }
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const part of req) {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
    total += buffer.length;
    if (total > 65_536) throw new TransportError(413, "PAYLOAD_TOO_LARGE");
    chunks.push(buffer);
  }
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new TransportError(400, "INVALID_JSON"); }
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new TransportError(400, "INVALID_BODY");
  }
  return decoded as Record<string, unknown>;
}

function bearer(req: IncomingMessage): string | undefined {
  if (req.rawHeaders.filter((name, i) => i % 2 === 0 && name.toLowerCase() === "authorization").length !== 1) {
    return undefined;
  }
  const value = req.headers.authorization;
  return typeof value === "string" && /^Bearer [^\s]+$/.test(value) ? value.slice(7) : undefined;
}

/**
 * Operator-provisioned HTTPS/loopback transport boundary for the existing
 * HostedComputeNodeRuntime state port. It is deliberately not itself a
 * workload authority or canonical receipt store: the injected state port
 * must issue leases, enforce capability grants, and persist observations.
 */
export class HostedComputeStateHttpApi {
  readonly #state: ComputeNodeStatePort;
  readonly #identities: readonly { readonly nodeId: string; readonly digest: Buffer }[];

  constructor(input: {
    readonly statePort: ComputeNodeStatePort;
    readonly credentials: readonly NodeCredential[];
  }) {
    this.#state = input.statePort;
    const digests = new Set<string>();
    this.#identities = input.credentials.map(({ nodeId, token }) => {
      if (!/^compute-node:[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(nodeId)) {
        throw new TypeError("compute node identity must be namespaced");
      }
      checkToken(token);
      const digest = createHash("sha256").update(token).digest();
      if (digests.has(digest.toString("hex"))) throw new TypeError("duplicate node credential");
      digests.add(digest.toString("hex"));
      return { nodeId, digest };
    });
  }

  async listen(input: { readonly hostname: "127.0.0.1" | "::1"; readonly port: number }): Promise<{
    readonly url: string;
    close(): Promise<void>;
  }> {
    const server = createServer((req, res) => { void this.#handle(req, res); });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(input.port, input.hostname, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    return {
      url: `http://${input.hostname === "::1" ? "[::1]" : input.hostname}:${address.port}`,
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      },
    };
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const token = bearer(req);
      if (token === undefined) throw new TransportError(401, "UNAUTHENTICATED");
      const digest = createHash("sha256").update(token).digest();
      let nodeId: string | undefined;
      for (const entry of this.#identities) {
        if (timingSafeEqual(digest, entry.digest)) nodeId = entry.nodeId;
      }
      if (!nodeId) throw new TransportError(401, "UNAUTHENTICATED");

      const url = new URL(req.url ?? "/", "http://localhost");
      const prefix = "/v1/compute/";
      const method = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
      if (req.method !== "POST" || url.search || url.hash || !Object.hasOwn(allowedFields, method)) {
        throw new TransportError(404, "NOT_FOUND");
      }
      const route = method as Method;
      const value = await jsonRequest(req);
      if (Object.keys(value).some(field => !allowedFields[route].includes(field))
        || allowedFields[route].filter(field => field !== "output").some(field => !Object.hasOwn(value, field))) {
        throw new TransportError(400, "INVALID_BODY");
      }
      if (value.nodeId !== nodeId) throw new TransportError(403, "NODE_SCOPE_DENIED");

      let result: unknown;
      switch (route) {
        case "register": result = await this.#state.register(value as unknown as HostedComputeNodeRegistration); break;
        case "heartbeat": result = await this.#state.heartbeat(value as unknown as HostedComputeNodeHeartbeat); break;
        case "lease": result = await this.#state.nextLease(value as unknown as HostedLeaseRequest); break;
        case "authorize": result = await this.#state.authorize(value as unknown as HostedAuthorityRequest); break;
        case "observations":
          await this.#state.publishObservation(value as unknown as HostedComputeObservation);
          result = null;
          break;
      }
      responseJson(res, 200, { ok: true, data: result ?? null });
    } catch (error) {
      const known = error instanceof TransportError;
      responseJson(res, known ? error.status : 500,
        { ok: false, error: { code: known ? error.code : "STATE_PORT_FAILED" } });
    }
  }
}

/**
 * Remote compute-node adapter. Requires HTTPS for nonloopback destinations:
 * external TLS and node credential issuance remain deployment responsibilities.
 * Token and request data are never sent in a query string.
 */
export class HttpComputeNodeStatePort implements ComputeNodeStatePort {
  readonly #origin: string;
  readonly #token: string;
  readonly #timeoutMs: number;

  constructor(input: {
    readonly baseUrl: string;
    readonly nodeToken: string;
    readonly timeoutMs?: number;
  }) {
    const url = new URL(input.baseUrl);
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password
      || (url.protocol !== "https:" && !(url.protocol === "http:"
        && (url.hostname === "127.0.0.1" || url.hostname === "[::1]")))) {
      throw new TypeError("compute state URL must use HTTPS or loopback HTTP without credentials");
    }
    checkToken(input.nodeToken);
    const timeout = input.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 60_000) {
      throw new RangeError("compute transport timeout out of range");
    }
    this.#origin = url.origin;
    this.#token = input.nodeToken;
    this.#timeoutMs = timeout;
  }

  async register(value: HostedComputeNodeRegistration) {
    return this.#post<Awaited<ReturnType<ComputeNodeStatePort["register"]>>>("register", value);
  }

  async heartbeat(value: HostedComputeNodeHeartbeat) {
    return this.#post<Awaited<ReturnType<ComputeNodeStatePort["heartbeat"]>>>("heartbeat", value);
  }

  async nextLease(value: HostedLeaseRequest) {
    return this.#post<Awaited<ReturnType<ComputeNodeStatePort["nextLease"]>>>("lease", value);
  }

  async authorize(value: HostedAuthorityRequest) {
    return this.#post<Awaited<ReturnType<ComputeNodeStatePort["authorize"]>>>("authorize", value);
  }

  async publishObservation(value: HostedComputeObservation): Promise<void> {
    await this.#post<null>("observations", value);
  }

  async #post<Result>(route: Method, body: unknown): Promise<Result> {
    const response = await fetch(this.#origin + "/v1/compute/" + route, {
      method: "POST",
      headers: {
        authorization: "Bearer " + this.#token,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.#timeoutMs),
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error(`compute state transport request denied: ${route} HTTP ${response.status}`);
    }
    const envelope: unknown = await response.json();
    if (!envelope || typeof envelope !== "object" || !("ok" in envelope)
      || envelope.ok !== true || !("data" in envelope)) {
      throw new Error("invalid compute state transport response");
    }
    return envelope.data as Result;
  }
}
