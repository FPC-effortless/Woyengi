import type { StateValue } from "../../core/src/index.ts";
import type { WorkEpisodeId, WorkInstanceId } from "../../work/src/index.ts";
import type { PrincipalId, WorkspaceId } from "../../workspace/src/index.ts";

export type MemoryCategory = "episodic" | "semantic" | "procedural" | "preference" | "failure-condition";
export type MemorySensitivity = "public" | "internal" | "confidential" | "restricted";
export type MemoryTrustClass = "authoritative" | "verified" | "asserted" | "inferred" | "untrusted";
export type MemoryLifecycle = "active" | "invalidated";

export interface MemoryTimeInterval {
  readonly from: string;
  readonly to?: string;
}

export interface ApplicabilityCondition {
  readonly key: string;
  readonly operator: "equals" | "not-equals" | "present" | "absent";
  readonly value?: string;
}

export interface MemoryRecordBase {
  readonly id: string;
  readonly category: MemoryCategory;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId?: WorkInstanceId;
  readonly workEpisodeId?: WorkEpisodeId;
  readonly sensitivity: MemorySensitivity;
  readonly trustClass: MemoryTrustClass;
  readonly confidence: number;
  readonly lifecycle: MemoryLifecycle;
  readonly validTime: MemoryTimeInterval;
  readonly transactionTime: MemoryTimeInterval;
  readonly provenance: readonly string[];
  readonly invalidatedAt?: string;
  readonly revokedAt?: string;
}

export interface EpisodicMemoryRecord extends MemoryRecordBase {
  readonly category: "episodic";
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly summary: string;
  readonly eventIds: readonly string[];
}

export interface SemanticMemoryRecord extends MemoryRecordBase {
  readonly category: "semantic";
  readonly subjectId: string;
  readonly predicate: string;
  readonly value: StateValue;
}

export interface ProceduralMemoryRecord extends MemoryRecordBase {
  readonly category: "procedural";
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly procedureId: string;
  readonly procedureVersion: string;
  readonly outcome: "succeeded" | "failed";
  readonly summary: string;
  readonly applicabilityConditions: readonly ApplicabilityCondition[];
  readonly knownFailureConditions: readonly ApplicabilityCondition[];
}

export interface PreferenceMemoryRecord extends MemoryRecordBase {
  readonly category: "preference";
  readonly principalId: PrincipalId;
  readonly key: string;
  readonly value: StateValue;
}

export interface FailureConditionMemoryRecord extends MemoryRecordBase {
  readonly category: "failure-condition";
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly procedureId: string;
  readonly failureCode: string;
  readonly description: string;
  readonly knownFailureConditions: readonly ApplicabilityCondition[];
}

export type MemoryRecord =
  | EpisodicMemoryRecord
  | SemanticMemoryRecord
  | ProceduralMemoryRecord
  | PreferenceMemoryRecord
  | FailureConditionMemoryRecord;

export interface MemoryRetrievalRequest {
  readonly principalId: PrincipalId;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId?: WorkInstanceId;
  readonly workEpisodeId?: WorkEpisodeId;
  readonly purpose: string;
  readonly query: string;
  readonly categories: readonly MemoryCategory[];
  readonly sensitivityCeiling: MemorySensitivity;
  readonly validAt: string;
  readonly transactionAt: string;
  readonly limit: number;
}

export type MemoryReadDecision =
  | { readonly allowed: true; readonly authorityLevel: number; readonly rationale: string }
  | { readonly allowed: false; readonly rationale: string };

export type MemoryWriteDecision =
  | { readonly allowed: true; readonly rationale: string }
  | { readonly allowed: false; readonly rationale: string };

export interface RankedMemory {
  readonly record: MemoryRecord;
  readonly authorityRationale: string;
  readonly score: {
    readonly relevance: number;
    readonly authorityLevel: number;
    readonly authority: number;
    readonly trust: number;
    readonly freshness: number;
    readonly total: number;
  };
}

export interface MemoryExclusion {
  readonly recordId: string;
  readonly reasons: readonly string[];
}

export interface MemoryRetrievalResult {
  readonly request: MemoryRetrievalRequest;
  readonly memories: readonly RankedMemory[];
  readonly exclusions: readonly MemoryExclusion[];
}

