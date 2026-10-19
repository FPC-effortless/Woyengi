import { createHash, timingSafeEqual } from "node:crypto";

import type { LedgerRecord } from "../../../packages/ledger/src/index.ts";
import { PostgresCanonicalLedger, type PostgresPool } from "./index.ts";
import type { PostgresWorkspaceJournal } from "./workspace.ts";

export interface PostgresSessionIssued extends LedgerRecord {
  readonly kind: "session.issued";
  readonly sessionId: string;
  readonly principalId: string;
  readonly tokenDigest: string;
  readonly expiresAt: string;
  readonly transactionTime: { readonly from: string };
}
export interface PostgresSessionRevoked extends LedgerRecord {
  readonly kind: "session.revoked";
  readonly sessionId: string;
  readonly transactionTime: { readonly from: string };
}
export type PostgresSessionOperation = PostgresSessionIssued | PostgresSessionRevoked;

interface SessionProjection {
  readonly principalId: string;
  readonly tokenDigest: string;
  readonly expiresAt: number;
  revoked: boolean;
}

function identifier(name: string, value: string, prefix: string): string {
  if (typeof value !== "string" || !value.startsWith(prefix)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.slice(prefix.length))) {
    throw new TypeError(`${name} must be a namespaced ${prefix} identifier`);
  }
  return value;
}

