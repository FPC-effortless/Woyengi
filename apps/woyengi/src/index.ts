import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname } from "node:path";

export interface ShellSnapshot {
  readonly principal: { readonly id: string; readonly name: string; readonly initials: string };
  readonly activeWorkspaceId: string;
  readonly workspaces: readonly { readonly id: string; readonly name: string; readonly kind: "personal" | "organization" }[];
  readonly focus: {
    readonly greeting: string;
    readonly summary: string;
    readonly activeWork: number;
    readonly waiting: number;
    readonly completedThisWeek: number;
  };
  readonly work: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: "In progress" | "Waiting" | "Ready";
    readonly progress: number;
    readonly collaborator: string;
    readonly updated: string;
  }[];
  readonly apps: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly accent: "coral" | "violet" | "blue" | "green";
  }[];
  readonly inbox: readonly {
    readonly id: string;
    readonly title: string;
    readonly source: string;
    readonly age: string;
    readonly unread: boolean;
  }[];
}

export interface ShellPorts {
  readonly loadSnapshot: (workspaceId?: string) => Promise<ShellSnapshot>;
}

const publicRoot = new URL("../public/", import.meta.url);
const allowedAssets = /^(?:index\.html|styles\.css|app\.js)$/;

export class WoyengiShell {
  readonly #ports: ShellPorts;

  constructor(ports: ShellPorts) {
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
      const url = new URL(request.url ?? "/", "http://woyengi.local");
      if (request.method === "GET" && url.pathname === "/api/shell") {
        const workspaceId = url.searchParams.get("workspace") ?? undefined;
        if (workspaceId !== undefined && !/^workspace:[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(workspaceId)) {
          return json(response, 400, { error: { code: "INVALID_WORKSPACE", message: "Workspace identifiers must be namespace-qualified." } });
        }
        return json(response, 200, { data: await this.#ports.loadSnapshot(workspaceId) });
      }
      if (request.method !== "GET") return json(response, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
      const asset = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!allowedAssets.test(asset)) return json(response, 404, { error: { code: "NOT_FOUND" } });
      const bytes = await readFile(new URL(asset, publicRoot));
      response.writeHead(200, securityHeaders(contentType(asset)));
      response.end(bytes);
    } catch {
      json(response, 500, { error: { code: "INTERNAL_ERROR", message: "The Woyengi shell could not load." } });
    }
  }
}

function contentType(path: string): string {
  const values: Readonly<Record<string, string>> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
  };
  return values[extname(path)] ?? "application/octet-stream";
}

function securityHeaders(contentTypeValue: string): Record<string, string> {
  return {
    "content-type": contentTypeValue,
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { ...securityHeaders("application/json; charset=utf-8"), "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
