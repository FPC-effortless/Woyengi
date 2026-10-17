import {
  WorkspaceRegistry,
  type WorkspaceOperation,
} from "../../../packages/workspace/src/index.ts";
import { PostgresCanonicalLedger, type PostgresPool } from "./index.ts";

const WORKSPACE_KINDS = new Set([
  "principal.registered", "account.created", "organization.created",
  "membership.invited", "membership.accepted",
]);

function replay(history: readonly WorkspaceOperation[]): WorkspaceRegistry {
  for (const op of history) {
    if (!WORKSPACE_KINDS.has(op.kind) || ("workspaceId" in op && op.workspaceId !== undefined)) {
      throw new Error(`unexpected PostgreSQL Workspace operation: ${op.id}`);
    }
  }
  return WorkspaceRegistry.replay(history);
}

/**
 * Real PostgreSQL-backed Workspace journal.
 *
 * Workspace operations are global scope because principals and organization
 * membership span all workspaces. Every write is replay-validated under the
 * same PostgreSQL scope lock that allocates the causal sequence.
 */
export class PostgresWorkspaceJournal {
  readonly #ledger: PostgresCanonicalLedger<WorkspaceOperation>;

  private constructor(ledger: PostgresCanonicalLedger<WorkspaceOperation>) {
    this.#ledger = ledger;
  }

  static open(input: { readonly pool: PostgresPool; readonly namespace?: string }): PostgresWorkspaceJournal {
    return new PostgresWorkspaceJournal(PostgresCanonicalLedger.open({
      pool: input.pool, namespace: input.namespace ?? "workspace",
    }));
  }

  async snapshot(): Promise<WorkspaceRegistry> {
    return replay(await this.#ledger.load());
  }

  async history(): Promise<readonly WorkspaceOperation[]> {
    return (await this.snapshot()).history();
  }

  async workspaceFor(input: Parameters<WorkspaceRegistry["workspaceFor"]>[0]) {
    return (await this.snapshot()).workspaceFor(input);
  }

  async membershipsFor(principalId: string) {
    return (await this.snapshot()).membershipsFor(principalId);
  }

  async registerPrincipal(input: Parameters<WorkspaceRegistry["registerPrincipal"]>[0]) {
    return this.#commit((draft) => draft.registerPrincipal(input));
  }

  async createAccount(input: Parameters<WorkspaceRegistry["createAccount"]>[0]) {
    return this.#commit((draft) => draft.createAccount(input));
  }

  async createOrganization(input: Parameters<WorkspaceRegistry["createOrganization"]>[0]) {
    return this.#commit((draft) => draft.createOrganization(input));
  }

  async inviteMember(input: Parameters<WorkspaceRegistry["inviteMember"]>[0]) {
    return this.#commit((draft) => draft.inviteMember(input));
  }

  async acceptInvitation(input: Parameters<WorkspaceRegistry["acceptInvitation"]>[0]) {
    return this.#commit((draft) => draft.acceptInvitation(input));
  }

  async #commit<Result>(apply: (draft: WorkspaceRegistry) => Result): Promise<Result> {
    return this.#ledger.appendValidated({
      decide: (history) => {
        const draft = replay(history);
        const seen = new Set(draft.history().map((op) => op.id));
        const result = apply(draft);
        const delta = draft.history().filter((op) => !seen.has(op.id));
        if (delta.length !== 1) throw new Error("one Workspace operation required per transaction");
        const operation = delta[0];
        if (operation === undefined) throw new Error("missing Workspace operation");
        // Sequence is assigned only by SQL storage, not the ephemeral domain
        // projection created during transactional validation.
        const { ledgerSequence: _draftSequence, ...record } = operation;
        return { record: record as WorkspaceOperation, result };
      },
    });
  }
}