export interface MemoryRepositoryPort {
  query(input: {
    readonly workspaceId: WorkspaceId;
    readonly transactionAt: string;
  }): Promise<readonly MemoryRecord[]>;
  append(records: readonly MemoryRecord[]): Promise<void>;
}

export interface GovernedMemoryPorts {
  readonly repository: MemoryRepositoryPort;
  readonly authorizeRead?: (input: {
    readonly request: MemoryRetrievalRequest;
    readonly record: MemoryRecord;
  }) => MemoryReadDecision;
  readonly authorizeWrite?: (input: {
    readonly principalId: PrincipalId;
    readonly workspaceId: WorkspaceId;
    readonly workInstanceId: WorkInstanceId;
    readonly workEpisodeId: WorkEpisodeId;
    readonly procedureId: string;
    readonly outcome: "succeeded" | "failed";
    readonly operation: "LEARN_PROCEDURE_OUTCOME";
  }) => MemoryWriteDecision;
  readonly scoreRelevance: (input: {
    readonly request: MemoryRetrievalRequest;
    readonly record: MemoryRecord;
  }) => number | Promise<number>;
}

export interface ProcedureOutcomeLearningInput {
  readonly procedureMemoryId: string;
  readonly failureMemoryId?: string;
  readonly principalId: PrincipalId;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly procedureId: string;
  readonly procedureVersion: string;
  readonly outcome: "succeeded" | "failed";
  readonly summary: string;
  readonly failureCode?: string;
  readonly applicabilityConditions: readonly ApplicabilityCondition[];
  readonly knownFailureConditions: readonly ApplicabilityCondition[];
  readonly validTime: MemoryTimeInterval;
  readonly recordedAt: string;
  readonly provenance: readonly string[];
  readonly sensitivity: MemorySensitivity;
  readonly trustClass: MemoryTrustClass;
  readonly confidence: number;
}

export interface ProcedureLearningResult {
  readonly kind: "procedure-learning";
  readonly outcome: "succeeded" | "failed";
  readonly records: readonly (ProceduralMemoryRecord | FailureConditionMemoryRecord)[];
}

export interface ProcedureApplicabilityAssessment {
  readonly procedureId: string;
  readonly baseScore: number;
  readonly score: number;
  readonly supportingMemoryIds: readonly string[];
  readonly knownFailureMemoryIds: readonly string[];
  readonly rationale: string;
}

export class GovernedMemory {
  readonly #ports: GovernedMemoryPorts;

  constructor(ports: GovernedMemoryPorts) {
    this.#ports = ports;
  }

