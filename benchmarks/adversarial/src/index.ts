export type AdversarialCategory =
  | "stale-state"
  | "wrong-identity"
  | "wrong-authority"
  | "contradictory-evidence"
  | "missing-evidence"
  | "superseded-decision"
  | "future-state-leakage"
  | "poisoned-agent-memory"
  | "unauthorized-memory"
  | "chronology-corruption"
  | "invalidated-source";

export interface AdversarialFixture {
  readonly id: string;
  readonly category: AdversarialCategory;
  readonly request: string;
  readonly principal: string;
  readonly validAt: string;
  readonly recordedAt: string;
  readonly records: readonly {
    readonly id: string;
    readonly kind: string;
    readonly condition: string;
    readonly signals: {
      readonly validFrom?: string;
      readonly validTo?: string;
      readonly recordedAt?: string;
      readonly authority?: number;
      readonly confidence?: number;
      readonly identity?: "confirmed" | "ambiguous";
      readonly evidence?: "supported" | "contradictory" | "missing";
      readonly lifecycle?: "provisional" | "verified" | "superseded" | "retracted" | "invalidated";
      readonly authorized?: boolean;
      readonly chronologyValid?: boolean;
      readonly sourceValid?: boolean;
      readonly origin?: "human" | "agent";
    };
  }[];
  readonly forbiddenRecordIds: readonly string[];
  readonly oracle: { readonly selectedRecordIds: readonly string[]; readonly rationale: string };
}

export interface BenchmarkSystem {
  readonly execute: (fixture: AdversarialFixture) => Promise<{ readonly selectedRecordIds: readonly string[]; readonly exposedRecordIds: readonly string[] }>;
}

export interface BenchmarkCaseResult {
  readonly id: string;
  readonly category: AdversarialCategory;
  readonly correct: boolean;
  readonly leakedRecordIds: readonly string[];
}

export interface BenchmarkReport {
  readonly passed: boolean;
  readonly thresholds: { readonly minimumCorrectness: number; readonly maximumPermissionLeakageRate: number };
  readonly correctness: number;
  readonly permissionLeakageRate: number;
  readonly cases: readonly BenchmarkCaseResult[];
}

export const ADVERSARIAL_FIXTURES: readonly AdversarialFixture[] = Object.freeze([
  fixture("stale-state", [record("claim:current", "claim", "valid and current", { authority: 50 }), record("claim:stale", "claim", "expired", { validTo: "2026-02-01T00:00:00Z", authority: 90 })], ["claim:current"], [], "Current valid claim governs."),
  fixture("wrong-identity", [record("entity:correct", "entity", "confirmed alias", { identity: "confirmed" }), record("entity:collision", "entity", "similar name", { identity: "ambiguous", authority: 100 })], ["entity:correct"], [], "Confirmed identity wins over name similarity."),
  fixture("wrong-authority", [record("decision:approved", "decision", "authority 90", { authority: 90, confidence: 0.8, lifecycle: "verified" }), record("proposal:confident", "claim", "confidence 0.99 authority 20", { authority: 20, confidence: 0.99, lifecycle: "verified" })], ["decision:approved"], [], "Authority remains independent of confidence."),
  fixture("contradictory-evidence", [record("claim:filing", "claim", "new verified filing", { authority: 80, evidence: "supported", recordedAt: "2026-02-28T00:00:00Z" }), record("claim:internal", "claim", "older contradiction", { authority: 30, evidence: "contradictory", recordedAt: "2026-02-01T00:00:00Z" })], ["claim:filing"], [], "The contradiction remains visible while the filing governs."),
  fixture("missing-evidence", [record("claim:supported", "claim", "exact source span", { evidence: "supported", authority: 50 }), record("claim:unsupported", "claim", "no evidence", { evidence: "missing", authority: 100 })], ["claim:supported"], [], "Unsupported claims cannot govern verified state."),
  fixture("superseded-decision", [record("decision:new", "decision", "supersedes old", { lifecycle: "verified", authority: 50 }), record("decision:old", "decision", "superseded", { lifecycle: "superseded", authority: 100 })], ["decision:new"], [], "Supersession changes the projection without erasing history."),
  fixture("future-state-leakage", [record("claim:known-now", "claim", "recorded before cutoff", { recordedAt: "2026-02-28T00:00:00Z", authority: 50 }), record("claim:learned-later", "claim", "recorded after cutoff", { recordedAt: "2026-03-02T00:00:00Z", authority: 100 })], ["claim:known-now"], [], "Transaction-time cutoff excludes later knowledge."),
  fixture("poisoned-agent-memory", [record("claim:verified-human", "claim", "verified authority", { origin: "human", lifecycle: "verified", authority: 50 }), record("claim:agent-poison", "claim", "unverified agent proposal", { origin: "agent", lifecycle: "provisional", authority: 100 })], ["claim:verified-human"], [], "Agent proposals cannot silently redefine state."),
  fixture("unauthorized-memory", [record("claim:allowed", "claim", "principal capability permits", { authorized: true, authority: 50 }), record("claim:restricted", "claim", "local sensitive graph", { authorized: false, authority: 100 })], ["claim:allowed"], ["claim:restricted"], "Permission filtering precedes contextual assembly."),
  fixture("chronology-corruption", [record("event:ordered", "event", "valid temporal bounds", { chronologyValid: true }), record("event:corrupt", "event", "end precedes start", { chronologyValid: false, authority: 100 })], ["event:ordered"], [], "Invalid chronology is rejected."),
  fixture("invalidated-source", [record("claim:supported-source", "claim", "supported provenance", { sourceValid: true, authority: 50 }), record("claim:invalidated", "claim", "depends on invalidated source", { sourceValid: false, authority: 100 })], ["claim:supported-source"], [], "Invalidation propagates before retrieval."),
]);

