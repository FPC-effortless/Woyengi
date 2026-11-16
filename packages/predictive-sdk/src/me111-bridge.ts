/**
 * Frozen TAC-OSM ME111 -> Woyengi offline advisory *interface candidate*.
 *
 * The actual frozen ONNX runtime and state store live in TAC-OSM's Android
 * research prototype (draft #544). This adapter does not embed that model,
 * verify external publisher rights or operate a physical phone.
 *
 * Source: TAC-OSM Me111Contract.java and Me111LocalEngine.java at
 * eda076507f5762fa4413848cd3f0fd87a55c3681 (draft #544).
 */
import {
  exportPredictiveState,
  type PredictiveReadHost,
  type PredictiveReadRequest,
} from "../../predictive-export/src/index.ts";

export const ME111_FROZEN_CONTRACT = Object.freeze({
  modelSha256: "dd65519a9e4f3388966538af53119b56e9292b46a9209d63ad4927b87f0a176b",
  checkpointSha256: "337b882e9a10631dc85700846ef2b15ca8908699499668186ad3a248dc108449",
  parameters: 104663,
  onnxOpset: 18,
  onnxRuntime: "1.23.2",
  channels: 13,
  clocks: 6,
  forecastChannels: 6,
  sourceOwners: 12,
  memoryRows: 8,
  evidenceDim: 62,
  sourceReferenceCommit: "eda076507f5762fa4413848cd3f0fd87a55c3681",
  units: "STANDARDIZED_LOG1P_POLLUTANT" as const,
});

const FEATURES = ["owner", "hour", "values", "observed", "ages", "clock"] as const;

export type Me111SourceEvent = Readonly<{
  owner: number;
  hour: number;
  values: readonly number[];
  observed: readonly boolean[];
  ages: readonly number[];
  clock: readonly number[];
}>;

/** Trusted native device port supplied by an approved on-device host, NOT JSON. */
export interface Me111NativeLocalPort {
  readonly execution: "DEVICE_LOCAL" | "REMOTE";
  readonly remoteFallback: boolean;
  readonly modelSha256: string;
  readonly checkpointSha256: string;
  /** Must be synchronous and implement the original 12-input Android session. */
  predictStep(event: Me111SourceEvent): unknown;
}

export type Me111Advisory =
  | Readonly<{
      status: "ABSTAIN";
      reason: "SOURCE_CONFLICT" | "SOURCE_AMBIGUOUS";
      modelSha256: string;
      scientificQualification: "FAILED_MIXED_ME111";
      sourceQualification: "STRUCTURAL_EXPORT_ONLY";
      actionAuthority: "NOT_GRANTED";
      deviceQualification: "NOT_RUN";
    }>
  | Readonly<{
      status: "FORECAST";
      logLocation: readonly number[];
      leftScale: readonly number[];
      rightScale: readonly number[];
      units: "STANDARDIZED_LOG1P_POLLUTANT";
      modelSha256: string;
      scientificQualification: "FAILED_MIXED_ME111";
      sourceQualification: "STRUCTURAL_EXPORT_ONLY";
      actionAuthority: "NOT_GRANTED";
      deviceQualification: "NOT_RUN";
    }>;

function checkPort(port: Me111NativeLocalPort): void {
  if (!port || port.execution !== "DEVICE_LOCAL" || port.remoteFallback !== false ||
      port.modelSha256 !== ME111_FROZEN_CONTRACT.modelSha256 ||
      port.checkpointSha256 !== ME111_FROZEN_CONTRACT.checkpointSha256 ||
      typeof port.predictStep !== "function") {
    throw new Error("ME111 original frozen identity and device-local no-fallback port required");
  }
}

function onlyOwnDataFields(value: unknown, required: readonly string[], label: string)
    : asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + ": plain data object required");
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(label + ": inherited prototype not permitted");
  }
  const fields = Reflect.ownKeys(value);
  if (fields.length !== required.length ||
      required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error(label + ": exact field set required");
  }
  for (const field of required) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new Error(label + ": accessor or hidden field forbidden");
    }
  }
}

