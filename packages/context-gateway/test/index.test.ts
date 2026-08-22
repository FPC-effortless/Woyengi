import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkEpisodeId, WorkInstanceId } from "../../work/src/index.ts";
import type { PrincipalId, WorkspaceId } from "../../workspace/src/index.ts";
import {
  ContextGateway,
  type ContextSegment,
  type ContextSegmentRecord,
  type EpisodeCapabilityCandidate,
  type EpisodeContextRequest,
} from "../src/index.ts";

test("bounds episode capabilities and reconstructs deterministic authority-filtered knowledge", async () => {
  const request: EpisodeContextRequest = {
    principalId: principal("principal:agent-repair"),
    workspaceId: workspace("workspace:alpha"),
    workInstanceId: workInstance("work-instance:incident-481"),
    workEpisodeId: workEpisode("work-episode:repair-1"),
    purpose: "repair checkout",
    validAt: at(30),
    transactionAt: at(60),
  };
  const otherWorkspace = workspace("workspace:other");
  const capabilities: EpisodeCapabilityCandidate[] = [
    capability("provider:local-compute", "provider", request),
    capability("resource:checkout-repository", "resource", request),
    capability("authority:repair-checkout", "authority", request, {
      details: { capabilityId: "capability:repair-checkout" },
    }),
    capability("budget:repair-limit", "budget", request),
    capability("policy:change-control", "policy", request),
    capability("provider:other-workspace", "provider", { ...request, workspaceId: otherWorkspace }),
    capability("provider:other-work-instance", "provider", {
      ...request,
      workInstanceId: workInstance("work-instance:other"),
    }),
    capability("provider:other-work-episode", "provider", {
      ...request,
      workEpisodeId: workEpisode("work-episode:other"),
    }),
    capability("resource:expired", "resource", request, {
      validTime: { from: at(0), to: at(10) },
    }),
    capability("authority:revoked", "authority", request, { revokedAt: at(45) }),
    capability("policy:unauthorized", "policy", request),
    capability("provider:credential-reference", "provider", request, {
      details: { reference: "credential-ref:production-database" },
    }),
  ];
  const segments: ContextSegmentRecord[] = [
    segment("context-segment:procedure", request, {
      content: { procedure: "procedure:restart-checkout", steps: ["drain", "restart", "verify"] },
      trustClass: "verified",
      source: { id: "procedure:restart-checkout", kind: "procedure" },
      provenance: ["claim:restart-runbook", "evidence:incident-470"],
    }),
    segment("context-segment:observation", request, {
      content: { observation: "checkout latency is elevated" },
      trustClass: "asserted",
      source: { id: "observation:latency", kind: "observation" },
      provenance: ["evidence:latency-trace"],
    }),
    segment("context-segment:cross-workspace", { ...request, workspaceId: otherWorkspace }),
    segment("context-segment:cross-work-instance", {
      ...request,
      workInstanceId: workInstance("work-instance:other"),
    }),
    segment("context-segment:cross-work-episode", {
      ...request,
      workEpisodeId: workEpisode("work-episode:other"),
    }),
    segment("context-segment:out-of-time", request, {
      validTime: { from: at(0), to: at(10) },
    }),
    segment("context-segment:future-transaction", request, {
      transactionTime: { from: at(90) },
    }),
    segment("context-segment:revoked", request, { revokedAt: at(45) }),
    segment("context-segment:unauthorized", request),
    segment("context-segment:secret", request, {
      content: { apiToken: "secret-value-must-not-leak" },
    }),
    segment("context-segment:grant", request, {
      content: { grant: { operations: ["EXECUTE"], bearer: "raw-grant" } },
    }),
    segment("context-segment:secret-locator", request, {
      source: {
        id: "observation:secret-locator",
        kind: "observation",
        locator: "secret:production-database-password",
      },
    }),
    segment("context-segment:credential-reference", request, {
      content: { reference: "credential-ref:production-database" },
    }),
    segment("context-segment:credential-provenance", request, {
      provenance: ["credential-ref:production-database"],
    }),
  ];
  let reverse = false;
  const appended: ContextSegment[] = [];
  const gateway = new ContextGateway({
    capabilitySource: {
      async query() {
        reverse = !reverse;
        return reverse ? [...capabilities].reverse() : capabilities;
      },
    },
    knowledgeSource: {
      async query() {
        reverse = !reverse;
        return reverse ? [...segments].reverse() : segments;
      },
      async append(value) {
        appended.push(value);
      },
    },
    evaluateApplicability(candidate) {
      return candidate.id === "policy:unauthorized"
        ? { applicable: false, rationale: "policy is not delegated to this episode" }
        : { applicable: true, rationale: `applicable to ${request.workEpisodeId}` };
    },
    evaluateRead(input) {
      return input.segment.id === "context-segment:unauthorized"
        ? { allowed: false, rationale: "read capability does not cover this source" }
        : { allowed: true, rationale: `read authorized for ${input.request.purpose}` };
    },
    evaluateWrite(input) {
      return input.segment.source.kind === "agent-proposal"
        ? { allowed: true, rationale: "agent may propose episode-scoped context" }
        : { allowed: false, rationale: "write source is not permitted" };
    },
  });

  const capabilityContext = await gateway.buildEpisodeCapabilityContext({
    ...request,
    id: "episode-capability-context:repair-1",
  });
  assert.deepEqual(capabilityContext.providers.map(({ id }) => id), ["provider:local-compute"]);
  assert.deepEqual(capabilityContext.resources.map(({ id }) => id), ["resource:checkout-repository"]);
  assert.deepEqual(capabilityContext.authority.map(({ id }) => id), ["authority:repair-checkout"]);
  assert.deepEqual(capabilityContext.authority[0]?.details, {
    capabilityId: "capability:repair-checkout",
  });
  assert.deepEqual(capabilityContext.budgets.map(({ id }) => id), ["budget:repair-limit"]);
  assert.deepEqual(capabilityContext.policies.map(({ id }) => id), ["policy:change-control"]);
  assert.equal(capabilityContext.workspaceId, request.workspaceId);
  assert.equal(capabilityContext.workInstanceId, request.workInstanceId);
  assert.equal(capabilityContext.workEpisodeId, request.workEpisodeId);
  assert.equal(Object.isFrozen(capabilityContext), true);
  assert.equal(
    capabilityContext.journal.find(({ subjectId }) => subjectId === "authority:revoked")?.reasons[0],
    "revoked",
  );

  const first = await gateway.reconstructAgentKnowledgeWorkspace({
    ...request,
    id: "agent-knowledge-workspace:repair-1",
  });
  const second = await gateway.reconstructAgentKnowledgeWorkspace({
    ...request,
    id: "agent-knowledge-workspace:repair-1",
  });
  assert.deepEqual(first, second);
  assert.deepEqual(first.segments.map(({ id }) => id), [
    "context-segment:observation",
    "context-segment:procedure",
  ]);
  const procedure = first.segments[1];
  assert.equal(procedure?.source.id, "procedure:restart-checkout");
  assert.equal(procedure?.trustClass, "verified");
  assert.deepEqual(procedure?.validTime, { from: at(0), to: at(60) });
  assert.deepEqual(procedure?.transactionTime, { from: at(5) });
  assert.deepEqual(procedure?.provenance, ["claim:restart-runbook", "evidence:incident-470"]);
  assert.match(procedure?.authorityFilter.rationale ?? "", /read authorized/);
  assert.equal(Object.isFrozen(procedure), true);
  assert.equal(JSON.stringify(first).includes("secret-value-must-not-leak"), false);
  assert.equal(JSON.stringify(first).includes("raw-grant"), false);
  assert.equal(JSON.stringify(first).includes("secret:production-database-password"), false);
  assert.equal(JSON.stringify(first).includes("credential-ref:production-database"), false);
  assert.deepEqual(first.journal.map(({ sequence }) => sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

  const defaultDeny = new ContextGateway({
    capabilitySource: { async query() { return capabilities; } },
    knowledgeSource: {
      async query() { return segments; },
      async append(value) { appended.push(value); },
    },
  });
  const deniedCapabilities = await defaultDeny.buildEpisodeCapabilityContext({
    ...request,
    id: "episode-capability-context:default-deny",
  });
  const deniedKnowledge = await defaultDeny.reconstructAgentKnowledgeWorkspace({
    ...request,
    id: "agent-knowledge-workspace:default-deny",
  });
  assert.equal(deniedCapabilities.providers.length, 0);
  assert.equal(deniedKnowledge.segments.length, 0);

  const mutableContent = { proposedFact: "checkout recovered" };
  const written = await gateway.writeContextSegment({
    request,
    segment: segment("context-segment:agent-proposal", request, {
      content: mutableContent,
      source: { id: "agent-output:repair-1", kind: "agent-proposal" },
      trustClass: "inferred",
    }),
  });
  assert.equal(Object.isFrozen(mutableContent), false);
  mutableContent.proposedFact = "caller mutation";
  assert.deepEqual(written.content, { proposedFact: "checkout recovered" });
  assert.deepEqual(appended[0]?.content, { proposedFact: "checkout recovered" });
  await assert.rejects(
    () => defaultDeny.writeContextSegment({ request, segment: segment("context-segment:denied-write", request) }),
    /context write denied: no write evaluator configured/,
  );
  await assert.rejects(
    () =>
      gateway.writeContextSegment({
        request,
        segment: segment("context-segment:cross-workspace-write", { ...request, workspaceId: otherWorkspace }),
      }),
    /context segment is outside the episode scope/,
  );
  await assert.rejects(
    () =>
      gateway.writeContextSegment({
        request,
        segment: segment("context-segment:secret-write", request, {
          content: { password: "do-not-store" },
          source: { id: "agent-output:secret", kind: "agent-proposal" },
        }),
      }),
    /context segment contains raw secret, grant, or credential data/,
  );
  await assert.rejects(
    () =>
      gateway.writeContextSegment({
        request,
        segment: segment("context-segment:secret-locator-write", request, {
          content: { summary: "safe content" },
          source: {
            id: "agent-output:secret-locator",
            kind: "agent-proposal",
            locator: "secret:production-database-password",
          },
        }),
      }),
    /context segment contains raw secret, grant, or credential data/,
  );
  await assert.rejects(
    () =>
      gateway.writeContextSegment({
        request,
        segment: segment("context-segment:credential-reference-write", request, {
          content: { reference: "credential-ref:production-database" },
          source: { id: "agent-output:credential-reference", kind: "agent-proposal" },
        }),
      }),
    /context segment contains raw secret, grant, or credential data/,
  );
});

function capability(
  id: string,
  kind: EpisodeCapabilityCandidate["kind"],
  scope: EpisodeContextRequest,
  override: Partial<EpisodeCapabilityCandidate> = {},
): EpisodeCapabilityCandidate {
  return {
    id,
    kind,
    workspaceId: scope.workspaceId,
    workInstanceId: scope.workInstanceId,
    workEpisodeId: scope.workEpisodeId,
    details: { label: id },
    validTime: { from: at(0), to: at(60) },
    transactionTime: { from: at(5) },
    ...override,
  };
}

function segment(
  id: string,
  scope: EpisodeContextRequest,
  override: Partial<ContextSegmentRecord> = {},
): ContextSegmentRecord {
  return {
    id,
    workspaceId: scope.workspaceId,
    workInstanceId: scope.workInstanceId,
    workEpisodeId: scope.workEpisodeId,
    content: { value: id },
    source: { id: `source:${id}`, kind: "observation" },
    trustClass: "asserted",
    validTime: { from: at(0), to: at(60) },
    transactionTime: { from: at(5) },
    provenance: [`provenance:${id}`],
    ...override,
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