  async retrieve(input: MemoryRetrievalRequest): Promise<MemoryRetrievalResult> {
    const request = normalizeRetrievalRequest(input);
    const records = uniqueRecords(
      (await this.#ports.repository.query({
        workspaceId: request.workspaceId,
        transactionAt: request.transactionAt,
      })).map(defineMemoryRecord),
    );
    const memories: RankedMemory[] = [];
    const exclusions: MemoryExclusion[] = [];
    for (const record of records) {
      const reasons = staticExclusionReasons(record, request);
      if (reasons.length > 0) {
        exclusions.push({ recordId: record.id, reasons });
        continue;
      }
      const authority = evaluateReadAuthority(this.#ports.authorizeRead, request, record);
      if (!authority.allowed) {
        exclusions.push({ recordId: record.id, reasons: [`read-authority-denied:${authority.rationale}`] });
        continue;
      }
      const relevance = await this.#ports.scoreRelevance({ request, record });
      if (!Number.isFinite(relevance) || relevance < 0 || relevance > 1) {
        throw new RangeError(`memory relevance must be between 0 and 1: ${record.id}`);
      }
      memories.push(rankMemory(record, authority, relevance, request.transactionAt));
    }
    memories.sort(compareRankedMemory);
    exclusions.sort((left, right) => left.recordId.localeCompare(right.recordId));
    return deepFreeze({
      request,
      memories: memories.slice(0, request.limit),
      exclusions,
    });
  }

  async learnProcedureOutcome(input: ProcedureOutcomeLearningInput): Promise<ProcedureLearningResult> {
    const principalId = prefixed("principal id", input.principalId, "principal:") as PrincipalId;
    const workspaceId = prefixed("workspace id", input.workspaceId, "workspace:") as WorkspaceId;
    const workInstanceId = prefixed("work instance id", input.workInstanceId, "work-instance:") as WorkInstanceId;
    const workEpisodeId = prefixed("work episode id", input.workEpisodeId, "work-episode:") as WorkEpisodeId;
    const procedureId = prefixed("procedure id", input.procedureId, "procedure:");
    const authorization = evaluateWriteAuthority(this.#ports.authorizeWrite, {
      principalId,
      workspaceId,
      workInstanceId,
      workEpisodeId,
      procedureId,
      outcome: input.outcome,
      operation: "LEARN_PROCEDURE_OUTCOME",
    });
    if (!authorization.allowed) throw new Error(`memory write denied: ${authorization.rationale}`);
    const recordedAt = normalizeInstant(input.recordedAt);
    const common = {
      workspaceId,
      workInstanceId,
      workEpisodeId,
      sensitivity: input.sensitivity,
      trustClass: input.trustClass,
      confidence: input.confidence,
      lifecycle: "active" as const,
      validTime: input.validTime,
      transactionTime: { from: recordedAt },
      provenance: input.provenance,
    };
    const procedure = defineMemoryRecord({
      ...common,
      id: input.procedureMemoryId,
      category: "procedural",
      procedureId,
      procedureVersion: input.procedureVersion,
      outcome: input.outcome,
      summary: input.summary,
      applicabilityConditions: input.applicabilityConditions,
      knownFailureConditions: input.knownFailureConditions,
    }) as ProceduralMemoryRecord;
    const records: (ProceduralMemoryRecord | FailureConditionMemoryRecord)[] = [procedure];
    if (input.outcome === "failed") {
      if (input.failureMemoryId === undefined) throw new TypeError("failed procedure learning requires failureMemoryId");
      if (input.failureCode === undefined) throw new TypeError("failed procedure learning requires failureCode");
      records.push(
        defineMemoryRecord({
          ...common,
          id: input.failureMemoryId,
          category: "failure-condition",
          procedureId,
          failureCode: input.failureCode,
          description: input.summary,
          knownFailureConditions: input.knownFailureConditions,
        }) as FailureConditionMemoryRecord,
      );
    }
    if (records.some(containsRawSensitiveMemory)) {
      throw new Error("procedure learning contains raw secret, credential, or grant data");
    }
    await this.#ports.repository.append(deepFreeze([...records]));
    return deepFreeze({ kind: "procedure-learning" as const, outcome: input.outcome, records });
  }

  async evaluateProcedureApplicability(input: {
    readonly request: MemoryRetrievalRequest;
    readonly procedureId: string;
    readonly conditions: Readonly<Record<string, string>>;
    readonly baseScore: number;
  }): Promise<ProcedureApplicabilityAssessment> {
    const procedureId = prefixed("procedure id", input.procedureId, "procedure:");
    const baseScore = unitScore("base applicability score", input.baseScore);
    const retrieval = await this.retrieve({
      ...input.request,
      categories: ["procedural", "failure-condition"],
      limit: Number.MAX_SAFE_INTEGER,
    });
    const supporting = retrieval.memories
      .map(({ record }) => record)
      .filter(
        (record): record is ProceduralMemoryRecord =>
          record.category === "procedural" &&
          record.procedureId === procedureId &&
          record.outcome === "succeeded" &&
          conditionsMatch(record.applicabilityConditions, input.conditions),
      )
      .map(({ id }) => id)
      .sort();
    const failures = retrieval.memories
      .map(({ record }) => record)
      .filter(
        (record): record is FailureConditionMemoryRecord =>
          record.category === "failure-condition" &&
          record.procedureId === procedureId &&
          conditionsMatch(record.knownFailureConditions, input.conditions),
      )
      .map(({ id }) => id)
      .sort();
    const score = round(clamp(baseScore + Math.min(0.3, supporting.length * 0.15) - Math.min(0.8, failures.length * 0.4)));
    const rationale = [
      supporting.length === 0
        ? "No condition-matched successful procedure memory."
        : `${supporting.length} condition-matched successful procedure memory record(s).`,
      failures.length === 0
        ? "No known failure condition matched."
        : `${failures.length} known failure condition record(s) penalized applicability.`,
    ].join(" ");
    return deepFreeze({
      procedureId,
      baseScore,
      score,
      supportingMemoryIds: supporting,
      knownFailureMemoryIds: failures,
      rationale,
    });
  }
}

