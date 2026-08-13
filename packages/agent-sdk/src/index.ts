import type { StateValue } from "../../core/src/index.ts";
import type { CapabilityOperation } from "../../permissions/src/index.ts";

export const AGENT_SDK_VERSION = "1.0.0";

export interface AgentPermissionDecision {
  readonly allowed: boolean;
  readonly capabilityId?: string;
  readonly rationale: string;
}

export interface AgentProposalRecord {
  readonly id: string;
  readonly kind: "agent-proposal";
  readonly principal: string;
  readonly proposalType: "observation" | "claim" | "event" | "relationship" | "action";
  readonly payload: StateValue;
  readonly validation: { readonly valid: boolean; readonly issues: readonly string[] };
  readonly authority: { readonly level: number; readonly basis: string };
  readonly verification?: {
    readonly status: "verified" | "rejected" | "inconclusive";
    readonly verifierId: string;
    readonly details: string;
  };
  readonly lifecycle: "provisional" | "verified" | "rejected";
  readonly provenance: readonly string[];
  readonly transactionTime: { readonly from: string };
}

export interface AgentActionRecord {
  readonly id: string;
  readonly kind: "agent-action";
  readonly principal: string;
  readonly request: StateValue;
  readonly permission: AgentPermissionDecision & { readonly allowed: true; readonly capabilityId: string };
  readonly procedureId: string;
  readonly result: { readonly status: "succeeded" | "failed"; readonly output?: StateValue };
  readonly provenance: readonly string[];
  readonly transactionTime: { readonly from: string };
}

export interface AgentGatewayPorts {
  readonly authorize: (input: {
    readonly principal: string;
    readonly operation: CapabilityOperation;
  }) => AgentPermissionDecision;
  readonly reconstruct: (input: { readonly principal: string; readonly request: string }) => Promise<StateValue>;
  readonly validateProposal: (input: {
    readonly proposalType: AgentProposalRecord["proposalType"];
    readonly payload: StateValue;
  }) => { readonly valid: boolean; readonly issues: readonly string[] };
  readonly evaluateAuthority: (input: {
    readonly principal: string;
    readonly proposalType: AgentProposalRecord["proposalType"];
    readonly payload: StateValue;
  }) => { readonly level: number; readonly basis: string };
  readonly verifyProposal: (input: {
    readonly principal: string;
    readonly proposalType: AgentProposalRecord["proposalType"];
    readonly payload: StateValue;
  }) => Promise<NonNullable<AgentProposalRecord["verification"]>>;
  readonly executeProcedure: (input: {
    readonly principal: string;
    readonly procedureId: string;
    readonly request: StateValue;
  }) => Promise<AgentActionRecord["result"]>;
  readonly append: (record: AgentProposalRecord | AgentActionRecord) => Promise<void>;
}

export class AgentGateway {
  readonly #ports: AgentGatewayPorts;

  constructor(ports: AgentGatewayPorts) {
    this.#ports = ports;
  }

  async read(input: { readonly principal: string; readonly request: string }): Promise<StateValue> {
    const principal = namespaced("agent principal", input.principal);
    const permission = this.#ports.authorize({ principal, operation: "RECONSTRUCT" });
    if (!permission.allowed) throw new Error(`RECONSTRUCT denied: ${permission.rationale}`);
    return this.#ports.reconstruct({ principal, request: requiredText("request", input.request) });
  }

  async propose(input: {
    readonly id: string;
    readonly principal: string;
    readonly proposalType: AgentProposalRecord["proposalType"];
    readonly payload: StateValue;
    readonly provenance: readonly string[];
    readonly recordedAt: string;
    readonly requireVerification?: boolean;
  }): Promise<AgentProposalRecord> {
    const principal = namespaced("agent principal", input.principal);
    const permission = this.#ports.authorize({ principal, operation: "PROPOSE_WRITE" });
    if (!permission.allowed) throw new Error(`PROPOSE_WRITE denied: ${permission.rationale}`);
    const validation = this.#ports.validateProposal({ proposalType: input.proposalType, payload: input.payload });
    if (!validation.valid) throw new Error(`proposal validation failed: ${validation.issues.join(", ")}`);
    const authority = this.#ports.evaluateAuthority({
      principal,
      proposalType: input.proposalType,
      payload: input.payload,
    });
    const verification = input.requireVerification
      ? await this.#ports.verifyProposal({ principal, proposalType: input.proposalType, payload: input.payload })
      : undefined;
    const lifecycle =
      verification?.status === "verified"
        ? ("verified" as const)
        : verification?.status === "rejected"
          ? ("rejected" as const)
          : ("provisional" as const);
    const proposal = deepFreeze({
      id: prefixed("agent proposal id", input.id, "agent-proposal:"),
      kind: "agent-proposal" as const,
      principal,
      proposalType: input.proposalType,
      payload: input.payload,
      validation: { valid: true, issues: [...validation.issues] },
      authority: {
        level: authority.level,
        basis: requiredText("authority basis", authority.basis),
      },
      ...(verification === undefined ? {} : { verification }),
      lifecycle,
      provenance: normalizeProvenance(input.provenance),
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    await this.#ports.append(proposal);
    return proposal;
  }

  async act(input: {
    readonly id: string;
    readonly principal: string;
    readonly request: StateValue;
    readonly procedureId: string;
    readonly provenance: readonly string[];
    readonly recordedAt: string;
  }): Promise<AgentActionRecord> {
    const principal = namespaced("agent principal", input.principal);
    const permission = this.#ports.authorize({ principal, operation: "EXECUTE" });
    if (!permission.allowed || permission.capabilityId === undefined) {
      throw new Error(`EXECUTE denied: ${permission.rationale}`);
    }
    const procedureId = prefixed("procedure id", input.procedureId, "procedure:");
    const result = await this.#ports.executeProcedure({ principal, procedureId, request: input.request });
    const action = deepFreeze({
      id: prefixed("agent action id", input.id, "agent-action:"),
      kind: "agent-action" as const,
      principal,
      request: input.request,
      permission: { allowed: true as const, capabilityId: permission.capabilityId, rationale: permission.rationale },
      procedureId,
      result,
      provenance: normalizeProvenance(input.provenance),
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
    await this.#ports.append(action);
    return action;
  }
}

function normalizeProvenance(values: readonly string[]): string[] {
  const result = values.map((value) => namespaced("provenance reference", value));
  if (result.length === 0) throw new TypeError("agent provenance must not be empty");
  return [...new Set(result)].sort();
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
