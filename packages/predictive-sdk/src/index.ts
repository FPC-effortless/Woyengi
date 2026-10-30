import {
  exportPredictiveState,
  type PredictiveReadExport,
  type PredictiveReadHost,
  type PredictiveReadRequest,
} from "../../predictive-export/src/index.ts";

/**
 * Development-only typed local prediction bridge.
 *
 * Type fields are NOT security attestations. Trusted device-host wiring,
 * independently reviewed model operators, network isolation and physical
 * measurement are required before customer deployment.
 */
export interface LocalAdvisoryRuntime {
  readonly execution: "DEVICE_LOCAL" | "REMOTE";
  readonly remoteFallback: boolean;
  readonly modelId: string;
  /** Synchronous, in-process prediction over a permitted detached projection. */
  predict(source: Readonly<PredictiveReadExport>): unknown;
}

export type LocalAdvisory =
  | Readonly<{
      status: "FORECAST";
      modelId: string;
      predictionCutoff: string;
      horizonSeconds: number;
      value: number;
      uncertaintyScore: number;
      uncertaintyQualification: "UNCALIBRATED";
      sourceQualification: "STRUCTURAL_EXPORT_ONLY";
      scientificQualification: "NOT_QUALIFIED";
      actionAuthority: "NOT_GRANTED";
    }>
  | Readonly<{
      status: "ABSTAIN";
      modelId: string;
      predictionCutoff: string;
      reason: "SOURCE_CONFLICT" | "INSUFFICIENT_EVIDENCE" | "MODEL_UNCERTAIN";
      sourceQualification: "STRUCTURAL_EXPORT_ONLY";
      scientificQualification: "NOT_QUALIFIED";
      actionAuthority: "NOT_GRANTED";
    }>;

function ensureLocal(runtime: LocalAdvisoryRuntime): void {
  if (!runtime || runtime.execution !== "DEVICE_LOCAL" || runtime.remoteFallback !== false ||
      typeof runtime.predict !== "function" ||
      typeof runtime.modelId !== "string" || !runtime.modelId.trim() ||
      runtime.modelId.length > 128) {
    throw new Error("device-local synchronous runtime with no remote fallback required");
  }
}

function exactKeys(
  value: unknown,
  required: readonly string[],
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("local model output must be a plain object");
  }
  const keys = Object.keys(value);
  if (keys.length !== required.length ||
      required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error("local model output contains forbidden/missing fields");
  }
}

/**
 * The source exporter detaches feature data but shallow-freezes nested objects.
 * Freeze its bounded, acyclic JSON feature tree before any pluggable runtime
 * sees it: runtime code must not rewrite features after featureHash is computed.
 * This is input-integrity defense, NOT proof of physical network isolation.
 */
function freezeModelInput(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) freezeModelInput(child);
  Object.freeze(value);
}

/**
 * No network abstraction, authority effect, canonical state write, or model
 * artifact import is created here. A real on-device runtime is NOT included.
 *
 * This function calls Woyengi's actual source capability and bitemporal
 * checks before processing a model forecast. Source conflicts abstain without
 * executing the model; callers may never authorize actions from this advice.
 */
export function predictAuthorizedLocal(
  host: PredictiveReadHost,
  request: PredictiveReadRequest,
  runtime: LocalAdvisoryRuntime,
): LocalAdvisory {
  // Reject a declared remote path BEFORE reading source data.
  ensureLocal(runtime);
  if (host?.destination !== "local-model") {
    throw new Error("offline-only source destination required");
  }
  const source = exportPredictiveState(host, request);
  const common = {
    modelId: runtime.modelId,
    predictionCutoff: source.predictionCutoff,
    sourceQualification: "STRUCTURAL_EXPORT_ONLY" as const,
    scientificQualification: "NOT_QUALIFIED" as const,
    actionAuthority: "NOT_GRANTED" as const,
  };
  if (source.conflictingClaimIds.length !== 0) {
    return Object.freeze({ ...common, status: "ABSTAIN" as const, reason: "SOURCE_CONFLICT" as const });
  }
  freezeModelInput(source);
  const output: unknown = runtime.predict(source);
  // Strict synchronous response: an async/cloud fetch cannot be awaited here.
  if (output && typeof (output as { then?: unknown }).then === "function") {
    throw new Error("asynchronous model results are not accepted");
  }
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    throw new Error("local model output must be an object");
  }
  const kind = (output as Record<string, unknown>).kind;
  if (kind === "ABSTAIN") {
    exactKeys(output, ["kind", "reason"]);
    if (output.reason !== "INSUFFICIENT_EVIDENCE" && output.reason !== "MODEL_UNCERTAIN") {
      throw new Error("invalid abstention reason");
    }
    return Object.freeze({ ...common, status: "ABSTAIN" as const, reason: output.reason });
  }
  if (kind !== "FORECAST") throw new Error("unknown local model prediction kind");
  exactKeys(output, ["kind", "value", "horizonSeconds", "uncertaintyScore"]);
  if (typeof output.value !== "number" || !Number.isFinite(output.value) ||
      typeof output.horizonSeconds !== "number" || !Number.isFinite(output.horizonSeconds) ||
      output.horizonSeconds <= 0 ||
      typeof output.uncertaintyScore !== "number" || !Number.isFinite(output.uncertaintyScore) ||
      output.uncertaintyScore < 0 || output.uncertaintyScore > 1) {
    throw new Error("invalid finite forecast, horizon or uncalibrated uncertainty");
  }
  return Object.freeze({
    ...common,
    status: "FORECAST" as const,
    value: output.value,
    horizonSeconds: output.horizonSeconds,
    uncertaintyScore: output.uncertaintyScore,
    uncertaintyQualification: "UNCALIBRATED" as const,
  });
}