export interface MemoryContextRequest {
  readonly principalId: PrincipalId;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly purpose: string;
  readonly validAt: string;
  readonly transactionAt: string;
}

export interface MemoryContextSegment {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly content: StateValue;
  readonly source: { readonly id: string; readonly kind: string; readonly locator?: string };
  readonly trustClass: MemoryTrustClass;
  readonly validTime: MemoryTimeInterval;
  readonly transactionTime: MemoryTimeInterval;
  readonly provenance: readonly string[];
  readonly revokedAt?: string;
  readonly authorityFilter: { readonly decision: "allowed"; readonly rationale: string };
}

export interface MemoryContextSourcePort {
  query(request: MemoryContextRequest): Promise<readonly MemoryContextSegment[]>;
  append(segment: MemoryContextSegment): Promise<void>;
}

export function createMemoryContextSourcePort(
  memory: GovernedMemory,
  options: {
    readonly query: string;
    readonly categories: readonly MemoryCategory[];
    readonly sensitivityCeiling: MemorySensitivity;
    readonly limit: number;
  },
): MemoryContextSourcePort {
  const query = requiredText("memory context query", options.query);
  const categories = normalizeCategories(options.categories);
  const sensitivityCeiling = sensitivity(options.sensitivityCeiling);
  const limit = positiveInteger("memory context limit", options.limit);
  return deepFreeze({
    async query(request: MemoryContextRequest): Promise<readonly MemoryContextSegment[]> {
      const result = await memory.retrieve({
        ...request,
        query,
        categories,
        sensitivityCeiling,
        limit,
      });
      return deepFreeze(
        result.memories.map(({ record, authorityRationale }) =>
          memoryContextSegment(record, request, authorityRationale),
        ),
      );
    },
    async append(): Promise<void> {
      throw new Error("memory context source is read-only; use governed typed memory learning");
    },
  });
}

export function defineMemoryRecord(input: MemoryRecord): MemoryRecord {
  const common = normalizeCommonRecord(input);
  switch (input.category) {
    case "episodic":
      return deepFreeze({
        ...common,
        category: "episodic" as const,
        workInstanceId: requiredWorkInstance(input.workInstanceId),
        workEpisodeId: requiredWorkEpisode(input.workEpisodeId),
        summary: requiredText("episodic memory summary", input.summary),
        eventIds: uniqueRequired("episodic event ids", input.eventIds.map((id) => namespaced("event id", id))),
      });
    case "semantic":
      return deepFreeze({
        ...common,
        category: "semantic" as const,
        subjectId: namespaced("semantic memory subject", input.subjectId),
        predicate: dotted("semantic memory predicate", input.predicate),
        value: cloneStateValue(input.value),
      });
    case "procedural": {
      const applicabilityConditions = normalizeConditions("procedure applicability conditions", input.applicabilityConditions, true);
      const knownFailureConditions = normalizeConditions("procedure known failure conditions", input.knownFailureConditions, input.outcome === "failed");
      return deepFreeze({
        ...common,
        category: "procedural" as const,
        workInstanceId: requiredWorkInstance(input.workInstanceId),
        workEpisodeId: requiredWorkEpisode(input.workEpisodeId),
        procedureId: prefixed("procedure id", input.procedureId, "procedure:"),
        procedureVersion: version(input.procedureVersion),
        outcome: input.outcome,
        summary: requiredText("procedural memory summary", input.summary),
        applicabilityConditions,
        knownFailureConditions,
      });
    }
    case "preference":
      return deepFreeze({
        ...common,
        category: "preference" as const,
        principalId: prefixed("preference principal id", input.principalId, "principal:") as PrincipalId,
        key: requiredText("preference key", input.key),
        value: cloneStateValue(input.value),
      });
    case "failure-condition":
      return deepFreeze({
        ...common,
        category: "failure-condition" as const,
        workInstanceId: requiredWorkInstance(input.workInstanceId),
        workEpisodeId: requiredWorkEpisode(input.workEpisodeId),
        procedureId: prefixed("procedure id", input.procedureId, "procedure:"),
        failureCode: requiredText("failure code", input.failureCode),
        description: requiredText("failure description", input.description),
        knownFailureConditions: normalizeConditions("known failure conditions", input.knownFailureConditions, true),
      });
  }
}