function timestamp(name: string, value: string): number {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`${name} requires an explicit UTC offset`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} is not a valid timestamp`);
  return parsed;
}

function digest(token: string): string {
  if (typeof token !== "string" || token.length < 32 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new TypeError("session bearer token must have at least 32 printable non-space characters");
  }
  return "sha256:" + createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Fail closed if canonical history has an unknown kind, field, bad sequence,
 * reused digest or ID, or a revocation of a missing/already revoked session.
 * Unlike cached session sets, this is reconstructed from PostgreSQL at every
 * authorization decision.
 */
function replay(operations: readonly PostgresSessionOperation[]): Map<string, SessionProjection> {
  const sessions = new Map<string, SessionProjection>();
  const digests = new Set<string>();
  const operationsSeen = new Set<string>();
  let last = 0;
  for (const op of operations) {
    const keys = op.kind === "session.issued"
      ? ["id", "kind", "ledgerSequence", "transactionTime", "sessionId", "principalId", "tokenDigest", "expiresAt"]
      : op.kind === "session.revoked"
        ? ["id", "kind", "ledgerSequence", "transactionTime", "sessionId"]
        : undefined;
    if (!keys) throw new TypeError(`unsupported session operation kind: ${op.kind}`);
    if (Object.keys(op).some(key => !keys.includes(key))) {
      throw new TypeError("unknown session operation field");
    }
    identifier("session operation", op.id, "session-operation:");
    identifier("session", op.sessionId, "session:");
    if (operationsSeen.has(op.id)) throw new Error("duplicate session operation id");
    operationsSeen.add(op.id);
    if (!Number.isSafeInteger(op.ledgerSequence)
      || op.ledgerSequence === undefined || op.ledgerSequence <= last) {
      throw new Error("invalid session causal sequence");
    }
    last = op.ledgerSequence;
    if (!op.transactionTime || Object.keys(op.transactionTime).some(k => k !== "from")) {
      throw new Error("invalid session transaction time");
    }
    const at = timestamp("transaction time", op.transactionTime.from);
    if (op.kind === "session.issued") {
      identifier("session principal", op.principalId, "principal:");
      if (typeof op.tokenDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(op.tokenDigest)) {
        throw new Error("invalid session token digest");
      }
      const expires = timestamp("session expiresAt", op.expiresAt);
      if (expires <= at || expires - at > 30 * 86_400_000) {
        throw new Error("invalid session expiry period");
      }
      if (sessions.has(op.sessionId) || digests.has(op.tokenDigest)) {
        throw new Error("duplicate session id or token digest");
      }
      sessions.set(op.sessionId, {
        principalId: op.principalId, tokenDigest: op.tokenDigest,
        expiresAt: expires, revoked: false,
      });
      digests.add(op.tokenDigest);
    } else {
      const state = sessions.get(op.sessionId);
      if (!state) throw new Error(`session does not exist: ${op.sessionId}`);
      if (state.revoked) throw new Error(`session already revoked: ${op.sessionId}`);
      state.revoked = true;
    }
  }
  return sessions;
}

/**
 * Trusted-operator-only PostgreSQL credential journal. The API can authenticate
 * independently connected processes because it retrieves/replays committed
 * credentials and revocations for each request; no per-process authority cache.
 *
 * No public grant or revocation HTTP endpoint is exposed. This is not an
 * OIDC/login server, agent delegation, or proof of high-entropy token creation.
 */
export class PostgresPrincipalSessions {
  readonly #ledger: PostgresCanonicalLedger<PostgresSessionOperation>;
  readonly #workspaces: PostgresWorkspaceJournal;
  readonly #now: () => number;

  private constructor(input: {
    readonly ledger: PostgresCanonicalLedger<PostgresSessionOperation>;
    readonly workspaces: PostgresWorkspaceJournal;
    readonly now: () => number;
  }) {
    this.#ledger = input.ledger;
    this.#workspaces = input.workspaces;
    this.#now = input.now;
  }

  static open(input: {
    readonly pool: PostgresPool;
    readonly workspaces: PostgresWorkspaceJournal;
    readonly namespace?: string;
    readonly now?: () => number;
  }): PostgresPrincipalSessions {
    return new PostgresPrincipalSessions({
      ledger: PostgresCanonicalLedger.open({ pool: input.pool, namespace: input.namespace ?? "sessions" }),
      workspaces: input.workspaces,
      now: input.now ?? Date.now,
    });
  }

  async resolve(authorization: string | undefined): Promise<{ readonly id: string } | undefined> {
    if (authorization === undefined || !/^Bearer [^\s]+$/.test(authorization)) {
      return undefined;
    }
    const supplied = createHash("sha256").update(authorization.slice(7), "utf8").digest();
    let sessions: Map<string, SessionProjection>;
    try {
      sessions = replay(await this.#ledger.load());
    } catch (cause) {
      // Do not misclassify corrupted canonical credentials as a bad client
      // request. Never fall back to empty or cached grants.
      throw new Error("canonical credential history failed to replay", { cause });
    }
    let principal: string | undefined;
    for (const state of sessions.values()) {
      const reference = Buffer.from(state.tokenDigest.slice(7), "hex");
      if (timingSafeEqual(supplied, reference)
        && !state.revoked && this.#now() < state.expiresAt) {
        principal = state.principalId;
      }
    }
    if (principal === undefined) return undefined;
    // History cannot grant an identity without a registered human principal.
    const workspace = await this.#workspaces.snapshot();
    const registered = workspace.history().find(op =>
      op.kind === "principal.registered" && op.principal.id === principal
    );
    if (registered?.kind !== "principal.registered" || registered.principal.kind !== "human") {
      return undefined;
    }
    return { id: principal };
  }

  async provision(input: {
    readonly operationId: string;
    readonly sessionId: string;
    readonly principalId: string;
    readonly token: string;
    readonly expiresAt: string;
    readonly recordedAt: string;
  }): Promise<{ readonly sessionId: string; readonly principalId: string; readonly expiresAt: string }> {
    const opId = identifier("operation", input.operationId, "session-operation:");
    const sessionId = identifier("session", input.sessionId, "session:");
    const principalId = identifier("principal", input.principalId, "principal:");
    const tokenDigest = digest(input.token);
    const at = timestamp("session recordedAt", input.recordedAt);
    const expiry = timestamp("session expiresAt", input.expiresAt);
    if (expiry <= at) throw new TypeError("session must expire after issuance");
    if (expiry - at > 30 * 86_400_000) throw new TypeError("session expiry must be within 30 days");
    const workspace = await this.#workspaces.snapshot();
    const principal = workspace.history().find(op =>
      op.kind === "principal.registered" && op.principal.id === principalId
    );
    if (principal?.kind !== "principal.registered") throw new Error("session principal is not registered");
    if (principal.principal.kind !== "human") throw new Error("sessions require a registered human principal");
    const record: PostgresSessionIssued = {
      id: opId, kind: "session.issued", sessionId, principalId, tokenDigest,
      expiresAt: new Date(expiry).toISOString(),
      transactionTime: { from: new Date(at).toISOString() },
    };
    await this.#ledger.appendValidated({
      decide: (history) => {
        const current = replay(history);
        if (current.has(sessionId) || [...current.values()].some(x => x.tokenDigest === tokenDigest)) {
          throw new Error("duplicate session id or token digest");
        }
        return { record, result: undefined };
      },
    });
    return { sessionId, principalId, expiresAt: input.expiresAt };
  }

  async revoke(input: {
    readonly operationId: string;
    readonly sessionId: string;
    readonly recordedAt: string;
  }): Promise<void> {
    const record: PostgresSessionRevoked = {
      id: identifier("operation", input.operationId, "session-operation:"),
      kind: "session.revoked",
      sessionId: identifier("session", input.sessionId, "session:"),
      transactionTime: { from: new Date(timestamp("recordedAt", input.recordedAt)).toISOString() },
    };
    await this.#ledger.appendValidated({
      decide: (history) => {
        const current = replay(history);
        const state = current.get(record.sessionId);
        if (!state) throw new Error(`session does not exist: ${record.sessionId}`);
        if (state.revoked) throw new Error(`session already revoked: ${record.sessionId}`);
        return { record, result: undefined };
      },
    });
  }

  /** Sensitive operator-only audit data: includes hashed bearer digests. */
  async history(): Promise<readonly PostgresSessionOperation[]> {
    const history = await this.#ledger.load();
    replay(history);
    return history;
  }
}
