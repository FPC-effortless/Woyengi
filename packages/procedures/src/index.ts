import type { StateValue } from "../../core/src/index.ts";

export interface ProcedureOperation {
  readonly id: string;
  readonly tool: string;
  readonly input: Readonly<Record<string, StateValue>>;
}

export interface ProcedureDefinition {
  readonly id: string;
  readonly version: string;
  readonly preconditions: readonly string[];
  readonly operations: readonly ProcedureOperation[];
  readonly tools: readonly string[];
  readonly invariants: readonly string[];
  readonly verification: readonly string[];
  readonly postconditions: readonly string[];
  readonly repair: readonly { readonly failure: string; readonly action: string }[];
}

export interface ProcedureExecution {
  readonly id: string;
  readonly kind: "procedure-execution";
  readonly procedureId: string;
  readonly procedureVersion: string;
  readonly principal: string;
  readonly status: "denied" | "precondition-failed" | "failed" | "verification-failed" | "succeeded";
  readonly transactionTime: { readonly from: string };
  readonly steps: readonly {
    readonly operationId: string;
    readonly tool: string;
    readonly status: "succeeded" | "failed";
    readonly output?: StateValue;
  }[];
  readonly verification?: { readonly passed: boolean; readonly details: string };
  readonly candidateProcedure?: ProcedureDefinition & { readonly basedOnExecutionId: string };
  readonly reason: string;
}

export interface ProcedureEnginePorts {
  readonly authorize: (input: {
    readonly principal: string;
    readonly procedureId: string;
    readonly operation: "EXECUTE";
  }) => boolean;
  readonly invokeTool: (input: {
    readonly principal: string;
    readonly operation: ProcedureOperation;
    readonly state: Readonly<Record<string, StateValue>>;
  }) => Promise<{ readonly status: "ok" | "error"; readonly output?: StateValue }>;
  readonly verify: (input: {
    readonly procedure: ProcedureDefinition;
    readonly state: Readonly<Record<string, StateValue>>;
    readonly steps: readonly ProcedureExecution["steps"][number][];
  }) => Promise<{ readonly passed: boolean; readonly details: string }>;
}

export function defineProcedure(input: ProcedureDefinition): ProcedureDefinition {
  parseVersion(input.version);
  const tools = uniqueRequired("procedure tools", input.tools);
  const operations = input.operations.map((operation) => {
    const tool = namespaced("tool id", operation.tool);
    if (!tools.includes(tool)) throw new Error(`procedure operation uses undeclared tool: ${tool}`);
    return {
      id: namespaced("operation id", operation.id),
      tool,
      input: structuredClone(operation.input),
    };
  });
  if (operations.length === 0) throw new TypeError("procedure operations must not be empty");
  return deepFreeze({
    id: prefixed("procedure id", input.id, "procedure:"),
    version: input.version,
    preconditions: unique("preconditions", input.preconditions),
    operations,
    tools,
    invariants: unique("invariants", input.invariants),
    verification: uniqueRequired("verification", input.verification),
    postconditions: unique("postconditions", input.postconditions),
    repair: input.repair.map((item) => ({
      failure: requiredText("repair failure", item.failure),
      action: requiredText("repair action", item.action),
    })),
  });
}

export class ProcedureEngine {
  readonly #ports: ProcedureEnginePorts;

  constructor(ports: ProcedureEnginePorts) {
    this.#ports = ports;
  }

  async execute(input: {
    readonly id: string;
    readonly procedure: ProcedureDefinition;
    readonly principal: string;
    readonly state: Readonly<Record<string, StateValue>>;
    readonly recordedAt: string;
    readonly proposeCandidate?: boolean;
  }): Promise<ProcedureExecution> {
    const base = {
      id: prefixed("execution id", input.id, "execution:"),
      kind: "procedure-execution" as const,
      procedureId: input.procedure.id,
      procedureVersion: input.procedure.version,
      principal: namespaced("principal", input.principal),
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    };
    if (!this.#ports.authorize({ principal: input.principal, procedureId: input.procedure.id, operation: "EXECUTE" })) {
      return deepFreeze({ ...base, status: "denied" as const, steps: [], reason: "EXECUTE capability denied." });
    }
    const missing = input.procedure.preconditions.filter((condition) => input.state[condition] !== true);
    if (missing.length > 0) {
      return deepFreeze({ ...base, status: "precondition-failed" as const, steps: [], reason: `Missing preconditions: ${missing.join(", ")}` });
    }
    const steps: ProcedureExecution["steps"][number][] = [];
    for (const operation of input.procedure.operations) {
      const result = await this.#ports.invokeTool({ principal: input.principal, operation, state: input.state });
      steps.push({
        operationId: operation.id,
        tool: operation.tool,
        status: result.status === "ok" ? "succeeded" : "failed",
        ...(result.output === undefined ? {} : { output: result.output }),
      });
      if (result.status === "error") {
        return deepFreeze({ ...base, status: "failed" as const, steps, reason: `Operation failed: ${operation.id}` });
      }
    }
    const verification = await this.#ports.verify({ procedure: input.procedure, state: input.state, steps });
    if (!verification.passed) {
      return deepFreeze({ ...base, status: "verification-failed" as const, steps, verification, reason: verification.details });
    }
    const candidateProcedure = input.proposeCandidate
      ? {
          ...input.procedure,
          version: candidateVersion(input.procedure.version),
          basedOnExecutionId: base.id,
        }
      : undefined;
    return deepFreeze({
      ...base,
      status: "succeeded" as const,
      steps,
      verification,
      ...(candidateProcedure === undefined ? {} : { candidateProcedure }),
      reason: "Procedure completed and verification passed.",
    });
  }
}

function candidateVersion(value: string): string {
  const version = parseVersion(value);
  return `${version.major}.${version.minor}.${version.patch + 1}-candidate.1`;
}

interface Version { readonly major: number; readonly minor: number; readonly patch: number }
function parseVersion(value: string): Version {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (match === null) throw new TypeError(`version must use major.minor.patch: ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function unique(name: string, values: readonly string[]): string[] {
  const result = values.map((value) => requiredText(name, value));
  if (new Set(result).size !== result.length) throw new Error(`${name} must not contain duplicates`);
  return result;
}
function uniqueRequired(name: string, values: readonly string[]): string[] {
  const result = unique(name, values);
  if (result.length === 0) throw new TypeError(`${name} must not be empty`);
  return result;
}
function prefixed(name: string, value: string, prefix: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${name} must start with ${prefix}`);
  return normalized;
}
function namespaced(name: string, value: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.includes(":")) throw new TypeError(`${name} must be namespace-qualified`);
  return normalized;
}
function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return date.toISOString();
}
function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}
function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