function normalizeCommonRecord(input: MemoryRecord): MemoryRecordBase {
  const lifecycle = memoryLifecycle(input.lifecycle);
  const invalidatedAt = input.invalidatedAt === undefined ? undefined : normalizeInstant(input.invalidatedAt);
  if (lifecycle === "invalidated" && invalidatedAt === undefined) {
    throw new TypeError("invalidated memory requires invalidatedAt");
  }
  if (lifecycle === "active" && invalidatedAt !== undefined) {
    throw new TypeError("active memory cannot declare invalidatedAt");
  }
  const workInstanceId = input.workInstanceId === undefined ? undefined : requiredWorkInstance(input.workInstanceId);
  const workEpisodeId = input.workEpisodeId === undefined ? undefined : requiredWorkEpisode(input.workEpisodeId);
  if (workEpisodeId !== undefined && workInstanceId === undefined) {
    throw new TypeError("episode-scoped memory requires workInstanceId");
  }
  return {
    id: prefixed("memory record id", input.id, "memory-record:"),
    category: memoryCategory(input.category),
    workspaceId: prefixed("workspace id", input.workspaceId, "workspace:") as WorkspaceId,
    ...(workInstanceId === undefined ? {} : { workInstanceId }),
    ...(workEpisodeId === undefined ? {} : { workEpisodeId }),
    sensitivity: sensitivity(input.sensitivity),
    trustClass: trustClass(input.trustClass),
    confidence: unitScore("memory confidence", input.confidence),
    lifecycle,
    validTime: normalizeInterval("memory valid time", input.validTime),
    transactionTime: normalizeInterval("memory transaction time", input.transactionTime),
    provenance: uniqueRequired("memory provenance", input.provenance.map((id) => namespaced("provenance id", id))),
    ...(invalidatedAt === undefined ? {} : { invalidatedAt }),
    ...(input.revokedAt === undefined ? {} : { revokedAt: normalizeInstant(input.revokedAt) }),
  };
}

function normalizeRetrievalRequest(input: MemoryRetrievalRequest): MemoryRetrievalRequest {
  const workInstanceId = input.workInstanceId === undefined ? undefined : requiredWorkInstance(input.workInstanceId);
  const workEpisodeId = input.workEpisodeId === undefined ? undefined : requiredWorkEpisode(input.workEpisodeId);
  if (workEpisodeId !== undefined && workInstanceId === undefined) {
    throw new TypeError("episode memory retrieval requires workInstanceId");
  }
  return deepFreeze({
    principalId: prefixed("principal id", input.principalId, "principal:") as PrincipalId,
    workspaceId: prefixed("workspace id", input.workspaceId, "workspace:") as WorkspaceId,
    ...(workInstanceId === undefined ? {} : { workInstanceId }),
    ...(workEpisodeId === undefined ? {} : { workEpisodeId }),
    purpose: requiredText("memory retrieval purpose", input.purpose),
    query: requiredText("memory retrieval query", input.query),
    categories: normalizeCategories(input.categories),
    sensitivityCeiling: sensitivity(input.sensitivityCeiling),
    validAt: normalizeInstant(input.validAt),
    transactionAt: normalizeInstant(input.transactionAt),
    limit: positiveInteger("memory retrieval limit", input.limit),
  });
}

