import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  DurableWorkJournal,
  DurableWorkspaceJournal,
} from "../../durable-work/index.ts";
import type { Principal } from "../../../packages/workspace/src/index.ts";
import type { WorkValue } from "../../../packages/work/src/index.ts";

interface Credential {
  readonly principalId: string;
  readonly token: string;
  readonly expiresAt?: string;
}

interface BoundSession {
  readonly principalId: string;
  readonly digest: Buffer;
  readonly expiresAt?: number;
}

/**
 * Operator-provisioned, ephemeral bearer sessions. Never accepts a principal
 * claim from the request body as identity. The caller must provision credentials
 * over a separate trusted channel; this service does not issue credentials.
 */
export class BoundPrincipalSessions {
  readonly #sessions: BoundSession[];
  readonly #now: () => number;

  constructor(credentials: readonly Credential[], input: { readonly now?: () => number } = {}) {
    this.#now = input.now ?? Date.now;
    const digests = new Set<string>();
    this.#sessions = credentials.map((credential) => {
      if (!/^principal:[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(credential.principalId)) {
        throw new TypeError("session principalId must be a namespaced principal id");
      }
      if (credential.token.length < 32 || !/^[\x21-\x7E]+$/.test(credential.token)) {
        throw new TypeError("session bearer token must have at least 32 printable non-space characters");
      }
      const digest = createHash("sha256").update(credential.token, "utf8").digest();
      const hex = digest.toString("hex");
      if (digests.has(hex)) throw new Error("duplicate bearer session token");
      digests.add(hex);
      const expiresAt = credential.expiresAt === undefined ? undefined : Date.parse(credential.expiresAt);
      if (expiresAt !== undefined && !Number.isFinite(expiresAt)) throw new TypeError("invalid session expiresAt");
      return { principalId: credential.principalId, digest, ...(expiresAt === undefined ? {} : { expiresAt }) };
    });
  }

  resolve(authorization: string | undefined): { readonly id: string } | undefined {
    if (authorization === undefined || !/^Bearer [^\s]+$/.test(authorization)) return undefined;
    const token = authorization.slice(7);
    const supplied = createHash("sha256").update(token, "utf8").digest();
    let principal: string | undefined;
    for (const session of this.#sessions) {
      const matches = timingSafeEqual(supplied, session.digest);
      if (matches && (session.expiresAt === undefined || this.#now() < session.expiresAt)) {
        principal = session.principalId;
      }
    }
    return principal === undefined ? undefined : { id: principal };
  }

  /** Trusted local operator action. Revocation is ephemeral until re-provisioning. */
  revokePrincipal(principalId: string): void {
    for (let index = this.#sessions.length - 1; index >= 0; index -= 1) {
      if (this.#sessions[index]?.principalId === principalId) this.#sessions.splice(index, 1);
    }
  }
}

export interface SelfHostWorkApiInput {
  readonly workspaces: DurableWorkspaceJournal;
  readonly work: DurableWorkJournal;
  readonly sessions: BoundPrincipalSessions;
  readonly now?: () => Date;
}

/**
 * Loopback-only HTTP adapter for durable Work. This does not establish a
 * production principal/session provider, Postgres or realtime multiplayer.
 * Tokens must be provisioned by a trusted operator, never over HTTP.
 */
export class SelfHostWorkApi {
  readonly #workspaces: DurableWorkspaceJournal;
  readonly #work: DurableWorkJournal;
  readonly #sessions: BoundPrincipalSessions;
  readonly #now: () => Date;

  constructor(input: SelfHostWorkApiInput) {
    this.#workspaces = input.workspaces;
    this.#work = input.work;
    this.#sessions = input.sessions;
    this.#now = input.now ?? (() => new Date());
  }

  async listen(input: { readonly hostname: "127.0.0.1" | "::1"; readonly port: number }): Promise<{
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
      url: `http://${input.hostname === "::1" ? "[::1]" : "127.0.0.1"}:${address.port}`,
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      },
    };
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const authorization = singleHeader(request, "authorization");
      const principal = this.#sessions.resolve(authorization);
      if (principal === undefined) throw new ApiError(401, "UNAUTHENTICATED");
      const path = new URL(request.url ?? "/", "http://localhost").pathname.split("/").slice(1).map(segment);
      if (path.length < 3 || path[0] !== "v1" || path[1] !== "workspaces") {
        throw new ApiError(404, "NOT_FOUND");
      }
      const workspaceId = path[2];
      if (!workspaceId?.startsWith("workspace:")) throw new ApiError(404, "NOT_FOUND");
      const method = request.method ?? "GET";

      if (method === "GET" && path.length === 3) {
        const workspace = this.#workspaces.workspaceFor({ principalId: principal.id, workspaceId });
        reply(response, 200, { workspace });
        return;
      }

      if (method === "POST" && path.length === 4 && path[3] === "work") {
        const body = objectBody(await readJson(request), ["id", "intent", "participants", "roles", "context"]);
        const id = stringField(body, "id");
        const intent = stringField(body, "intent");
        const memberIds = stringArray(body.participants, "participants");
        const roles = rolesField(body.roles);
        const context = contextField(body.context);
        const registry = this.#workspaces.snapshot();
        registry.workspaceFor({ principalId: principal.id, workspaceId });
        const participants = memberIds.map((id): Principal => {
          const registration = registry.history().find((operation) =>
            operation.kind === "principal.registered" && operation.principal.id === id
          );
          if (registration?.kind !== "principal.registered") throw new ApiError(400, "INVALID_PARTICIPANT");
          return registration.principal;
        });
        const work = await this.#work.createWorkInstance({
          operationId: operationId(request, principal.id),
          id, workspaceId, intent, createdByPrincipalId: principal.id,
          participants, roles, context, recordedAt: this.#now().toISOString(),
        });
        reply(response, 201, { work });
        return;
      }

      const instanceId = path.length >= 5 && path[3] === "work" ? path[4] : undefined;
      if (instanceId === undefined || !instanceId.startsWith("work-instance:")) {
        throw new ApiError(404, "NOT_FOUND");
      }
      if (method === "GET" && path.length === 5) {
        reply(response, 200, { work: this.#work.workInstance({ principalId: principal.id, workspaceId, id: instanceId }) });
        return;
      }
      if (method === "GET" && path.length === 6 && path[5] === "history") {
        // Require specific Work participation, not workspace membership alone.
        this.#work.workInstance({ principalId: principal.id, workspaceId, id: instanceId });
        const operations = this.#work.history({ principalId: principal.id, workspaceId })
          .filter((operation) => operation.workInstanceId === instanceId);
        reply(response, 200, { operations });
        return;
      }
      if (method === "POST" && path.length === 6 && path[5] === "episodes") {
        // Authenticate and authorize the actor before parsing any mutable input.
        this.#work.workInstance({ principalId: principal.id, workspaceId, id: instanceId });
        const body = objectBody(await readJson(request), ["id", "objective", "expectedVersion", "context"]);
        const expectedVersion = body.expectedVersion;
        if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1) {
          throw new ApiError(400, "INVALID_VERSION");
        }
        const episode = await this.#work.startEpisode({
          operationId: operationId(request, principal.id),
          id: stringField(body, "id"),
          objective: stringField(body, "objective"),
          workspaceId,
          workInstanceId: instanceId,
          expectedVersion: expectedVersion as number,
          actorPrincipalId: principal.id,
          context: contextField(body.context),
          recordedAt: this.#now().toISOString(),
        });
        reply(response, 201, { episode });
        return;
      }
      throw new ApiError(404, "NOT_FOUND");
    } catch (error) {
      const failure = publicError(error);
      if (!response.headersSent) reply(response, failure.status, undefined, failure.code);
    }
  }
}

