import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkEpisodeId, WorkInstanceId } from "../../work/src/index.ts";
import type { PrincipalId, WorkspaceId } from "../../workspace/src/index.ts";
import {
  Harness,
  defineHarnessCandidate,
  type HarnessCandidateDefinition,
  type HarnessRequest,
} from "../src/index.ts";

test("selects deterministically only after explicit applicability, authority, budget, and risk gates", async () => {
  const request: HarnessRequest = {
    traceId: "trace:repair-481",
    principalId: principal("principal:repair-agent"),
    workspaceId: workspace("workspace:alpha"),
    workInstanceId: workInstance("work-instance:incident-481"),
    workEpisodeId: workEpisode("work-episode:repair-1"),
    purpose: "repair checkout",
    jurisdiction: "NG",
    availableProviderIds: ["provider:local-compute", "provider:git"],
    bindings: {
      app: { repository: "repo:checkout", runtime: "gpu" },
      work: { environment: "environment:staging" },
      overrides: { runtime: "cpu" },
      requiredKeys: ["repository", "runtime", "environment"],
    },
    executionBudget: {
      maxCost: { amount: 5, currency: "USD" },
      maxDurationMs: 60_000,
      maxTokens: 10_000,
    },
    maxRisk: 0.5,
    conditions: { region: "ng-west", deploymentMode: "read-only" },
  };
  const candidates: HarnessCandidateDefinition[] = [
    candidate("model:foreign", "MODEL", 0.99, { jurisdictions: ["US"] }),
    candidate("tool:missing-provider", "TOOL", 0.95, {
      requiredProviderIds: ["provider:unavailable"],
    }),
    candidate("skill:gpu-default", "SKILL", 0.9, {
      defaultBindings: { runtime: "gpu" },
      bindingRequirements: { runtime: ["gpu"] },
    }),
    candidate("procedure:known-failure", "PROCEDURE", 0.85),
    candidate("agent:over-budget", "AGENT", 0.8, {
      estimatedBudget: {
        cost: { amount: 9, currency: "USD" },
        durationMs: 20_000,
        tokens: 2_000,
      },
    }),
    candidate("provider:authority-denied", "PROVIDER", 0.75),
    candidate("agent:risky", "AGENT", 0.7, { estimatedRisk: 0.9 }),
    candidate("procedure:safe-repair", "PROCEDURE", 0.65),
  ];
  const harness = new Harness({
    evaluateMemoryApplicability({ candidate }) {
      return candidate.id === "procedure:known-failure"
        ? {
            applicable: true,
            score: 0.1,
            knownFailureMemoryIds: ["memory-record:read-only-failure"],
            rationale: "known failure condition deploymentMode=read-only matched",
          }
        : { applicable: true, score: 0.8, knownFailureMemoryIds: [], rationale: "no known failure matched" };
    },
    evaluateAuthority({ candidate }) {
      return candidate.id === "provider:authority-denied"
        ? { allowed: false, rationale: "EXECUTE capability denied" }
        : { allowed: true, score: 0.8, rationale: "candidate execution authorized" };
    },
    evaluateBudget({ candidate, request }) {
      const within =
        candidate.estimatedBudget.cost.currency === request.executionBudget.maxCost.currency &&
        candidate.estimatedBudget.cost.amount <= request.executionBudget.maxCost.amount &&
        candidate.estimatedBudget.durationMs <= request.executionBudget.maxDurationMs &&
        candidate.estimatedBudget.tokens <= request.executionBudget.maxTokens;
      return within
        ? { allowed: true, score: 0.8, rationale: "candidate is within requested execution budget" }
        : { allowed: false, rationale: "candidate exceeds requested execution budget" };
    },
    evaluateRisk({ candidate, request }) {
      return candidate.estimatedRisk <= request.maxRisk
        ? { allowed: true, score: 1 - candidate.estimatedRisk, rationale: "risk is within tolerance" }
        : { allowed: false, rationale: "candidate risk exceeds tolerance" };
    },
  });

  const first = await harness.select(request, candidates);
  const second = await harness.select(request, [...candidates].reverse());
  assert.deepEqual(first, second);
  assert.equal(first.selected?.candidate.id, "procedure:safe-repair");
  assert.equal(first.traceId, request.traceId);
  assert.deepEqual(first.effectiveBindings, {
    environment: "environment:staging",
    repository: "repo:checkout",
    runtime: "cpu",
  });
  assert.match(first.authorityRationale, /authorized/);
  assert.match(first.budgetRationale, /within/);
  assert.equal(Object.isFrozen(first), true);

  const rejected = new Map(first.rejectedAlternatives.map((evaluation) => [evaluation.candidate.id, evaluation]));
  assert.match(rejected.get("model:foreign")?.reasons.join(" ") ?? "", /jurisdiction-not-allowed:NG/);
  assert.match(rejected.get("tool:missing-provider")?.reasons.join(" ") ?? "", /missing-provider:provider:unavailable/);
  const skill = rejected.get("skill:gpu-default");
  assert.match(skill?.reasons.join(" ") ?? "", /binding-incompatible:runtime=cpu/);
  assert.equal(skill?.effectiveBindings.runtime, "cpu");
  assert.match(rejected.get("agent:over-budget")?.reasons.join(" ") ?? "", /budget/);
  assert.match(rejected.get("provider:authority-denied")?.reasons.join(" ") ?? "", /authority/);
  assert.match(rejected.get("agent:risky")?.reasons.join(" ") ?? "", /risk/);

  const penalized = first.eligibleAlternatives.find(
    ({ candidate }) => candidate.id === "procedure:known-failure",
  );
  assert.deepEqual(penalized?.memory.knownFailureMemoryIds, ["memory-record:read-only-failure"]);
  assert.equal(penalized?.score.memoryApplicability, 0.1);
  assert.ok((penalized?.score.total ?? 1) < (first.selected?.score.total ?? 0));
  assert.equal(first.selected?.score.relevance, 0.65);

  const defaultDeny = await new Harness({}).select(request, [candidate("tool:relevant", "TOOL", 1)]);
  assert.equal(defaultDeny.selected, undefined);
  const defaultReasons = defaultDeny.rejectedAlternatives[0]?.reasons.join(" ") ?? "";
  assert.match(defaultReasons, /missing-memory-applicability-evaluator/);
  assert.match(defaultReasons, /missing-authority-evaluator/);
  assert.match(defaultReasons, /missing-budget-evaluator/);
  assert.match(defaultReasons, /missing-risk-evaluator/);
  assert.equal(defaultDeny.rejectedAlternatives[0]?.score.relevance, 1);
});

function candidate(
  id: string,
  kind: HarnessCandidateDefinition["kind"],
  relevance: number,
  override: Partial<HarnessCandidateDefinition> = {},
): HarnessCandidateDefinition {
  return defineHarnessCandidate({
    id,
    kind,
    version: "1.0.0",
    relevance,
    jurisdictions: ["NG"],
    requiredProviderIds: ["provider:local-compute"],
    defaultBindings: {},
    bindingRequirements: {},
    estimatedBudget: {
      cost: { amount: 1, currency: "USD" },
      durationMs: 10_000,
      tokens: 1_000,
    },
    estimatedRisk: 0.2,
    ...override,
  });
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
