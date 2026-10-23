/**
 * TAC-OSM forecasting is an untrusted COMPUTE observation, never permission to act.
 * This pure adapter does NOT replace CapabilityEngine, AgentGateway authorization,
 * acceptance/reconciliation, or immutable Woyengi state.
 *
 * ME062/063 empirical status: source-calibrated 90% coverage fell to 30% and
 * 72.25% respectively on real transfer. No physical policy authority certified.
 */
export type TacForecastGateReason =
  | "ADVISORY_REVIEW_REQUIRED"
  | "UNQUALIFIED_REVIEW_ONLY"
  | "AUTHORIZATION_NOT_VERIFIED"
  | "STALE_OR_EXPIRED_SNAPSHOT"
  | "UNQUALIFIED_OR_UNKNOWN_CHECKPOINT"
  | "INVALID_FORECAST_RECEIPT"
  | "WRONG_TRACE_OR_CHECKPOINT"
  | "INVALID_NUMERIC_FORECAST";

export interface TrustedTacForecastContext {
  /** Woyengi-host verified permission; NEVER a token supplied by the model. */
  readonly forecastReadAuthorized: boolean;
  readonly currentStateRevision: string;
  readonly snapshotStateRevision: string;
  readonly expectedRequestId: string;
  readonly expectedTraceId: string;
  readonly expectedInputSha256: string;
  readonly pinnedCheckpointSha256: string;
  /** From Woyengi trusted model registry, not model self-report. */
  readonly checkpointQualification: "unqualified" | "qualified" | "unknown";
  readonly snapshotExpiresAt: string;
  readonly evaluatedAt: string;
}

export interface TacForecastGateResult {
  readonly outcome: "BLOCKED" | "ADVISORY_REVIEW_REQUIRED";
  readonly reason: TacForecastGateReason;
  /** Never allow execution via a forecast response. Real effects use separate governed procedures. */
  readonly executionPermitted: false;
  readonly semanticMutationPermitted: false;
  readonly independentApprovalRequired: true;
}

function blocked(reason: TacForecastGateReason): TacForecastGateResult {
  return Object.freeze({
    outcome: "BLOCKED" as const,
    reason,
    executionPermitted: false as const,
    semanticMutationPermitted: false as const,
    independentApprovalRequired: true as const,
  });
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteMatrix(value: unknown, expectedLength: number): boolean {
  return Array.isArray(value) && value.length === expectedLength &&
    value.every((row: unknown) => Array.isArray(row) && row.length === 14 &&
      row.every((n: unknown) => typeof n === "number" && Number.isFinite(n)));
}

function validHexSha(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function instant(value: string): number {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return Number.NaN;
  return Date.parse(value);
}

/**
 * Read-only eligibility check for a TAC forecast. Refuses ALL execution paths,
 * regardless of numeric confidence, model quality, or returned 'execute' flags.
 * Call ONLY after Woyengi validates both permission and canonical snapshot.
 */
export function evaluateTacForecastForReview(
  trusted: TrustedTacForecastContext,
  forecast: unknown,
  expectedScenarioHorizons: ReadonlyMap<string, number>,
): TacForecastGateResult {
  if (!trusted.forecastReadAuthorized) return blocked("AUTHORIZATION_NOT_VERIFIED");
  const at = instant(trusted.evaluatedAt);
  const expiry = instant(trusted.snapshotExpiresAt);
  if (!Number.isFinite(at) || !Number.isFinite(expiry) ||
    at > expiry || !nonempty(trusted.currentStateRevision) ||
    trusted.currentStateRevision !== trusted.snapshotStateRevision) {
    return blocked("STALE_OR_EXPIRED_SNAPSHOT");
  }
  if (trusted.checkpointQualification === "unknown" ||
    !validHexSha(trusted.pinnedCheckpointSha256)) {
    return blocked("UNQUALIFIED_OR_UNKNOWN_CHECKPOINT");
  }
  if (forecast === null || typeof forecast !== "object" || Array.isArray(forecast)) {
    return blocked("INVALID_FORECAST_RECEIPT");
  }
  const f = forecast as Record<string, unknown>;
  if (f.schema_version !== "tac.woyengi.forecast.v1" ||
    f.status !== "forecast_only_unqualified" ||
    f.authority !== "none" ||
    f.execute !== false ||
    f.recorded_at === undefined ||
    !Array.isArray(f.forecasts)) {
    return blocked("INVALID_FORECAST_RECEIPT");
  }
  if (f.state_revision !== trusted.snapshotStateRevision ||
    f.request_id !== trusted.expectedRequestId ||
    f.trace_id !== trusted.expectedTraceId ||
    f.input_sha256 !== trusted.expectedInputSha256 ||
    f.checkpoint_sha256 !== trusted.pinnedCheckpointSha256 ||
    !validHexSha(trusted.expectedInputSha256)) {
    return blocked("WRONG_TRACE_OR_CHECKPOINT");
  }
  if (expectedScenarioHorizons.size === 0 ||
    expectedScenarioHorizons.size > 5 ||
    f.forecasts.length !== expectedScenarioHorizons.size) {
    return blocked("INVALID_FORECAST_RECEIPT");
  }
  const seen = new Set<string>();
  for (const raw of f.forecasts as unknown[]) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return blocked("INVALID_NUMERIC_FORECAST");
    }
    const result = raw as Record<string, unknown>;
    const id = result.scenario_id;
    if (!nonempty(id) || seen.has(id) || !expectedScenarioHorizons.has(id) ||
      result.review_required !== true) {
      return blocked("INVALID_FORECAST_RECEIPT");
    }
    const h = expectedScenarioHorizons.get(id);
    if (h === undefined || !Number.isSafeInteger(h) || h < 1 || h > 16 ||
      !finiteMatrix(result.predicted_states,h) ||
      !finiteMatrix(result.predicted_std,h) ||
      !(result.predicted_std as number[][]).every(row => row.every(n => n > 0))) {
      return blocked("INVALID_NUMERIC_FORECAST");
    }
    seen.add(id);
  }
  return Object.freeze({
    outcome: "ADVISORY_REVIEW_REQUIRED",
    reason: trusted.checkpointQualification === "unqualified"
      ? "UNQUALIFIED_REVIEW_ONLY" : "ADVISORY_REVIEW_REQUIRED",
    executionPermitted: false,
    semanticMutationPermitted: false,
    independentApprovalRequired: true,
  });
}
