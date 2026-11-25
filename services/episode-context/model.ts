import type { ContextSegmentRecord } from "../../packages/context-gateway/src/index.ts";
import { checkEvent, instant } from "./validate.ts";

interface Base {
  readonly id: string;
  readonly workspaceId: string;
  readonly ledgerSequence?: number;
  readonly transactionTime: { readonly from: string };
  readonly actorPrincipalId: string;
}
export interface KnowledgePublished extends Base {
  readonly kind: "episode.context.segment.published";
  readonly segment: ContextSegmentRecord;
  readonly origin: "agent-proposal" | "trusted-source";
  readonly rationale: string;
}
export interface KnowledgeRevoked extends Base {
  readonly kind: "episode.context.segment.revoked";
  readonly segmentId: string;
  readonly reason: string;
}
export type EpisodeKnowledgeOperation = KnowledgePublished | KnowledgeRevoked;
export interface EpisodeKnowledgeState {
  readonly published: Map<string, KnowledgePublished>;
  readonly revoked: Map<string, KnowledgeRevoked>;
}
export function replay(history: readonly EpisodeKnowledgeOperation[]): EpisodeKnowledgeState {
  const published = new Map<string, KnowledgePublished>();
  const revoked = new Map<string, KnowledgeRevoked>();
  const ids = new Set<string>();
  let sequence = 0;
  for (const record of history) {
    checkEvent(record);
    if (record.ledgerSequence !== ++sequence || ids.has(record.id)) {
      throw new Error("invalid episode knowledge causal sequence or duplicate record");
    }
    ids.add(record.id);
    if (record.kind === "episode.context.segment.published") {
      if (published.has(record.segment.id)) throw new Error("knowledge segment already published");
      published.set(record.segment.id, record);
    } else {
      const source = published.get(record.segmentId);
      if (!source || revoked.has(record.segmentId)
        || source.workspaceId !== record.workspaceId
        || instant("revocation", record.transactionTime.from)
          < instant("publication", source.transactionTime.from)) {
        throw new Error("unknown, duplicate or backdated episode knowledge revocation");
      }
      revoked.set(record.segmentId, record);
    }
  }
  return { published, revoked };
}