function staticExclusionReasons(record: MemoryRecord, request: MemoryRetrievalRequest): string[] {
  const reasons: string[] = [];
  if (!request.categories.includes(record.category)) reasons.push("category-not-requested");
  if (record.workspaceId !== request.workspaceId) reasons.push("cross-workspace");
  if (record.workInstanceId !== undefined && request.workInstanceId !== undefined && record.workInstanceId !== request.workInstanceId) {
    reasons.push("cross-work-instance");
  }
  if (record.workEpisodeId !== undefined && request.workEpisodeId !== undefined && record.workEpisodeId !== request.workEpisodeId) {
    reasons.push("cross-work-episode");
  }
  if (record.lifecycle === "invalidated" && record.invalidatedAt !== undefined && record.invalidatedAt <= request.transactionAt) {
    reasons.push("invalidated");
  }
  if (record.revokedAt !== undefined && record.revokedAt <= request.transactionAt) reasons.push("revoked");
  if (!containsInstant(record.validTime, request.validAt)) reasons.push("outside-valid-time");
  if (record.transactionTime.from > request.transactionAt) reasons.push("after-transaction-cutoff");
  if (record.transactionTime.to !== undefined && request.transactionAt >= record.transactionTime.to) {
    reasons.push("outside-transaction-time");
  }
  if (sensitivityRank(record.sensitivity) > sensitivityRank(request.sensitivityCeiling)) {
    reasons.push("sensitivity-exceeds-ceiling");
  }
  if (containsRawSensitiveMemory(record)) reasons.push("raw-secret-credential-or-grant");
  return reasons.sort();
}

function evaluateReadAuthority(
  evaluator: GovernedMemoryPorts["authorizeRead"],
  request: MemoryRetrievalRequest,
  record: MemoryRecord,
): MemoryReadDecision {
  if (evaluator === undefined) return { allowed: false, rationale: "no read authority evaluator configured" };
  try {
    const decision = evaluator({ request, record });
    if (decision?.allowed !== true) {
      return { allowed: false, rationale: decisionRationale(decision?.rationale, "read authority denied") };
    }
    if (!Number.isFinite(decision.authorityLevel) || decision.authorityLevel < 0) {
      return { allowed: false, rationale: "read authority returned an invalid authority level" };
    }
    const rationale = decisionRationale(decision.rationale, "read authority allowed without rationale");
    if (rationale === "read authority allowed without rationale") return { allowed: false, rationale };
    return { allowed: true, authorityLevel: decision.authorityLevel, rationale };
  } catch {
    return { allowed: false, rationale: "read authority evaluator failed" };
  }
}

function evaluateWriteAuthority(
  evaluator: GovernedMemoryPorts["authorizeWrite"],
  input: Parameters<NonNullable<GovernedMemoryPorts["authorizeWrite"]>>[0],
): MemoryWriteDecision {
  if (evaluator === undefined) return { allowed: false, rationale: "no write authority evaluator configured" };
  try {
    const decision = evaluator(input);
    if (decision?.allowed !== true) {
      return { allowed: false, rationale: decisionRationale(decision?.rationale, "write authority denied") };
    }
    const rationale = decisionRationale(decision.rationale, "write authority allowed without rationale");
    if (rationale === "write authority allowed without rationale") return { allowed: false, rationale };
    return { allowed: true, rationale };
  } catch {
    return { allowed: false, rationale: "write authority evaluator failed" };
  }
}

function rankMemory(
  record: MemoryRecord,
  authority: Extract<MemoryReadDecision, { readonly allowed: true }>,
  relevance: number,
  transactionAt: string,
): RankedMemory {
  const authorityScore = clamp(authority.authorityLevel / 100);
  const trust = trustScore(record.trustClass);
  const freshness = freshnessScore(record.transactionTime.from, transactionAt);
  const total = round(relevance * 0.55 + authorityScore * 0.25 + trust * 0.15 + freshness * 0.05);
  return deepFreeze({
    record,
    authorityRationale: authority.rationale,
    score: {
      relevance,
      authorityLevel: authority.authorityLevel,
      authority: round(authorityScore),
      trust,
      freshness,
      total,
    },
  });
}

function compareRankedMemory(left: RankedMemory, right: RankedMemory): number {
  return (
    right.score.total - left.score.total ||
    right.score.authorityLevel - left.score.authorityLevel ||
    right.score.trust - left.score.trust ||
    right.score.relevance - left.score.relevance ||
    left.record.id.localeCompare(right.record.id)
  );
}