export class ReferenceAdversarialSystem implements BenchmarkSystem {
  async execute(fixtureValue: AdversarialFixture): Promise<{ readonly selectedRecordIds: readonly string[]; readonly exposedRecordIds: readonly string[] }> {
    const visible = fixtureValue.records.filter((recordValue) => {
      const signals = recordValue.signals;
      const recordedAt = signals.recordedAt ?? fixtureValue.recordedAt;
      const validFrom = signals.validFrom ?? "0000-01-01T00:00:00.000Z";
      return signals.authorized !== false
        && signals.chronologyValid !== false
        && signals.sourceValid !== false
        && recordedAt <= fixtureValue.recordedAt
        && validFrom <= fixtureValue.validAt
        && (signals.validTo === undefined || fixtureValue.validAt < signals.validTo);
    });
    const governing = visible.filter((recordValue) => {
      const signals = recordValue.signals;
      return !["superseded", "retracted", "invalidated"].includes(signals.lifecycle ?? "verified")
        && signals.identity !== "ambiguous"
        && signals.evidence !== "missing"
        && !(signals.origin === "agent" && signals.lifecycle !== "verified");
    }).sort(compareAdversarialPriority);
    return deepFreeze({
      selectedRecordIds: governing.length === 0 ? [] : [governing[0]?.id as string],
      exposedRecordIds: visible.map((recordValue) => recordValue.id).sort(),
    });
  }
}

export async function runAdversarialBenchmarks(
  system: BenchmarkSystem,
  thresholds: { readonly minimumCorrectness: number; readonly maximumPermissionLeakageRate: number },
): Promise<BenchmarkReport> {
  validateRate("minimum correctness", thresholds.minimumCorrectness);
  validateRate("maximum permission leakage rate", thresholds.maximumPermissionLeakageRate);
  const results: BenchmarkCaseResult[] = [];
  let exposed = 0;
  let leaked = 0;
  for (const fixtureValue of ADVERSARIAL_FIXTURES) {
    const output = await system.execute(fixtureValue);
    const selected = canonicalIds(output.selectedRecordIds);
    const expected = canonicalIds(fixtureValue.oracle.selectedRecordIds);
    const forbidden = new Set(fixtureValue.forbiddenRecordIds);
    const leakedRecordIds = canonicalIds(output.exposedRecordIds.filter((id) => forbidden.has(id)));
    exposed += output.exposedRecordIds.length;
    leaked += leakedRecordIds.length;
    results.push(Object.freeze({ id: fixtureValue.id, category: fixtureValue.category, correct: arraysEqual(selected, expected), leakedRecordIds }));
  }
  const correctness = results.filter((item) => item.correct).length / results.length;
  const permissionLeakageRate = exposed === 0 ? 0 : leaked / exposed;
  const report = deepFreeze({
    passed: correctness >= thresholds.minimumCorrectness && permissionLeakageRate <= thresholds.maximumPermissionLeakageRate,
    thresholds,
    correctness,
    permissionLeakageRate,
    cases: results,
  });
  if (!report.passed) throw new BenchmarkGateError(report);
  return report;
}

export class BenchmarkGateError extends Error {
  readonly report: BenchmarkReport;
  constructor(report: BenchmarkReport) {
    super(`benchmark release gate failed: correctness=${report.correctness}, permissionLeakageRate=${report.permissionLeakageRate}`);
    this.report = report;
  }
}

function fixture(category: AdversarialCategory, records: AdversarialFixture["records"], selectedRecordIds: readonly string[], forbiddenRecordIds: readonly string[], rationale: string): AdversarialFixture {
  return deepFreeze({ id: `benchmark:${category}`, category, request: `Reconstruct safe state for ${category}`, principal: "user:benchmark", validAt: "2026-03-01T00:00:00Z", recordedAt: "2026-03-01T00:00:00Z", records, forbiddenRecordIds, oracle: { selectedRecordIds, rationale } });
}

function record(id: string, kind: string, condition: string, signals: AdversarialFixture["records"][number]["signals"] = {}) { return deepFreeze({ id, kind, condition, signals }); }
function compareAdversarialPriority(left: AdversarialFixture["records"][number], right: AdversarialFixture["records"][number]): number {
  const leftSignals = left.signals;
  const rightSignals = right.signals;
  return (rightSignals.authority ?? 0) - (leftSignals.authority ?? 0)
    || lifecycleRank(rightSignals.lifecycle) - lifecycleRank(leftSignals.lifecycle)
    || evidenceRank(rightSignals.evidence) - evidenceRank(leftSignals.evidence)
    || (rightSignals.recordedAt ?? "").localeCompare(leftSignals.recordedAt ?? "")
    || (rightSignals.confidence ?? 0) - (leftSignals.confidence ?? 0)
    || left.id.localeCompare(right.id);
}
function lifecycleRank(value: AdversarialFixture["records"][number]["signals"]["lifecycle"]): number { return value === "verified" ? 2 : value === "provisional" ? 1 : 0; }
function evidenceRank(value: AdversarialFixture["records"][number]["signals"]["evidence"]): number { return value === "supported" ? 2 : value === "contradictory" ? 1 : 0; }
function canonicalIds(ids: readonly string[]): readonly string[] { return [...new Set(ids)].sort(); }
function arraysEqual(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function validateRate(name: string, value: number): void { if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`${name} must be between 0 and 1`); }
function deepFreeze<Value>(value: Value): Value { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const nested of Object.values(value)) deepFreeze(nested); Object.freeze(value); } return value; }
