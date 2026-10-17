import { mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { LedgerRecord } from "../../../packages/ledger/src/index.ts";
import { LocalCanonicalLedger } from "../../../packages/storage/src/index.ts";
import {
  WorkRegistry,
  type WorkInstance,
  type WorkEpisode,
  type WorkOperation,
} from "../../../packages/work/src/index.ts";
import {
  WorkspaceRegistry,
  type Principal,
} from "../../../packages/workspace/src/index.ts";

export interface DurableWorkJournalOpenInput {
  readonly ledgerPath: string;
  /** The caller must reconstruct the authoritative workspace registry from durable operations. */
  readonly workspaces: WorkspaceRegistry;
}

/**
 * Single-writer local Work operation journal. Every accepted Work mutation is
 * replayed from a durable causal ledger; it never treats a projected instance
 * or a generated agent response as canonical state.
 *
 * This is the offline/self-host persistence seam, not a production session
 * service. Multi-process writers, network sessions, agent capability grants,
 * and a PostgreSQL transaction provider are deliberately not implied.
 */
export class DurableWorkJournal {
  readonly #ledger: LocalCanonicalLedger<LedgerRecord>;
  readonly #workspaces: WorkspaceRegistry;
  readonly #writer: FileHandle;
  readonly #lockPath: string;
  #registry: WorkRegistry;
  #writeQueue: Promise<void> = Promise.resolve();
  #closing = false;
  #closed = false;

  private constructor(
    ledger: LocalCanonicalLedger<LedgerRecord>,
    workspaces: WorkspaceRegistry,
    writer: FileHandle,
    lockPath: string,
    registry: WorkRegistry,
  ) {
    this.#ledger = ledger;
    this.#workspaces = workspaces;
    this.#writer = writer;
    this.#lockPath = lockPath;
    this.#registry = registry;
  }

  static async open(input: DurableWorkJournalOpenInput): Promise<DurableWorkJournal> {
    const ledgerPath = resolve(input.ledgerPath);
    const lockPath = `${ledgerPath}.writer.lock`;
    await mkdir(dirname(ledgerPath), { recursive: true });
    let writer: FileHandle;
    try {
      writer = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (isFileExists(error)) {
        throw new Error(`durable Work writer lock is already held: ${lockPath}`);
      }
      throw error;
    }
    try {
      const ledger = await LocalCanonicalLedger.open<LedgerRecord>(ledgerPath);
      // The WorkRegistry validates identities, causal order, versions, and
      // all references while reconstructing every projection.
      const registry = WorkRegistry.replay(ledger.query() as readonly WorkOperation[]);
      return new DurableWorkJournal(ledger, input.workspaces, writer, lockPath, registry);
    } catch (error) {
      await writer.close();
      await unlink(lockPath);
      throw error;
    }
  }

  async createWorkInstance(
    input: Parameters<WorkRegistry["createWorkInstance"]>[0],
  ): Promise<WorkInstance> {
    // Every human participant must already have active workspace access.
    // Agent/service enrollment must be explicitly granted through the future
    // capability gateway; never infer delegation from a participant list.
    this.#access(input.createdByPrincipalId, input.workspaceId);
    for (const participant of input.participants) {
      this.#requireHumanWorkspaceParticipant(participant, input.workspaceId);
    }
    return this.#commit((draft) => draft.createWorkInstance(input));
  }

  async startEpisode(
    input: Parameters<WorkRegistry["startEpisode"]>[0],
  ): Promise<WorkEpisode> {
    this.#access(input.actorPrincipalId, input.workspaceId);
    this.#assertWorkParticipant(input.actorPrincipalId, input.workspaceId, input.workInstanceId);
    return this.#commit((draft) => draft.startEpisode(input));
  }

  workInstance(input: {
    readonly principalId: string;
    readonly workspaceId: string;
    readonly id: string;
  }): WorkInstance {
    this.#access(input.principalId, input.workspaceId);
    this.#assertWorkParticipant(input.principalId, input.workspaceId, input.id);
    return this.#registry.workInstance({ workspaceId: input.workspaceId, id: input.id });
  }

  history(input: {
    readonly principalId: string;
    readonly workspaceId: string;
  }): readonly WorkOperation[] {
    this.#access(input.principalId, input.workspaceId);
    // Workspace membership is necessary but not sufficient to see another
    // team's Work context. Filter by explicit Work participants as well.
    return Object.freeze(this.#registry.history().filter((operation) =>
      operation.workspaceId === input.workspaceId
      && this.#registry.workInstance({
        workspaceId: input.workspaceId,
        id: operation.workInstanceId,
      }).participants.some((participant) => participant.principalId === input.principalId)
    ));
  }

  async close(): Promise<void> {
    if (this.#closed || this.#closing) return;
    this.#closing = true;
    await this.#writeQueue;
    try {
      await this.#writer.close();
    } finally {
      this.#closed = true;
      await unlink(this.#lockPath);
    }
  }

  #access(principalId: string, workspaceId: string): void {
    this.#workspaces.workspaceFor({ principalId, workspaceId });
  }

  #requireHumanWorkspaceParticipant(participant: Principal, workspaceId: string): void {
    const registration = this.#workspaces.history().find((operation) =>
      operation.kind === "principal.registered" && operation.principal.id === participant.id
    );
    if (registration === undefined || registration.kind !== "principal.registered"
      || registration.principal.kind !== participant.kind) {
      throw new Error(`Work participant principal kind mismatch: ${participant.id}`);
    }
    if (participant.kind !== "human") {
      throw new Error("non-human Work participation requires explicit delegated capability");
    }
    this.#access(participant.id, workspaceId);
  }

  #assertWorkParticipant(principalId: string, workspaceId: string, workInstanceId: string): void {
    const work = this.#registry.workInstance({ workspaceId, id: workInstanceId });
    if (!work.participants.some((participant) => participant.principalId === principalId)) {
      throw new Error(`Work participant access denied: ${principalId} -> ${workInstanceId}`);
    }
  }

  #commit<Result>(apply: (draft: WorkRegistry) => Result): Promise<Result> {
    if (this.#closed || this.#closing) {
      return Promise.reject(new Error("durable Work journal is closed"));
    }
    const perform = async (): Promise<Result> => {
      const prior = this.#registry.history();
      const existingIds = new Set(prior.map((operation) => operation.id));
      const draft = WorkRegistry.replay(prior);
      const result = apply(draft);
      const added = draft.history().filter((operation) => !existingIds.has(operation.id));
      if (added.length !== 1) throw new Error("a durable Work transaction must contain exactly one operation");
      const operation = added[0];
      if (operation === undefined) throw new Error("missing committed Work operation");
      // Durable storage, not the caller, assigns ledger sequence. The Work
      // registry independently reconstructs it from that persisted sequence.
      const { ledgerSequence: _unpersistedSequence, ...record } = operation;
      await this.#ledger.append(record);
      this.#registry = WorkRegistry.replay(this.#ledger.query() as readonly WorkOperation[]);
      return result;
    };
    const attempt = this.#writeQueue.then(perform);
    this.#writeQueue = attempt.then(() => undefined, () => undefined);
    return attempt;
  }
}

function isFileExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
