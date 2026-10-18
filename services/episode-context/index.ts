import { PostgresCanonicalLedger, type PostgresPool } from "../postgres-storage/index.ts";
export interface EpisodeKnowledgeRecord {
  readonly id: string;
  readonly kind: "episode.context.segment.published" | "episode.context.segment.revoked";
  readonly workspaceId: string;
  readonly transactionTime: { readonly from: string };
}
export class PostgresEpisodeKnowledgeJournal {
  readonly #ledger: PostgresCanonicalLedger<EpisodeKnowledgeRecord>;
  private constructor(ledger: PostgresCanonicalLedger<EpisodeKnowledgeRecord>) {
    this.#ledger = ledger;
  }
  static open(input: { readonly pool: PostgresPool; readonly namespace?: string }): PostgresEpisodeKnowledgeJournal {
    return new PostgresEpisodeKnowledgeJournal(PostgresCanonicalLedger.open({
      pool: input.pool, namespace: input.namespace ?? "episode-knowledge",
    }));
  }
}