function memoryContextSegment(
  record: MemoryRecord,
  request: MemoryContextRequest,
  authorityRationale: string,
): MemoryContextSegment {
  return deepFreeze({
    id: `context-segment:${record.id}`,
    workspaceId: request.workspaceId,
    workInstanceId: request.workInstanceId,
    workEpisodeId: request.workEpisodeId,
    content: memoryContextContent(record),
    source: { id: record.id, kind: `memory.${record.category}` },
    trustClass: record.trustClass,
    validTime: record.validTime,
    transactionTime: record.transactionTime,
    provenance: record.provenance,
    ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt }),
    authorityFilter: { decision: "allowed" as const, rationale: authorityRationale },
  });
}

function memoryContextContent(record: MemoryRecord): StateValue {
  switch (record.category) {
    case "episodic":
      return { category: record.category, summary: record.summary, eventIds: record.eventIds };
    case "semantic":
      return { category: record.category, subjectId: record.subjectId, predicate: record.predicate, value: record.value };
    case "procedural":
      return {
        category: record.category,
        procedureId: record.procedureId,
        procedureVersion: record.procedureVersion,
        outcome: record.outcome,
        summary: record.summary,
        applicabilityConditions: conditionsValue(record.applicabilityConditions),
        knownFailureConditions: conditionsValue(record.knownFailureConditions),
      };
    case "preference":
      return { category: record.category, principalId: record.principalId, key: record.key, value: record.value };
    case "failure-condition":
      return {
        category: record.category,
        procedureId: record.procedureId,
        failureCode: record.failureCode,
        description: record.description,
        knownFailureConditions: conditionsValue(record.knownFailureConditions),
      };
  }
}

function containsRawSensitiveMemory(record: MemoryRecord): boolean {
  return containsSensitiveValue(memoryContextContent(record)) || containsSensitiveValue(record.provenance);
}

function containsSensitiveValue(value: StateValue): boolean {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    return normalized.includes("secret:") || normalized.includes("credential-ref:") || normalized.includes("capability-grant:");
  }
  if (Array.isArray(value)) return value.some(containsSensitiveValue);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, nested]) =>
        /(?:secret|password|passphrase|token|credential|bearer|private[-_]?key|grant)/i.test(key) ||
        containsSensitiveValue(nested),
    );
  }
  return false;
}

function normalizeConditions(
  name: string,
  input: readonly ApplicabilityCondition[],
  required: boolean,
): readonly ApplicabilityCondition[] {
  const conditions = input.map((condition) => {
    const key = requiredText(`${name} key`, condition.key);
    const operator = conditionOperator(condition.operator);
    const value = condition.value === undefined ? undefined : requiredText(`${name} value`, condition.value);
    if ((operator === "equals" || operator === "not-equals") && value === undefined) {
      throw new TypeError(`${name} ${operator} requires a value`);
    }
    if ((operator === "present" || operator === "absent") && value !== undefined) {
      throw new TypeError(`${name} ${operator} cannot declare a value`);
    }
    return { key, operator, ...(value === undefined ? {} : { value }) };
  });
  conditions.sort((left, right) => conditionKey(left).localeCompare(conditionKey(right)));
  if (required && conditions.length === 0) throw new TypeError(`${name} must not be empty`);
  if (new Set(conditions.map(conditionKey)).size !== conditions.length) {
    throw new Error(`${name} must not contain duplicates`);
  }
  return deepFreeze(conditions);
}

function conditionsMatch(
  conditions: readonly ApplicabilityCondition[],
  actual: Readonly<Record<string, string>>,
): boolean {
  return conditions.every((condition) => {
    const value = actual[condition.key];
    switch (condition.operator) {
      case "equals": return value === condition.value;
      case "not-equals": return value !== condition.value;
      case "present": return value !== undefined;
      case "absent": return value === undefined;
    }
  });
}

function conditionsValue(conditions: readonly ApplicabilityCondition[]): StateValue {
  return conditions.map((condition) => ({
    key: condition.key,
    operator: condition.operator,
    ...(condition.value === undefined ? {} : { value: condition.value }),
  }));
}

function conditionKey(condition: ApplicabilityCondition): string {
  return `${condition.key}\u0000${condition.operator}\u0000${condition.value ?? ""}`;
}

