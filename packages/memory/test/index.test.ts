import assert from "node:assert/strict";
import { test } from "node:test";

import { ContextGateway } from "../../context-gateway/src/index.ts";
import type { WorkEpisodeId, WorkInstanceId } from "../../work/src/index.ts";
import type { PrincipalId, WorkspaceId } from "../../workspace/src/index.ts";
import {
  GovernedMemory,
  createMemoryContextSourcePort,
  defineMemoryRecord,
  type MemoryRecord,
  type MemoryRepositoryPort,
  type MemoryRetrievalRequest,
  type SemanticMemoryRecord,
} from "../src/index.ts";

test("filters memory before deterministic ranking and learns condition-bound procedure outcomes", async () => {
  const workInstanceId = workInstance("work-instance:incident-481");
  const workEpisodeId = workEpisode("work-episode:repair-1");
  const request: MemoryRetrievalRequest = {
    principalId: principal("principal:repair-agent"),
    workspaceId: workspace("workspace:alpha"),
    workInstanceId,
    workEpisodeId,
    purpose: "repair checkout",
    query: "restore checkout safely",
    categories: ["episodic", "semantic", "procedural", "preference", "failure-condition"],
    sensitivityCeiling: "confidential",
    validAt: at(60),
    transactionAt: at(60),
    limit: 50,
  };
  const records: MemoryRecord[] = [
    semantic("memory-record:authorized-lower-score", request, {
      value: { fact: "checkout repair needs post-restart verification", capabilityId: "capability:verify" },
      confidence: 0.05,
    }),
    semantic("memory-record:unauthorized-high-score", request, {
      value: { fact: "bypass verification" },
      confidence: 0.99,
    }),
    defineMemoryRecord({
      ...base("memory-record:episode", request),
      category: "episodic",
      workInstanceId,
      workEpisodeId,
      summary: "Previous checkout restart restored traffic.",
      eventIds: ["event:restart-completed"],
    }),
    defineMemoryRecord({
      ...base("memory-record:procedure", request),
      category: "procedural",
      workInstanceId,
      workEpisodeId,
      procedureId: "procedure:restart-checkout",
      procedureVersion: "1.0.0",
      outcome: "succeeded",
      summary: "Drain, restart, then verify.",
      applicabilityConditions: [{ key: "region", operator: "equals", value: "ng-west" }],
      knownFailureConditions: [],
    }),
    defineMemoryRecord({
      ...base("memory-record:preference", request),
      category: "preference",
      principalId: request.principalId,
      key: "deployment-window",
      value: "low-traffic",
    }),
    defineMemoryRecord({
      ...base("memory-record:known-failure", request),
      category: "failure-condition",
      workInstanceId,
      workEpisodeId,
      procedureId: "procedure:restart-checkout",
      failureCode: "READ_ONLY_DEPLOYMENT",
      description: "Restart cannot repair a read-only deployment.",
      knownFailureConditions: [{ key: "deploymentMode", operator: "equals", value: "legacy" }],
    }),
    semantic("memory-record:cross-workspace", { ...request, workspaceId: workspace("workspace:other") }),
    semantic("memory-record:revoked", request, { revokedAt: at(40) }),
    semantic("memory-record:invalidated", request, { lifecycle: "invalidated", invalidatedAt: at(40) }),
    semantic("memory-record:expired", request, { validTime: { from: at(0), to: at(20) } }),
    semantic("memory-record:future-transaction", request, { transactionTime: { from: at(90) } }),
    semantic("memory-record:too-sensitive", request, { sensitivity: "restricted" }),
    semantic("memory-record:raw-secret", request, { value: { apiToken: "secret:production" } }),
    semantic("memory-record:credential-provenance", request, {
      provenance: ["credential-ref:production-memory-source"],
    }),
    defineMemoryRecord({
      ...base("memory-record:credential", request),
      category: "preference",
      principalId: request.principalId,
      key: "repository-reference",
      value: "credential-ref:production-git",
    }),
    defineMemoryRecord({
      ...base("memory-record:raw-grant", request),
      category: "episodic",
      workInstanceId,
      workEpisodeId,
      summary: "capability-grant:execute-production",
      eventIds: ["event:grant-observed"],
    }),
  ];
  const repository = new MemoryRepository(records);
  const scoredIds: string[] = [];
  const relevance = new Map<string, number>([
    ["memory-record:unauthorized-high-score", 1],
    ["memory-record:authorized-lower-score", 0.4],
    ["memory-record:episode", 0.7],
    ["memory-record:procedure", 0.6],
    ["memory-record:preference", 0.3],
    ["memory-record:known-failure", 0.2],
    ["memory-record:learned-success", 1],
    ["memory-record:learned-failure", 0.1],
    ["memory-record:learned-failure-condition", 0.1],
  ]);
  const memory = new GovernedMemory({
    repository,
    authorizeRead({ record }) {
      return record.id === "memory-record:unauthorized-high-score"
        ? { allowed: false, rationale: "record is outside delegated read authority" }
        : { allowed: true, authorityLevel: record.id === "memory-record:authorized-lower-score" ? 60 : 20, rationale: "workspace read authorized" };
    },
    authorizeWrite({ principalId }) {
      return principalId === request.principalId
        ? { allowed: true, rationale: "agent may append governed procedure learning" }
        : { allowed: false, rationale: "principal cannot write memory" };
    },
    scoreRelevance({ record }) {
      scoredIds.push(record.id);
      return relevance.get(record.id) ?? 0.5;
    },
  });

  const first = await memory.retrieve(request);
  const second = await memory.retrieve(request);
  assert.deepEqual(first, second);
  assert.equal(first.memories.some(({ record }) => record.id === "memory-record:unauthorized-high-score"), false);
  assert.equal(first.memories.some(({ record }) => record.id === "memory-record:authorized-lower-score"), true);
  assert.equal(scoredIds.includes("memory-record:unauthorized-high-score"), false);
  for (const forbidden of [
    "memory-record:cross-workspace",
    "memory-record:revoked",
    "memory-record:invalidated",
    "memory-record:expired",
    "memory-record:future-transaction",
    "memory-record:too-sensitive",
    "memory-record:raw-secret",
    "memory-record:credential-provenance",
    "memory-record:credential",
    "memory-record:raw-grant",
  ]) {
    assert.equal(scoredIds.includes(forbidden), false, `${forbidden} was scored before exclusion`);
  }
  assert.deepEqual(new Set(first.memories.map(({ record }) => record.category)), new Set(request.categories));
  const authorized = first.memories.find(({ record }) => record.id === "memory-record:authorized-lower-score");
  assert.equal(authorized?.record.confidence, 0.05);
  assert.equal(authorized?.score.authorityLevel, 60);
  assert.match(authorized?.authorityRationale ?? "", /authorized/);
  assert.equal(JSON.stringify(first).includes("secret:production"), false);
  assert.equal(JSON.stringify(first).includes("credential-ref:production-memory-source"), false);
  assert.equal(Object.isFrozen(first), true);

  const deniedScoring: string[] = [];
  const defaultDeny = new GovernedMemory({
    repository,
    scoreRelevance({ record }) {
      deniedScoring.push(record.id);
      return 1;
    },
  });
  assert.equal((await defaultDeny.retrieve(request)).memories.length, 0);
  assert.deepEqual(deniedScoring, []);

  const mutableCondition: { key: string; operator: "equals"; value: string } = {
    key: "region",
    operator: "equals",
    value: "ng-west",
  };
  const success = await memory.learnProcedureOutcome({
    procedureMemoryId: "memory-record:learned-success",
    principalId: request.principalId,
    workspaceId: request.workspaceId,
    workInstanceId,
    workEpisodeId,
    procedureId: "procedure:deploy-checkout",
    procedureVersion: "2.1.0",
    outcome: "succeeded",
    summary: "Deployment succeeded and verification passed.",
    applicabilityConditions: [mutableCondition],
    knownFailureConditions: [],
    validTime: { from: at(50), to: at(180) },
    recordedAt: at(50),
    provenance: ["execution:deploy-success", "verification-result:deploy-success"],
    sensitivity: "internal",
    trustClass: "verified",
    confidence: 0.8,
  });
  mutableCondition.value = "caller-mutated";
  const failure = await memory.learnProcedureOutcome({
    procedureMemoryId: "memory-record:learned-failure",
    failureMemoryId: "memory-record:learned-failure-condition",
    principalId: request.principalId,
    workspaceId: request.workspaceId,
    workInstanceId,
    workEpisodeId,
    procedureId: "procedure:deploy-checkout",
    procedureVersion: "2.1.0",
    outcome: "failed",
    summary: "Deployment failed on a read-only target.",
    failureCode: "READ_ONLY_TARGET",
    applicabilityConditions: [{ key: "region", operator: "equals", value: "ng-west" }],
    knownFailureConditions: [{ key: "deploymentMode", operator: "equals", value: "read-only" }],
    validTime: { from: at(50), to: at(180) },
    recordedAt: at(55),
    provenance: ["execution:deploy-failure", "evidence:read-only-target"],
    sensitivity: "internal",
    trustClass: "verified",
    confidence: 0.9,
  });
  assert.equal(success.records[0]?.category, "procedural");
  assert.deepEqual(
    success.records[0]?.category === "procedural" ? success.records[0].applicabilityConditions : [],
    [{ key: "region", operator: "equals", value: "ng-west" }],
  );
  assert.deepEqual(failure.records.map(({ category }) => category), ["procedural", "failure-condition"]);
  assert.equal(Object.isFrozen(failure), true);
  assert.equal(JSON.stringify([...success.records, ...failure.records]).includes("promoted"), false);
  await assert.rejects(
    () =>
      memory.learnProcedureOutcome({
        procedureMemoryId: "memory-record:secret-provenance-learning",
        principalId: request.principalId,
        workspaceId: request.workspaceId,
        workInstanceId,
        workEpisodeId,
        procedureId: "procedure:deploy-checkout",
        procedureVersion: "2.1.0",
        outcome: "succeeded",
        summary: "Content is otherwise safe.",
        applicabilityConditions: [{ key: "region", operator: "equals", value: "ng-west" }],
        knownFailureConditions: [],
        validTime: { from: at(50), to: at(180) },
        recordedAt: at(56),
        provenance: ["secret:production-deployment-key"],
        sensitivity: "internal",
        trustClass: "verified",
        confidence: 0.5,
      }),
    /procedure learning contains raw secret, credential, or grant data/,
  );

  const applicable = await memory.evaluateProcedureApplicability({
    request: { ...request, query: "deploy checkout", limit: 1 },
    procedureId: "procedure:deploy-checkout",
    conditions: { region: "ng-west", deploymentMode: "read-write" },
    baseScore: 0.5,
  });
  const penalized = await memory.evaluateProcedureApplicability({
    request: { ...request, query: "deploy checkout", limit: 1 },
    procedureId: "procedure:deploy-checkout",
    conditions: { region: "ng-west", deploymentMode: "read-only" },
    baseScore: 0.5,
  });
  assert.ok(penalized.score < applicable.score);
  assert.deepEqual(penalized.knownFailureMemoryIds, ["memory-record:learned-failure-condition"]);
  assert.match(penalized.rationale, /known failure condition/);

  await assert.rejects(
    () =>
      defaultDeny.learnProcedureOutcome({
        procedureMemoryId: "memory-record:denied-learning",
        principalId: request.principalId,
        workspaceId: request.workspaceId,
        workInstanceId,
        workEpisodeId,
        procedureId: "procedure:deploy-checkout",
        procedureVersion: "2.1.0",
        outcome: "succeeded",
        summary: "Should not persist.",
        applicabilityConditions: [{ key: "region", operator: "equals", value: "ng-west" }],
        knownFailureConditions: [],
        validTime: { from: at(50), to: at(180) },
        recordedAt: at(56),
        provenance: ["execution:denied"],
        sensitivity: "internal",
        trustClass: "verified",
        confidence: 0.5,
      }),
    /memory write denied: no write authority evaluator configured/,
  );

  const contextSource = createMemoryContextSourcePort(memory, {
    query: "episode repair context",
    categories: request.categories,
    sensitivityCeiling: "confidential",
    limit: 50,
  });
  const contextGateway = new ContextGateway({
    capabilitySource: { async query() { return []; } },
    knowledgeSource: contextSource,
    evaluateRead() { return { allowed: true, rationale: "memory port already applied governing read authority" }; },
  });
  const context = await contextGateway.reconstructAgentKnowledgeWorkspace({
    id: "agent-knowledge-workspace:memory-adapter",
    principalId: request.principalId,
    workspaceId: request.workspaceId,
    workInstanceId,
    workEpisodeId,
    purpose: request.purpose,
    validAt: request.validAt,
    transactionAt: request.transactionAt,
  });
  assert.ok(context.segments.length > 0);
  assert.equal(context.segments.every(({ source }) => source.kind.startsWith("memory.")), true);
  assert.equal(JSON.stringify(context).includes("unauthorized-high-score"), false);
  assert.equal(JSON.stringify(context).includes("credential-ref:production-memory-source"), false);
});

