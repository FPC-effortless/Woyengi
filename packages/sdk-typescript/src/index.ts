import type { StateValue } from "../../core/src/index.ts";

export const HTTP_ROUTES = {
  ingest: { method: "POST", path: "/v1/ingest", idempotent: true },
  state: { method: "GET", path: "/v1/state/entities/{entityId}", paginated: true, query: ["validAt", "recordedAt"] },
  reconstruct: { method: "POST", path: "/v1/reconstruct" },
  control: { method: "POST", path: "/v1/control/{action}", idempotent: true },
  subscribe: { method: "GET", path: "/v1/subscriptions/{subscriptionId}", paginated: true },
} as const;

interface TransportResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export type PlatformTransport = (
  url: string,
  init: { readonly method: string; readonly headers: Record<string, string>; readonly body?: string },
) => Promise<TransportResponse>;

interface RequestOptions {
  readonly idempotencyKey?: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
}

export class PlatformClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #transport: PlatformTransport;
  readonly #retries: number;

  constructor(input: {
    readonly baseUrl: string;
    readonly token: string;
    readonly transport?: PlatformTransport;
    readonly retries?: number;
  }) {
    this.#baseUrl = input.baseUrl.replace(/\/+$/, "");
    this.#token = requiredText("token", input.token);
    this.#transport = input.transport ?? ((url, init) => fetch(url, init));
    this.#retries = input.retries ?? 2;
    if (!Number.isInteger(this.#retries) || this.#retries < 0) throw new RangeError("retries must be non-negative");
  }

  ingest(body: StateValue, options: { readonly idempotencyKey: string }): Promise<StateValue> {
    return this.#request(HTTP_ROUTES.ingest.method, HTTP_ROUTES.ingest.path, body, options);
  }

  state(entityId: string, options: { readonly limit?: number; readonly cursor?: string; readonly validAt?: string; readonly recordedAt?: string } = {}): Promise<StateValue> {
    const path = HTTP_ROUTES.state.path.replace("{entityId}", encodeURIComponent(entityId));
    return this.#request(HTTP_ROUTES.state.method, path, undefined, {
      query: { limit: options.limit, cursor: options.cursor, validAt: options.validAt, recordedAt: options.recordedAt },
    });
  }

  reconstruct(body: StateValue): Promise<StateValue> {
    return this.#request(HTTP_ROUTES.reconstruct.method, HTTP_ROUTES.reconstruct.path, body);
  }

  control(action: string, body: StateValue, options: { readonly idempotencyKey: string }): Promise<StateValue> {
    const path = HTTP_ROUTES.control.path.replace("{action}", encodeURIComponent(action));
    return this.#request(HTTP_ROUTES.control.method, path, body, options);
  }

  subscribe(
    subscriptionId: string,
    options: { readonly limit?: number; readonly cursor?: string } = {},
  ): Promise<StateValue> {
    const path = HTTP_ROUTES.subscribe.path.replace("{subscriptionId}", encodeURIComponent(subscriptionId));
    return this.#request(HTTP_ROUTES.subscribe.method, path, undefined, {
      query: { limit: options.limit, cursor: options.cursor },
    });
  }

  async #request(method: string, path: string, body?: StateValue, options: RequestOptions = {}): Promise<StateValue> {
    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#token}`,
      accept: "application/json",
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey !== undefined) headers["idempotency-key"] = options.idempotencyKey;
    const init = {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      try {
        const response = await this.#transport(url.toString(), init);
        const envelope = (await response.json()) as {
          readonly ok?: boolean;
          readonly data?: StateValue;
          readonly error?: { readonly code?: string; readonly message?: string };
        };
        if (response.status >= 500 && attempt < this.#retries) continue;
        if (response.status < 200 || response.status >= 300 || envelope.ok !== true) {
          throw new Error(`${envelope.error?.code ?? "HTTP_ERROR"}: ${envelope.error?.message ?? `HTTP ${response.status}`}`);
        }
        return envelope.data ?? null;
      } catch (error) {
        lastError = error;
        if (attempt >= this.#retries) throw error;
      }
    }
    throw lastError;
  }
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}
