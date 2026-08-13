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
  readonly records: readonly { readonly id: string; readonly kind: string; readonly condition: string }[];
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
  fixture("stale-state", [record("claim:current", "claim", "valid and current"), record("claim:stale", "claim", "expired")], ["claim:current"], ["claim:stale"], "Current valid claim governs."),
  fixture("wrong-identity", [record("entity:correct", "entity", "confirmed alias"), record("entity:collision", "entity", "similar name")], ["entity:correct"], ["entity:collision"], "Confirmed identity wins over name similarity."),
  fixture("wrong-authority", [record("decision:approved", "decision", "authority 90"), record("proposal:confident", "claim", "confidence 0.99 authority 20")], ["decision:approved"], ["proposal:confident"], "Authority remains independent of confidence."),
  fixture("contradictory-evidence", [record("claim:filing", "claim", "new verified filing"), record("claim:internal", "claim", "older contradiction")], ["claim:filing"], [], "The contradiction remains visible while the filing governs."),
  fixture("missing-evidence", [record("claim:supported", "claim", "exact source span"), record("claim:unsupported", "claim", "no evidence")], ["claim:supported"], ["claim:unsupported"], "Unsupported claims cannot govern verified state."),
  fixture("superseded-decision", [record("decision:new", "decision", "supersedes old"), record("decision:old", "decision", "superseded")], ["decision:new"], ["decision:old"], "Supersession changes the projection without erasing history."),
  fixture("future-state-leakage", [record("claim:known-now", "claim", "recorded before cutoff"), record("claim:learned-later", "claim", "recorded after cutoff")], ["claim:known-now"], ["claim:learned-later"], "Transaction-time cutoff excludes later knowledge."),
  fixture("poisoned-agent-memory", [record("claim:verified-human", "claim", "verified authority"), record("claim:agent-poison", "claim", "unverified agent proposal")], ["claim:verified-human"], ["claim:agent-poison"], "Agent proposals cannot silently redefine state."),
  fixture("unauthorized-memory", [record("claim:allowed", "claim", "principal capability permits"), record("claim:restricted", "claim", "local sensitive graph")], ["claim:allowed"], ["claim:restricted"], "Permission filtering precedes contextual assembly."),
  fixture("chronology-corruption", [record("event:ordered", "event", "valid temporal bounds"), record("event:corrupt", "event", "end precedes start")], ["event:ordered"], ["event:corrupt"], "Invalid chronology is rejected."),
  fixture("invalidated-source", [record("claim:supported-source", "claim", "supported provenance"), record("claim:invalidated", "claim", "depends on invalidated source")], ["claim:supported-source"], ["claim:invalidated"], "Invalidation propagates before retrieval."),
]);

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

function record(id: string, kind: string, condition: string) { return Object.freeze({ id, kind, condition }); }
function canonicalIds(ids: readonly string[]): readonly string[] { return [...new Set(ids)].sort(); }
function arraysEqual(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function validateRate(name: string, value: number): void { if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`${name} must be between 0 and 1`); }
function deepFreeze<Value>(value: Value): Value { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const nested of Object.values(value)) deepFreeze(nested); Object.freeze(value); } return value; }
