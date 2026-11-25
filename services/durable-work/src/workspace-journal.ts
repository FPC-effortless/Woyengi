import { mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { LedgerRecord } from "../../../packages/ledger/src/index.ts";
import { LocalCanonicalLedger } from "../../../packages/storage/src/index.ts";
import {
  WorkspaceRegistry,
  type WorkspaceOperation,
} from "../../../packages/workspace/src/index.ts";

/** Trusted single-process bootstrap/persistence, not a multi-user identity API. */
export interface DurableWorkspaceJournalOpenInput {
  readonly ledgerPath: string;
}

const WORKSPACE_OPERATION_KINDS = new Set<string>([
  "principal.registered",
  "account.created",
  "organization.created",
  "membership.invited",
  "membership.accepted",
]);

/**
 * Append-only canonical WorkspaceRegistry operation adapter.
 *
 * Workspace/principal operations form one global causal sequence, unlike
 * per-workspace Work operations. Each stored operation is reconstructed through
 * WorkspaceRegistry.replay, never from a mutable account or membership snapshot.
 */
export class DurableWorkspaceJournal {
  readonly #ledger: LocalCanonicalLedger<LedgerRecord>;
  readonly #writer: FileHandle;
  readonly #lockPath: string;
  #registry: WorkspaceRegistry;
  #writeQueue: Promise<void> = Promise.resolve();
  #closePromise: Promise<void> | undefined;

  private constructor(
    ledger: LocalCanonicalLedger<LedgerRecord>,
    writer: FileHandle,
    lockPath: string,
    registry: WorkspaceRegistry,
  ) {
    this.#ledger = ledger;
    this.#writer = writer;
    this.#lockPath = lockPath;
    this.#registry = registry;
  }

  static async open(input: DurableWorkspaceJournalOpenInput): Promise<DurableWorkspaceJournal> {
    const ledgerPath = resolve(input.ledgerPath);
    const lockPath = `${ledgerPath}.writer.lock`;
    await mkdir(dirname(ledgerPath), { recursive: true });
    let writer: FileHandle;
    try {
      writer = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (isFileExists(error)) throw new Error(`durable Workspace writer lock is already held: ${lockPath}`);
      throw error;
    }
    try {
      const ledger = await LocalCanonicalLedger.open<LedgerRecord>(ledgerPath);
      const registry = WorkspaceRegistry.replay(validatedHistory(ledger.query()));
      return new DurableWorkspaceJournal(ledger, writer, lockPath, registry);
    } catch (error) {
      await writer.close();
      await unlink(lockPath);
      throw error;
    }
  }

  async registerPrincipal(
    input: Parameters<WorkspaceRegistry["registerPrincipal"]>[0],
  ): Promise<ReturnType<WorkspaceRegistry["registerPrincipal"]>> {
    return this.#commit((draft) => draft.registerPrincipal(input));
  }

  async createAccount(
    input: Parameters<WorkspaceRegistry["createAccount"]>[0],
  ): Promise<ReturnType<WorkspaceRegistry["createAccount"]>> {
    return this.#commit((draft) => draft.createAccount(input));
  }

  async createOrganization(
    input: Parameters<WorkspaceRegistry["createOrganization"]>[0],
  ): Promise<ReturnType<WorkspaceRegistry["createOrganization"]>> {
    return this.#commit((draft) => draft.createOrganization(input));
  }

  async inviteMember(
    input: Parameters<WorkspaceRegistry["inviteMember"]>[0],
  ): Promise<ReturnType<WorkspaceRegistry["inviteMember"]>> {
    return this.#commit((draft) => draft.inviteMember(input));
  }

  async acceptInvitation(
    input: Parameters<WorkspaceRegistry["acceptInvitation"]>[0],
  ): Promise<ReturnType<WorkspaceRegistry["acceptInvitation"]>> {
    return this.#commit((draft) => draft.acceptInvitation(input));
  }

  workspaceFor(input: Parameters<WorkspaceRegistry["workspaceFor"]>[0]) {
    return this.#registry.workspaceFor(input);
  }

  membershipsFor(principalId: string) {
    return this.#registry.membershipsFor(principalId);
  }

  history(): readonly WorkspaceOperation[] {
    return this.#registry.history();
  }

  /**
   * Defensive reconstructed value for composed local Work services.
   * Mutations on this snapshot never change canonical persisted operations.
   * A service must refresh this snapshot after membership changes; this slice
   * does not implement a live session / authorization gateway.
   */
  snapshot(): WorkspaceRegistry {
    return WorkspaceRegistry.replay(this.#registry.history());
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

  #commit<Result>(apply: (draft: WorkspaceRegistry) => Result): Promise<Result> {
    if (this.#closePromise !== undefined) return Promise.reject(new Error("durable Workspace journal is closed"));

    const perform = async (): Promise<Result> => {
      const prior = this.#registry.history();
      const existing = new Set(prior.map((operation) => operation.id));
      const draft = WorkspaceRegistry.replay(prior);
      const result = apply(draft);
      const added = draft.history().filter((operation) => !existing.has(operation.id));
      if (added.length !== 1) throw new Error("a durable Workspace transaction must contain exactly one operation");
      const operation = added[0];
      if (operation === undefined) throw new Error("missing Workspace operation");
      // Global causal order is assigned by LocalCanonicalLedger, not by a
      // mutable projection or a caller-supplied sequence.
      const { ledgerSequence: _draftSequence, ...record } = operation;
      await this.#ledger.append(record);
      this.#registry = WorkspaceRegistry.replay(validatedHistory(this.#ledger.query()));
      return result;
    };

    const attempt = this.#writeQueue.then(perform);
    this.#writeQueue = attempt.then(() => undefined, () => undefined);
    return attempt;
  }
}

function validatedHistory(records: readonly LedgerRecord[]): readonly WorkspaceOperation[] {
  for (const record of records) {
    if (!WORKSPACE_OPERATION_KINDS.has(record.kind)) {
      throw new TypeError(`unsupported workspace operation kind: ${record.kind}`);
    }
    // WorkspaceRegistry has one global ordered journal. A forged top-level
    // workspaceId would otherwise change LocalCanonicalLedger sequence scope.
    if (record.workspaceId !== undefined) {
      throw new TypeError(`unexpected workspace scope on global workspace operation: ${record.id}`);
    }
  }
  return records as readonly WorkspaceOperation[];
}

function isFileExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