class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function publicError(error: unknown): { readonly status: number; readonly code: string } {
  if (error instanceof ApiError) return error;
  if (error instanceof SyntaxError || error instanceof TypeError) return { status: 400, code: "INVALID_REQUEST" };
  if (error instanceof Error) {
    if (/workspace access denied|Work participant access denied|requires explicit delegated capability/i.test(error.message)) {
      return { status: 403, code: "FORBIDDEN" };
    }
    if (/does not exist|outside workspace/i.test(error.message)) return { status: 404, code: "NOT_FOUND" };
    if (/already exists|already used|version|duplicate|already.*operation/i.test(error.message)) {
      return { status: 409, code: "CONFLICT" };
    }
    if (/must|invalid|participant|authorization/i.test(error.message)) return { status: 400, code: "INVALID_REQUEST" };
  }
  return { status: 500, code: "INTERNAL_ERROR" };
}

function segment(raw: string): string {
  try {
    const value = decodeURIComponent(raw);
    if (!value || value.includes("/") || value.includes("\u0000")) throw new ApiError(404, "NOT_FOUND");
    return value;
  } catch {
    throw new ApiError(404, "NOT_FOUND");
  }
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const count = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length;
  if (count !== 1) return undefined;
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function operationId(request: IncomingMessage, principalId: string): string {
  const key = singleHeader(request, "idempotency-key");
  if (key === undefined || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) {
    throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY");
  }
  // Duplicates conflict rather than re-execute. Response replay is not yet supported.
  return `work-operation:${principalId}:${key}`;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = singleHeader(request, "content-type");
  if (contentType === undefined || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let exceeded = false;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 65536) exceeded = true;
    if (!exceeded) chunks.push(bytes);
  }
  if (exceeded) throw new ApiError(413, "PAYLOAD_TOO_LARGE");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON");
  }
}

function objectBody(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "INVALID_BODY");
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) if (!keys.includes(key)) throw new ApiError(400, "UNKNOWN_FIELD");
  for (const key of keys) if (!Object.hasOwn(object, key)) throw new ApiError(400, "MISSING_FIELD");
  return object;
}

function stringField(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2048) {
    throw new ApiError(400, "INVALID_FIELD");
  }
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((part) => typeof part !== "string" || !part)) {
    throw new ApiError(400, `INVALID_${field.toUpperCase()}`);
  }
  return value as string[];
}

function rolesField(value: unknown): {
  readonly workOwners: string[];
  readonly decisionAuthorities: string[];
  readonly reviewers: string[];
  readonly approvers: string[];
} {
  const roles = objectBody(value, ["workOwners", "decisionAuthorities", "reviewers", "approvers"]);
  return {
    workOwners: stringArray(roles.workOwners, "workOwners"),
    decisionAuthorities: stringArray(roles.decisionAuthorities, "decisionAuthorities"),
    reviewers: stringArray(roles.reviewers, "reviewers"),
    approvers: stringArray(roles.approvers, "approvers"),
  };
}

function contextField(value: unknown): Record<string, WorkValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "INVALID_CONTEXT");
  return value as Record<string, WorkValue>;
}

function reply(response: ServerResponse, status: number, data?: unknown, code?: string): void {
  const body = JSON.stringify(code === undefined ? { ok: true, data } : { ok: false, error: { code } });
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
}