function numberArray(value: unknown, length: number, label: string,
                     minimum: number, maximum: number): readonly number[] {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(label + ": exact native channel count required");
  }
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable ||
        typeof descriptor.value !== "number" ||
        !Number.isFinite(descriptor.value) ||
        descriptor.value < minimum || descriptor.value > maximum) {
      throw new Error(label + ": invalid finite native value");
    }
    out.push(descriptor.value);
  }
  if (Reflect.ownKeys(value).length !== length + 1) {
    throw new Error(label + ": hidden/symbolic array fields forbidden");
  }
  return Object.freeze(out);
}

function eventFromAuthorizedSource(features: unknown): Me111SourceEvent {
  onlyOwnDataFields(features, FEATURES, "ME111 source projection");
  const owner = features.owner;
  const hour = features.hour;
  if (typeof owner !== "number" || !Number.isInteger(owner) ||
      owner < 0 || owner >= ME111_FROZEN_CONTRACT.sourceOwners ||
      typeof hour !== "number" || !Number.isSafeInteger(hour) ||
      hour < 0 || hour > 20_000_000) {
    throw new Error("ME111 original source owner/hour invalid");
  }
  const values = numberArray(features.values, 13, "values", -8.00001, 8.00001);
  const ages = numberArray(features.ages, 13, "ages", 0, 1);
  const clock = numberArray(features.clock, 6, "clock", -100, 100);
  const mask = features.observed;
  if (!Array.isArray(mask) || mask.length !== 13 ||
      Reflect.ownKeys(mask).length !== 14) {
    throw new Error("observed: exact native mask required");
  }
  const observed: boolean[] = [];
  for (let i = 0; i < 13; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(mask, String(i));
    if (!descriptor || !("value" in descriptor) ||
        typeof descriptor.value !== "boolean" || !descriptor.enumerable) {
      throw new Error("observed: native boolean mask required");
    }
    if (!descriptor.value && values[i] !== 0) {
      throw new Error("ME111 masked input must be zero");
    }
    observed.push(descriptor.value);
  }
  return Object.freeze({
    owner, hour, values, ages, clock, observed: Object.freeze(observed),
  });
}

/**
 * The actual original native runner is supplied by a reviewed device host.
 * The source projection is permission-checked by Woyengi before any model call.
 * This is contract interoperability, NOT qualified Android inference.
 */
export function predictMe111AuthorizedLocal(
  host: PredictiveReadHost,
  request: PredictiveReadRequest,
  port: Me111NativeLocalPort,
): Me111Advisory {
  checkPort(port); // Before accessing any authorized source.
  if (host?.destination !== "local-model") {
    throw new Error("ME111 source destination must remain device-local");
  }
  if (!Array.isArray(request?.allowedFeatureNames) ||
      request.allowedFeatureNames.length !== FEATURES.length ||
      FEATURES.some((name) => !request.allowedFeatureNames.includes(name))) {
    throw new Error("ME111 trusted host must request exactly the native six features");
  }

  const source = exportPredictiveState(host, request);
  const common = {
    modelSha256: ME111_FROZEN_CONTRACT.modelSha256,
    scientificQualification: "FAILED_MIXED_ME111" as const,
    sourceQualification: "STRUCTURAL_EXPORT_ONLY" as const,
    actionAuthority: "NOT_GRANTED" as const,
    deviceQualification: "NOT_RUN" as const,
  };
  if (source.conflictingClaimIds.length) {
    return Object.freeze({ ...common, status: "ABSTAIN" as const,
                           reason: "SOURCE_CONFLICT" as const });
  }
  if (source.observations.length !== 1 ||
      source.observations[0]?.claimId !== source.selectedClaimId) {
    return Object.freeze({ ...common, status: "ABSTAIN" as const,
                           reason: "SOURCE_AMBIGUOUS" as const });
  }
  const event = eventFromAuthorizedSource(source.observations[0].features);
  const output: unknown = port.predictStep(event);
  onlyOwnDataFields(output, ["logLocation", "leftScale", "rightScale"], "ME111 native output");
  const loc = numberArray(output.logLocation, 6, "logLocation", -Infinity, Infinity);
  const left = numberArray(output.leftScale, 6, "leftScale", Number.MIN_VALUE, Infinity);
  const right = numberArray(output.rightScale, 6, "rightScale", Number.MIN_VALUE, Infinity);
  return Object.freeze({
    ...common, status: "FORECAST" as const,
    logLocation: loc, leftScale: left, rightScale: right,
    units: ME111_FROZEN_CONTRACT.units,
  });
}