function uniqueRecords(records: readonly MemoryRecord[]): MemoryRecord[] {
  const sorted = [...records].sort((left, right) => left.id.localeCompare(right.id));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]?.id === sorted[index]?.id) throw new Error(`memory record appears more than once: ${sorted[index]?.id}`);
  }
  return sorted;
}

function normalizeCategories(input: readonly MemoryCategory[]): readonly MemoryCategory[] {
  const categories = [...new Set(input.map(memoryCategory))].sort();
  if (categories.length === 0) throw new TypeError("memory categories must not be empty");
  return deepFreeze(categories);
}

function memoryCategory(value: string): MemoryCategory {
  if (["episodic", "semantic", "procedural", "preference", "failure-condition"].includes(value)) return value as MemoryCategory;
  throw new TypeError(`unsupported memory category: ${value}`);
}

function memoryLifecycle(value: string): MemoryLifecycle {
  if (value === "active" || value === "invalidated") return value;
  throw new TypeError(`unsupported memory lifecycle: ${value}`);
}

function sensitivity(value: string): MemorySensitivity {
  if (["public", "internal", "confidential", "restricted"].includes(value)) return value as MemorySensitivity;
  throw new TypeError(`unsupported memory sensitivity: ${value}`);
}

function sensitivityRank(value: MemorySensitivity): number {
  return ["public", "internal", "confidential", "restricted"].indexOf(value);
}

function trustClass(value: string): MemoryTrustClass {
  if (["authoritative", "verified", "asserted", "inferred", "untrusted"].includes(value)) return value as MemoryTrustClass;
  throw new TypeError(`unsupported memory trust class: ${value}`);
}

function trustScore(value: MemoryTrustClass): number {
  return { authoritative: 1, verified: 0.8, asserted: 0.55, inferred: 0.3, untrusted: 0 }[value];
}

function freshnessScore(recordedAt: string, transactionAt: string): number {
  const ageDays = Math.max(0, (Date.parse(transactionAt) - Date.parse(recordedAt)) / 86_400_000);
  return round(1 / (1 + ageDays / 30));
}

function normalizeInterval(name: string, input: MemoryTimeInterval): MemoryTimeInterval {
  const from = normalizeInstant(input.from);
  const to = input.to === undefined ? undefined : normalizeInstant(input.to);
  if (to !== undefined && to <= from) throw new RangeError(`${name} end must follow start`);
  return deepFreeze({ from, ...(to === undefined ? {} : { to }) });
}

function containsInstant(interval: MemoryTimeInterval, value: string): boolean {
  return value >= interval.from && (interval.to === undefined || value < interval.to);
}

function uniqueRequired(name: string, input: readonly string[]): readonly string[] {
  const result = [...new Set(input.map((value) => requiredText(name, value)))].sort();
  if (result.length === 0) throw new TypeError(`${name} must not be empty`);
  return deepFreeze(result);
}

function conditionOperator(value: string): ApplicabilityCondition["operator"] {
  if (["equals", "not-equals", "present", "absent"].includes(value)) return value as ApplicabilityCondition["operator"];
  throw new TypeError(`unsupported applicability condition operator: ${value}`);
}

function requiredWorkInstance(value: string): WorkInstanceId {
  return prefixed("work instance id", value, "work-instance:") as WorkInstanceId;
}

function requiredWorkEpisode(value: string): WorkEpisodeId {
  return prefixed("work episode id", value, "work-episode:") as WorkEpisodeId;
}

function version(value: string): string {
  const normalized = requiredText("procedure version", value);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) throw new TypeError(`invalid procedure version: ${value}`);
  return normalized;
}

function dotted(name: string, value: string): string {
  const normalized = requiredText(name, value);
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(normalized)) throw new TypeError(`${name} must use dotted lower-case segments`);
  return normalized;
}

function prefixed(name: string, value: string, prefix: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${name} must start with ${prefix}`);
  return normalized;
}

function namespaced(name: string, value: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.includes(":")) throw new TypeError(`${name} must be namespace-qualified`);
  return normalized;
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function decisionRationale(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return date.toISOString();
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function unitScore(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be between 0 and 1`);
  return value;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function cloneStateValue(value: StateValue): StateValue {
  if (Array.isArray(value)) return value.map(cloneStateValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneStateValue(nested)]));
  }
  return value;
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
