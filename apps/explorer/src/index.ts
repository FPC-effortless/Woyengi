import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname } from "node:path";

export interface ExplorerEntityView {
  readonly entity: { readonly id: string; readonly name: string; readonly type: string; readonly lifecycle: string };
  readonly summary: { readonly claims: number; readonly relationships: number; readonly conflicts: number; readonly evidenceCoverage: number };
  readonly currentState: readonly { readonly predicate: string; readonly value: string; readonly authority: string; readonly validFrom: string }[];
  readonly events: readonly { readonly id: string; readonly title: string; readonly at: string; readonly kind: string }[];
  readonly relationships: readonly { readonly predicate: string; readonly target: string; readonly targetId: string }[];
  readonly history: readonly { readonly title: string; readonly detail: string; readonly at: string }[];
  readonly evidence: readonly { readonly id: string; readonly label: string; readonly status: string }[];
  readonly provenance: readonly { readonly id: string; readonly label: string; readonly status: string }[];
  readonly authority: readonly { readonly source: string; readonly level: number; readonly basis: string }[];
  readonly conflicts: readonly { readonly id: string; readonly label: string; readonly status: string }[];
  readonly neighborhood: readonly { readonly id: string; readonly label: string; readonly relation: string; readonly graph: string }[];
  readonly reconstructions: readonly { readonly id: string; readonly request: string; readonly status: string; readonly objectCount: number }[];
  readonly trace: readonly { readonly stage: string; readonly detail: string; readonly result: string }[];
}

export interface ExplorerPorts {
  readonly authorize: (input: { readonly authorization?: string; readonly cookie?: string; readonly remoteAddress: string }) => boolean;
  readonly loadEntity: (id: string) => Promise<ExplorerEntityView | undefined>;
}

const publicRoot = new URL("../public/", import.meta.url);

export class ExplorerApp {
  readonly #ports: ExplorerPorts;

  constructor(ports: ExplorerPorts) {
    this.#ports = ports;
  }

  async listen(input: { readonly hostname: string; readonly port: number }): Promise<{ readonly url: string; close(): Promise<void> }> {
    const server = createServer((request, response) => { void this.#handle(request, response); });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(input.port, input.hostname, () => { server.off("error", reject); resolve(); });
    });
    const address = server.address() as AddressInfo;
    return {
      url: `http://${input.hostname}:${address.port}`,
      close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    };
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://explorer.local");
      const entityMatch = /^\/api\/entities\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && entityMatch !== null) {
        const authorization = singleHeader(request.headers.authorization);
        const cookie = singleHeader(request.headers.cookie);
        const allowed = this.#ports.authorize({ ...(authorization === undefined ? {} : { authorization }), ...(cookie === undefined ? {} : { cookie }), remoteAddress: request.socket.remoteAddress ?? "unknown" });
        if (!allowed) return json(response, 401, { error: { code: "UNAUTHENTICATED", message: "An authorized Explorer session is required." } });
        const entity = await this.#ports.loadEntity(decodeURIComponent(entityMatch[1] as string));
        if (entity === undefined) return json(response, 404, { error: { code: "NOT_FOUND", message: "Entity was not found." } });
        return json(response, 200, { data: entity });
      }
      if (request.method !== "GET") return json(response, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
      const asset = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!/^(?:index\.html|styles\.css|app\.js)$/.test(asset)) return json(response, 404, { error: { code: "NOT_FOUND" } });
      const bytes = await readFile(new URL(asset, publicRoot));
      response.writeHead(200, securityHeaders(contentType(asset)));
      response.end(bytes);
    } catch {
      json(response, 500, { error: { code: "INTERNAL_ERROR", message: "Explorer request failed." } });
    }
  }
}

function singleHeader(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

function contentType(path: string): string {
  const values: Readonly<Record<string, string>> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
  return values[extname(path)] ?? "application/octet-stream";
}

function securityHeaders(contentTypeValue: string): Record<string, string> {
  return {
    "content-type": contentTypeValue,
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, securityHeaders("application/json; charset=utf-8"));
  response.end(JSON.stringify(body));
}
