import {
  WorkRegistry,
  type WorkInstance,
  type WorkEpisode,
  type WorkOperation,
} from "../../../packages/work/src/index.ts";
import type {
  Principal,
  WorkspaceRegistry,
} from "../../../packages/workspace/src/index.ts";
import { PostgresCanonicalLedger, type PostgresPool } from "./index.ts";
import { PostgresWorkspaceJournal } from "./workspace.ts";

/**
 * PostgreSQL-backed Work journal, preserving domain replay and actor access.
 * Each workspace uses an independent sequence/lock scope. Work state is
 * reconstructed from the canonical SQL journal for every request, never from
 * a cross-process mutable cache.
 *
 * Workspace grants are read from the separate global Workspace journal;
 * cross-ledger revocation atomicity remains an explicit future requirement.
 */
export class PostgresWorkJournal {
  readonly #ledger: PostgresCanonicalLedger<WorkOperation>;
  readonly #workspaces: PostgresWorkspaceJournal;

  private constructor(
    ledger: PostgresCanonicalLedger<WorkOperation>,
    workspaces: PostgresWorkspaceJournal,
  ) {
    this.#ledger = ledger;
    this.#workspaces = workspaces;
  }

  static open(input: {
    readonly pool: PostgresPool;
    readonly workspaces: PostgresWorkspaceJournal;
    readonly namespace?: string;
  }): PostgresWorkJournal {
    return new PostgresWorkJournal(
      PostgresCanonicalLedger.open({ pool: input.pool, namespace: input.namespace ?? "work" }),
      input.workspaces,
    );
  }

  async createWorkInstance(
    input: Parameters<WorkRegistry["createWorkInstance"]>[0],
  ): Promise<WorkInstance> {
    const workspace = await this.#workspaces.snapshot();
    workspace.workspaceFor({
      principalId: input.createdByPrincipalId, workspaceId: input.workspaceId,
    });
    for (const principal of input.participants) {
      requireHumanWorkspaceParticipant(workspace, principal, input.workspaceId);
    }
    return this.#commit(input.workspaceId, (draft) => draft.createWorkInstance(input));
  }

  async startEpisode(input: Parameters<WorkRegistry["startEpisode"]>[0]): Promise<WorkEpisode> {
    const workspace = await this.#workspaces.snapshot();
    workspace.workspaceFor({
      principalId: input.actorPrincipalId, workspaceId: input.workspaceId,
    });
    return this.#commit(input.workspaceId, (draft) => {
      const instance = draft.workInstance({
        workspaceId: input.workspaceId, id: input.workInstanceId,
      });
      assertParticipant(instance, input.actorPrincipalId);
      return draft.startEpisode(input);
    });
  }

  async workInstance(input: {
    readonly principalId: string;
    readonly workspaceId: string;
    readonly id: string;
  }): Promise<WorkInstance> {
    await this.#workspaces.workspaceFor(input);
    const work = WorkRegistry.replay(await this.#ledger.load({ workspaceId: input.workspaceId }));
    const instance = work.workInstance({ workspaceId: input.workspaceId, id: input.id });
    assertParticipant(instance, input.principalId);
    return instance;
  }

  async history(input: {
    readonly principalId: string;
    readonly workspaceId: string;
  }): Promise<readonly WorkOperation[]> {
    await this.#workspaces.workspaceFor(input);
    const work = WorkRegistry.replay(await this.#ledger.load({ workspaceId: input.workspaceId }));
    return Object.freeze(work.history().filter((operation) => {
      const instance = work.workInstance({ workspaceId: input.workspaceId, id: operation.workInstanceId });
      return instance.participants.some((participant) => participant.principalId === input.principalId);
    }));
  }

  async #commit<Result>(
    workspaceId: string,
    apply: (draft: WorkRegistry) => Result,
  ): Promise<Result> {
    return this.#ledger.appendValidated({
      workspaceId,
      decide: (history) => {
        const draft = WorkRegistry.replay(history);
        const known = new Set(draft.history().map((op) => op.id));
        const result = apply(draft);
        const delta = draft.history().filter((op) => !known.has(op.id));
        if (delta.length !== 1) throw new Error("one Work operation required per transaction");
        const operation = delta[0];
        if (operation === undefined) throw new Error("missing Work operation");
        const { ledgerSequence: _draftSequence, ...record } = operation;
        return { record: record as WorkOperation, result };
      },
    });
  }
}

function requireHumanWorkspaceParticipant(
  workspaces: WorkspaceRegistry,
  participant: Principal,
  workspaceId: string,
): void {
  const registered = workspaces.history().find((op) =>
    op.kind === "principal.registered" && op.principal.id === participant.id
  );
  if (registered?.kind !== "principal.registered"
    || registered.principal.kind !== participant.kind) {
    throw new Error(`Work participant principal kind mismatch: ${participant.id}`);
  }
  if (participant.kind !== "human") {
    throw new Error("non-human Work participation requires explicit delegated capability");
  }
  workspaces.workspaceFor({ principalId: participant.id, workspaceId });
}

function assertParticipant(
  instance: WorkInstance,
  principalId: string,
): void {
  if (!instance.participants.some((participant) => participant.principalId === principalId)) {
    throw new Error(`Work participant access denied: ${principalId} -> ${instance.id}`);
  }
}
