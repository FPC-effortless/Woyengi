import { createHash, timingSafeEqual } from "node:crypto";

export function createBearerAuthenticator(input: { readonly token: string; readonly principal: string }): (authorization: string | undefined) => { readonly id: string } | undefined {
  const token = requiredText("bearer token", input.token);
  if (token.length < 16) throw new TypeError("bearer token must contain at least 16 characters");
  const principal = namespaced("principal", input.principal);
  const expected = digest(token);
  return (authorization) => {
    if (authorization === undefined || !authorization.startsWith("Bearer ")) return undefined;
    const supplied = digest(authorization.slice("Bearer ".length));
    return timingSafeEqual(expected, supplied) ? { id: principal } : undefined;
  };
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  readonly #maximumRequests: number;
  readonly #windowMilliseconds: number;
  readonly #maximumKeys: number;
  readonly #requests = new Map<string, number[]>();

  constructor(input: { readonly maximumRequests: number; readonly windowMilliseconds: number; readonly maximumKeys: number }) {
    this.#maximumRequests = positiveInteger("maximum requests", input.maximumRequests);
    this.#windowMilliseconds = positiveInteger("window milliseconds", input.windowMilliseconds);
    this.#maximumKeys = positiveInteger("maximum keys", input.maximumKeys);
  }

  allow(input: { readonly key: string; readonly at: string }): RateLimitDecision {
    const key = requiredText("rate-limit key", input.key);
    const now = normalizeInstant(input.at).getTime();
    if (!this.#requests.has(key) && this.#requests.size >= this.#maximumKeys) this.#evictOldest();
    const cutoff = now - this.#windowMilliseconds;
    const requests = (this.#requests.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (requests.length >= this.#maximumRequests) {
      this.#requests.set(key, requests);
      return Object.freeze({ allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(((requests[0] as number) + this.#windowMilliseconds - now) / 1_000)) });
    }
    requests.push(now);
    this.#requests.set(key, requests);
    return Object.freeze({ allowed: true, retryAfterSeconds: 0 });
  }

  #evictOldest(): void {
    const oldest = [...this.#requests.entries()].sort((left, right) => ((left[1].at(-1) ?? 0) - (right[1].at(-1) ?? 0)) || left[0].localeCompare(right[0]))[0];
    if (oldest !== undefined) this.#requests.delete(oldest[0]);
  }
}

function digest(value: string): Buffer { return createHash("sha256").update(value, "utf8").digest(); }
function positiveInteger(name: string, value: number): number { if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`); return value; }
function normalizeInstant(value: string): Date { if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`); const date = new Date(value); if (Number.isNaN(date.getTime())) throw new TypeError(`invalid timestamp: ${value}`); return date; }
function namespaced(name: string, value: string): string { const normalized = requiredText(name, value); if (!normalized.includes(":")) throw new TypeError(`${name} must be namespace-qualified`); return normalized; }
function requiredText(name: string, value: string): string { const normalized = value.trim(); if (normalized.length === 0) throw new TypeError(`${name} must not be empty`); return normalized; }
