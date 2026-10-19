import { createHash, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { LedgerRecord } from "../../../packages/ledger/src/index.ts";
import { LocalCanonicalLedger } from "../../../packages/storage/src/index.ts";
import type { DurableWorkspaceJournal } from "../../durable-work/index.ts";

export interface SessionIssuedOperation extends LedgerRecord {
  readonly kind: "session.issued";
  readonly sessionId: string;
  readonly principalId: string;
  readonly tokenDigest: string;
  readonly expiresAt: string;
  readonly transactionTime: { readonly from: string };
}

export interface SessionRevokedOperation extends LedgerRecord {
  readonly kind: "session.revoked";
  readonly sessionId: string;
  readonly transactionTime: { readonly from: string };
}

export type SessionOperation = SessionIssuedOperation | SessionRevokedOperation;

export interface DurablePrincipalSessionsOpenInput {
  readonly ledgerPath: string;
  readonly workspaces: DurableWorkspaceJournal;
  readonly now?: () => number;
}

type SessionState = {
  readonly sessionId: string;
  readonly principalId: string;
  readonly digest: Buffer;
  readonly expiresAt: number;
  revoked: boolean;
};

function prefixed(label: string, value: string, prefix: string): string {
  if (typeof value !== "string" || !value.startsWith(prefix)
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value.slice(prefix.length))) {
    throw new TypeError(`${label} must be a valid ${prefix} identifier`);
  }
  return value;
}

function instant(label: string, value: string): number {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`${label} requires an explicit UTC offset`);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) throw new TypeError(`${label} must be a valid timestamp`);
  return date;
}