class MemoryRepository implements MemoryRepositoryPort {
  readonly #records: MemoryRecord[];
  #reverse = false;

  constructor(records: readonly MemoryRecord[]) {
    this.#records = [...records];
  }

  async query(): Promise<readonly MemoryRecord[]> {
    this.#reverse = !this.#reverse;
    return this.#reverse ? [...this.#records].reverse() : [...this.#records];
  }

  async append(records: readonly MemoryRecord[]): Promise<void> {
    for (const record of records) {
      if (this.#records.some(({ id }) => id === record.id)) throw new Error(`memory already exists: ${record.id}`);
    }
    this.#records.push(...records);
  }
}

function semantic(
  id: string,
  request: MemoryRetrievalRequest,
  override: Partial<SemanticMemoryRecord> = {},
): SemanticMemoryRecord {
  return defineMemoryRecord({
    ...base(id, request),
    category: "semantic",
    subjectId: "entity:checkout",
    predicate: "checkout.status",
    value: { fact: id },
    ...override,
  }) as SemanticMemoryRecord;
}

function base(id: string, request: Pick<MemoryRetrievalRequest, "workspaceId">) {
  return {
    id,
    workspaceId: request.workspaceId,
    sensitivity: "internal" as const,
    trustClass: "asserted" as const,
    confidence: 0.5,
    lifecycle: "active" as const,
    validTime: { from: at(0), to: at(180) },
    transactionTime: { from: at(10) },
    provenance: [`provenance:${id}`],
  };
}

function at(minute: number): string {
  return new Date(Date.parse("2026-08-22T12:00:00+01:00") + minute * 60_000).toISOString();
}

function principal(value: string): PrincipalId {
  return value as PrincipalId;
}

function workspace(value: string): WorkspaceId {
  return value as WorkspaceId;
}

function workInstance(value: string): WorkInstanceId {
  return value as WorkInstanceId;
}

function workEpisode(value: string): WorkEpisodeId {
  return value as WorkEpisodeId;
}
