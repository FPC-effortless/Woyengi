import type { EpisodeKnowledgeOperation } from "./model.ts";

export function requireId(label: string, value: unknown, prefix: string): void {
  if (typeof value !== "string" || !value.startsWith(prefix)
    || value.length > 512 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.slice(prefix.length))) {
    throw new TypeError(`${label} requires a bounded ${prefix} identifier`);
  }
}
export function instant(label: string, value: unknown): number {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} requires an offset-aware timestamp`);
  }
  return Date.parse(value);
}
export function rationale(label: string, value: unknown): void {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) {
    throw new TypeError(`${label} must be nonempty and bounded`);
  }
}
export function checkEvent(record: EpisodeKnowledgeOperation): void {
  if (!record || (record.kind !== "episode.context.segment.published"
    && record.kind !== "episode.context.segment.revoked")) {
    throw new Error("unsupported canonical episode knowledge operation");
  }
  requireId("workspace", record.workspaceId, "workspace:");
  requireId("actor", record.actorPrincipalId, "principal:");
  const at = instant("transaction", record.transactionTime?.from);
  const keys = ["id", "kind", "workspaceId", "ledgerSequence", "transactionTime", "actorPrincipalId"];
  if (record.kind === "episode.context.segment.published") {
    keys.push("segment", "origin", "rationale");
    const s = record.segment;
    if (!s || typeof s !== "object") throw new Error("missing knowledge segment");
    requireId("segment", s.id, "context-segment:");
    requireId("work instance", s.workInstanceId, "work-instance:");
    requireId("work episode", s.workEpisodeId, "work-episode:");
    if (record.id !== "episode-knowledge:published:" + s.id
      || s.workspaceId !== record.workspaceId || s.revokedAt !== undefined) {
      throw new Error("knowledge publication identity, scope or lifecycle mismatch");
    }
    const segmentKeys = ["id", "workspaceId", "workInstanceId", "workEpisodeId",
      "content", "source", "trustClass", "validTime", "transactionTime", "provenance"];
    if (Object.keys(s).some(key => !segmentKeys.includes(key))) {
      throw new Error("unexpected episode knowledge segment field");
    }
    if (record.origin !== "agent-proposal" && record.origin !== "trusted-source") {
      throw new Error("invalid episode knowledge origin");
    }
    if ((record.origin === "agent-proposal"
        && (s.source?.kind !== "agent-proposal" || s.trustClass !== "inferred"))
      || (record.origin === "trusted-source" && s.source?.kind === "agent-proposal")) {
      throw new Error("agent proposal cannot assert verified authority");
    }
    if (!s.source || typeof s.source.kind !== "string" || !s.source.kind.trim()
      || !Array.isArray(s.provenance)
      || !["authoritative", "verified", "asserted", "inferred", "untrusted"].includes(s.trustClass)) {
      throw new Error("invalid episode knowledge source or provenance");
    }
    requireId("source", s.source.id, "");
    if (instant("segment transaction", s.transactionTime?.from) !== at) {
      throw new Error("knowledge transaction time mismatch");
    }
    instant("valid time", s.validTime?.from);
    if (s.validTime.to !== undefined
      && instant("valid end", s.validTime.to) <= instant("valid start", s.validTime.from)) {
      throw new Error("invalid segment valid-time interval");
    }
    rationale("publication rationale", record.rationale);
  } else {
    keys.push("segmentId", "reason");
    requireId("segment", record.segmentId, "context-segment:");
    if (record.id !== "episode-knowledge:revoked:" + record.segmentId) {
      throw new Error("invalid episode knowledge revocation identity");
    }
    rationale("revocation reason", record.reason);
  }
  if (Object.keys(record).some(key => !keys.includes(key))) {
    throw new Error("unexpected canonical episode knowledge fields");
  }
}