function tokenHash(token: string): string {
  if (typeof token !== "string" || token.length < 32 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new TypeError("session bearer token must be at least 32 printable non-space characters");
  }
  return `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

/** Journal replay validates the full on-disk shape before trusting it as session authority. */
function reconstruct(operations: readonly SessionOperation[]): Map<string, SessionState> {
  const knownFields = new Map<string, readonly string[]>([
    ["session.issued", ["id", "kind", "sessionId", "principalId", "tokenDigest", "expiresAt", "ledgerSequence", "transactionTime"]],
    ["session.revoked", ["id", "kind", "sessionId", "ledgerSequence", "transactionTime"]],
  ]);
  const sessions = new Map<string, SessionState>();
  const digests = new Set<string>();
  const operationIds = new Set<string>();
  let previousSequence = 0;
  for (const operation of operations) {
    const fields = knownFields.get(operation.kind);
    if (fields === undefined) throw new TypeError(`unsupported session operation kind: ${operation.kind}`);
    for (const field of Object.keys(operation)) {
      if (!fields.includes(field)) throw new TypeError(`unknown session operation field: ${field}`);
    }
    if (operation.workspaceId !== undefined) throw new TypeError("session journal is globally scoped");
    prefixed("session operation", operation.id, "session-operation:");
    prefixed("session", operation.sessionId, "session:");
    if (operationIds.has(operation.id)) throw new Error("duplicate session operation");
    operationIds.add(operation.id);
    if (!Number.isSafeInteger(operation.ledgerSequence)
      || operation.ledgerSequence === undefined
      || operation.ledgerSequence <= previousSequence) {
      throw new Error("invalid session causal sequence");
    }
    previousSequence = operation.ledgerSequence;
    if (operation.transactionTime === null || typeof operation.transactionTime !== "object"
      || Object.keys(operation.transactionTime).some((field) => field !== "from")) {
      throw new TypeError("invalid session transaction time");
    }
    const at = instant("session transactionTime", operation.transactionTime.from);
    if (operation.kind === "session.issued") {
      prefixed("session principal", operation.principalId, "principal:");
      if (typeof operation.tokenDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(operation.tokenDigest)) {
        throw new TypeError("invalid session token digest");
      }
      const expires = instant("session expiresAt", operation.expiresAt);
      if (expires <= at) throw new Error("session must expire after issuance");
      if (sessions.has(operation.sessionId) || digests.has(operation.tokenDigest)) {
        throw new Error("duplicate session id or token digest");
      }
      sessions.set(operation.sessionId, {
        sessionId: operation.sessionId,
        principalId: operation.principalId,
        digest: Buffer.from(operation.tokenDigest.slice(7), "hex"),
        expiresAt: expires,
        revoked: false,
      });
      digests.add(operation.tokenDigest);
    } else {
      const session = sessions.get(operation.sessionId);
      if (session === undefined) throw new Error(`session does not exist: ${operation.sessionId}`);
      if (session.revoked) throw new Error(`session already revoked: ${operation.sessionId}`);
      session.revoked = true;
    }
  }
  return sessions;
}

/**
 * Local single-writer durable credential journal. Only a trusted operator may
 * invoke provision/revoke; no public HTTP endpoint is provided for either.
 *
 * It is intentionally not an OIDC/login provider or a Postgres-backed
 * distributed session service. Canonical history stores token digests only.
 */
export class DurablePrincipalSessions {
  readonly #ledger: LocalCanonicalLedger<SessionOperation>;
  readonly #workspaces: DurableWorkspaceJournal;
  readonly #writer: FileHandle;
  readonly #lockPath: string;
  readonly #now: () => number;
  #sessions: Map<string, SessionState>;
  #writeQueue: Promise<void> = Promise.resolve();
  #closePromise: Promise<void> | undefined;

  private constructor(
    ledger: LocalCanonicalLedger<SessionOperation>,
    workspaces: DurableWorkspaceJournal,
    writer: FileHandle,
    lockPath: string,
    sessions: Map<string, SessionState>,
    now: () => number,
  ) {
    this.#ledger = ledger;
    this.#workspaces = workspaces;
    this.#writer = writer;
    this.#lockPath = lockPath;
    this.#sessions = sessions;
    this.#now = now;
  }

  static async open(input: DurablePrincipalSessionsOpenInput): Promise<DurablePrincipalSessions> {
    const ledgerPath = resolve(input.ledgerPath);
    const lockPath = `${ledgerPath}.writer.lock`;
    await mkdir(dirname(ledgerPath), { recursive: true });
    let writer: FileHandle;
    try {
      writer = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
        throw new Error(`durable sessions writer lock is already held: ${lockPath}`);
      }
      throw error;
    }
    try {
      // Existing on-disk session journals are tightened before they can be
      // read; all subsequent atomic replacements are written with mode 0600.
      try {
        await chmod(ledgerPath, 0o600);
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
      }
      const ledger = await LocalCanonicalLedger.open<SessionOperation>(ledgerPath, { fileMode: 0o600 });
      const sessions = reconstruct(ledger.query());
      // Credential history cannot grant a principal identity absent from the
      // canonical Workspace registry, even if the local session file is modified.
      for (const session of sessions.values()) {
        assertHumanPrincipal(input.workspaces, session.principalId);
      }
      return new DurablePrincipalSessions(ledger, input.workspaces, writer, lockPath, sessions, input.now ?? Date.now);
    } catch (error) {
      await writer.close();
      await unlink(lockPath);
      throw error;
    }
  }

  resolve(authorization: string | undefined): { readonly id: string } | undefined {
    if (this.#closePromise !== undefined || authorization === undefined || !/^Bearer [^\s]+$/.test(authorization)) {
      return undefined;
    }
    const token = authorization.slice(7);
    const supplied = createHash("sha256").update(token, "utf8").digest();
    let principal: string | undefined;
    for (const session of this.#sessions.values()) {
      // Fixed-width digest comparison. No raw tokens are ever persisted.
      if (timingSafeEqual(supplied, session.digest)
        && !session.revoked && this.#now() < session.expiresAt) {
        principal = session.principalId;
      }
    }
    return principal === undefined ? undefined : { id: principal };
  }

  async provision(input: {
    readonly operationId: string;
    readonly sessionId: string;
    readonly principalId: string;
    readonly token: string;
    readonly expiresAt: string;
    readonly recordedAt: string;
  }): Promise<{ readonly sessionId: string; readonly principalId: string; readonly expiresAt: string }> {
    const sessionId = prefixed("session", input.sessionId, "session:");
    const principalId = prefixed("principal", input.principalId, "principal:");
    const tokenDigest = tokenHash(input.token);
    const at = instant("session recordedAt", input.recordedAt);
    const expires = instant("session expiresAt", input.expiresAt);
    if (expires <= at) throw new TypeError("session must expire after issuance");
    // Sessions are short-lived operator grants, not permanent API keys.
    if (expires - at > 30 * 24 * 60 * 60 * 1000) throw new TypeError("session expiry must be within 30 days");
    await this.#append(() => {
      assertHumanPrincipal(this.#workspaces, principalId);
      return {
        id: prefixed("session operation", input.operationId, "session-operation:"),
        kind: "session.issued" as const,
        sessionId, principalId, tokenDigest,
        expiresAt: new Date(expires).toISOString(),
        transactionTime: { from: new Date(at).toISOString() },
      };
    });
    return { sessionId, principalId, expiresAt: input.expiresAt };
  }

  async revoke(input: {
    readonly operationId: string;
    readonly sessionId: string;
    readonly recordedAt: string;
  }): Promise<void> {
    await this.#append(() => ({
      id: prefixed("session operation", input.operationId, "session-operation:"),
      kind: "session.revoked" as const,
      sessionId: prefixed("session", input.sessionId, "session:"),
      transactionTime: { from: new Date(instant("session recordedAt", input.recordedAt)).toISOString() },
    }));
  }

  /** Operator/audit access only: history includes digests and principal IDs. */
  history(): readonly SessionOperation[] {
    return this.#ledger.query();
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closePromise = (async () => {
      await this.#writeQueue;
      try {
        await this.#writer.close();
      } finally {
        await unlink(this.#lockPath);
      }
    })();
    return this.#closePromise;
  }

  #append(create: () => SessionOperation): Promise<void> {
    if (this.#closePromise !== undefined) return Promise.reject(new Error("durable sessions journal is closed"));
    const perform = async (): Promise<void> => {
      const record = create();
      const candidate = this.#ledger.query().map((entry) => entry);
      // Storage alone assigns the global sequence; validate the proposed
      // journal before the atomic append to avoid irreversible partial state.
      reconstruct([...candidate, { ...record, ledgerSequence: candidate.length + 1 }]);
      await this.#ledger.append(record);
      this.#sessions = reconstruct(this.#ledger.query());
    };
    const attempt = this.#writeQueue.then(perform);
    this.#writeQueue = attempt.then(() => undefined, () => undefined);
    return attempt;
  }
}

function assertHumanPrincipal(workspaces: DurableWorkspaceJournal, principalId: string): void {
  const registration = workspaces.history().find((entry) =>
    entry.kind === "principal.registered" && entry.principal.id === principalId
  );
  if (registration?.kind !== "principal.registered") throw new Error("session principal is not registered");
  if (registration.principal.kind !== "human") throw new Error("sessions require a registered human principal");
}
