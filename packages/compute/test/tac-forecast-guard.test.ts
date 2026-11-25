import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateTacForecastForReview, type TrustedTacForecastContext } from "../src/tac-forecast-guard.ts";

const hashA = "a".repeat(64), hashB="b".repeat(64);
function context(overrides: Partial<TrustedTacForecastContext> = {}): TrustedTacForecastContext {
  return {
    forecastReadAuthorized: true,
    currentStateRevision: "head:42",
    snapshotStateRevision: "head:42",
    expectedRequestId: "request:1",
    expectedTraceId: "trace:1",
    expectedInputSha256: hashA,
    pinnedCheckpointSha256: hashB,
    checkpointQualification: "qualified",
    snapshotExpiresAt: "2026-10-23T10:00:00Z",
    evaluatedAt: "2026-10-23T09:59:59Z",
    ...overrides,
  };
}
function output() {
  return {
    schema_version: "tac.woyengi.forecast.v1",
    status: "forecast_only_unqualified",
    authority: "none", execute: false,
    recorded_at: "2026-10-23T09:59:50Z",
    request_id: "request:1", trace_id: "trace:1",
    state_revision: "head:42", input_sha256: hashA,
    checkpoint_sha256: hashB,
    forecasts: [
      {scenario_id:"candidate:hold", review_required:true,
        predicted_states:[[0,...Array(13).fill(0)]],
        predicted_std:[Array(14).fill(1)]},
    ],
  };
}
const scenarios = new Map([["candidate:hold",1]]);

test("valid untrusted forecast remains advisory; neither action nor semantic state mutation",()=>{
  const v=evaluateTacForecastForReview(context(),output(),scenarios);
  assert.equal(v.outcome,"ADVISORY_REVIEW_REQUIRED");
  assert.equal(v.executionPermitted,false);
  assert.equal(v.semanticMutationPermitted,false);
  assert.equal(v.independentApprovalRequired,true);
});
test("unqualified registered ME062/063 checkpoints are fail-closed for automatic policy",()=>{
  const v=evaluateTacForecastForReview(context({checkpointQualification:"unqualified"}),output(),scenarios);
  assert.equal(v.executionPermitted,false);
});
test("revocation, stale canonical state, and expired snapshot deny read advisory",()=>{
  for (const ctx of [
    {forecastReadAuthorized:false},
    {currentStateRevision:"head:43"},
    {evaluatedAt:"2026-10-23T10:00:01Z"},
    {checkpointQualification:"unknown" as const},
  ]) assert.equal(evaluateTacForecastForReview(context(ctx),output(),scenarios).outcome,"BLOCKED");
});
test("model may never self-authorize action even if its numeric uncertainty appears excellent",()=>{
  for (const bad of [
    {...output(),execute:true},
    {...output(),authority:"execute"},
    {...output(),input_sha256:"c".repeat(64)},
    {...output(),checkpoint_sha256:"c".repeat(64)},
    {...output(),state_revision:"head:43"},
    {...output(),forecasts:output().forecasts.map(x=>({...x,review_required:false}))},
    {...output(),forecasts:output().forecasts.map(x=>({...x,predicted_std:[Array(14).fill(1e-12)]})),execute:true},
  ]) assert.equal(evaluateTacForecastForReview(context(),bad,scenarios).executionPermitted,false);
});
test("invalid shape, NaN, Infinity, zero std, action scenario mismatch cannot pass",()=>{
  for(const bad of [
    {...output(),forecasts:output().forecasts.map(x=>({...x,predicted_std:[Array(14).fill(0)]}))},
    {...output(),forecasts:output().forecasts.map(x=>({...x,predicted_states:[Array(14).fill(Number.NaN)]}))},
    {...output(),forecasts:output().forecasts.map(x=>({...x,predicted_std:[Array(14).fill(Infinity)]}))},
    {...output(),forecasts:output().forecasts.map(x=>({...x,scenario_id:"candidate:unknown"}))},
    {...output(),forecasts:output().forecasts.map(x=>({...x,predicted_states:[]}))},
  ]) assert.equal(evaluateTacForecastForReview(context(),bad,scenarios).outcome,"BLOCKED");
});
