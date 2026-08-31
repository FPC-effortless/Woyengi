import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewError,
  assertExactSha,
  formatReviewBody,
  isPythonSensitive,
  latestWorkflowRunsByName,
  validateReviewResult,
  validateSecurityJobs,
  validateWorkflowEvidence,
} from "./veritas-independent-reviewer.mjs";

const HEAD = "a".repeat(40);

function run(name, conclusion = "success", status = "completed", id = 1, updatedAt = "2026-08-31T12:00:00Z") {
  return { name, conclusion, status, id, updated_at: updatedAt, run_attempt: 1 };
}

test("exact head must be a lowercase 40-character sha", () => {
  assert.equal(assertExactSha(HEAD), HEAD);
  assert.throws(() => assertExactSha("abc"), ReviewError);
  assert.throws(() => assertExactSha("A".repeat(40)), ReviewError);
});

test("Python-sensitive path detection is narrow and deterministic", () => {
  assert.equal(isPythonSensitive(["src/example.py"]), true);
  assert.equal(isPythonSensitive(["pyproject.toml"]), true);
  assert.equal(isPythonSensitive(["docs/example.md"]), false);
  assert.equal(isPythonSensitive([".github/workflows/example.yml"]), false);
});

test("latest workflow evidence chooses the latest run per workflow", () => {
  const latest = latestWorkflowRunsByName([
    run("CI", "failure", "completed", 1, "2026-08-31T11:00:00Z"),
    run("CI", "success", "completed", 2, "2026-08-31T12:00:00Z"),
  ]);
  assert.equal(latest.get("CI").id, 2);
});

test("workflow evidence fails closed on missing or failed CI", () => {
  assert.throws(
    () => validateWorkflowEvidence({ runs: [run("Python Quality Ratchet")], pythonSensitive: false }),
    /CI must be completed successfully/,
  );
  assert.throws(
    () => validateWorkflowEvidence({ runs: [run("CI", "failure")], pythonSensitive: false }),
    /CI must be completed successfully/,
  );
});

test("Python-sensitive changes require Python Quality Ratchet", () => {
  assert.throws(
    () => validateWorkflowEvidence({ runs: [run("CI")], pythonSensitive: true }),
    /Python Quality Ratchet success/,
  );
  assert.doesNotThrow(() => validateWorkflowEvidence({
    runs: [run("CI"), run("Python Quality Ratchet")],
    pythonSensitive: true,
  }));
});

test("domain workflow failures block even when CI is green", () => {
  assert.throws(
    () => validateWorkflowEvidence({
      runs: [run("CI"), run("Python Quality Ratchet"), run("CSB Gold-10 Report Acquisition", "failure")],
      pythonSensitive: true,
    }),
    /CSB Gold-10 Report Acquisition is not successful/,
  );
});

test("review-related workflow failures do not masquerade as implementation failures", () => {
  assert.doesNotThrow(() => validateWorkflowEvidence({
    runs: [
      run("CI"),
      run("Python Quality Ratchet"),
      run("Security", "failure"),
      run("Trusted Semantic Code Reviewer", "failure"),
    ],
    pythonSensitive: true,
  }));
});

test("Security may fail only at explicit review-provenance steps", () => {
  const allowed = [{
    name: "Python source security",
    conclusion: "failure",
    steps: [
      { name: "Run Bandit on application code", conclusion: "success" },
      { name: "Require independent exact-head review", conclusion: "failure" },
      { name: "Require clean semantic evidence when semantic review is requested", conclusion: "success" },
    ],
  }];
  assert.doesNotThrow(() => validateSecurityJobs(allowed));

  const blocked = [{
    name: "Python source security",
    conclusion: "failure",
    steps: [
      { name: "Run Bandit on application code", conclusion: "failure" },
      { name: "Require independent exact-head review", conclusion: "failure" },
    ],
  }];
  assert.throws(() => validateSecurityJobs(blocked), /Security failed outside review provenance/);
});

test("semantic approval cannot contain a blocking finding", () => {
  assert.throws(() => validateReviewResult({
    decision: "approve",
    summary: "Looks good except for a blocker.",
    findings: [{
      path: "src/example.py",
      severity: "high",
      blocking: true,
      title: "Fail-open",
      detail: "The error path authorizes execution.",
    }],
    external_evidence: [],
  }), /approve with blocking findings/);
});

test("request_changes must identify a concrete blocker", () => {
  assert.throws(() => validateReviewResult({
    decision: "request_changes",
    summary: "No concrete defect supplied.",
    findings: [],
    external_evidence: [],
  }), /requires at least one blocking finding/);
});

test("clean semantic result remains merge-authoritative only at exact head", () => {
  const result = validateReviewResult({
    decision: "approve",
    summary: "No blocking correctness or authority defect found.",
    findings: [],
    external_evidence: [],
  });
  const body = formatReviewBody({
    expectedHead: HEAD,
    model: "gpt-5",
    result,
    workflowEvidenceHash: "b".repeat(64),
  });
  assert.match(body, new RegExp(HEAD));
  assert.match(body, /repository integration only/);
  assert.doesNotMatch(body, /scientific qualification.*authorized/i);
});
