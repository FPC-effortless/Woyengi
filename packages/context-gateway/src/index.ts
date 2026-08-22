import type { StateValue } from "../../core/src/index.ts";
import type { WorkEpisodeId, WorkInstanceId } from "../../work/src/index.ts";
import type { PrincipalId, WorkspaceId } from "../../workspace/src/index.ts";

export type EpisodeCapabilityKind = "provider" | "resource" | "authority" | "budget" | "policy";
export type ContextTrustClass = "authoritative" | "verified" | "asserted" | "inferred" | "untrusted";

export interface ContextTimeInterval {
  readonly from: string;
  readonly to?: string;
}

export interface EpisodeContextRequest {
  readonly principalId: PrincipalId;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly purpose: string;
  readonly validAt: string;
  readonly transactionAt: string;
}

export interface EpisodeCapabilityCandidate {
  readonly id: string;
  readonly kind: EpisodeCapabilityKind;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly details: StateValue;
  readonly validTime: ContextTimeInterval;
  readonly transactionTime: ContextTimeInterval;
  readonly revokedAt?: string;
}

export interface EpisodeCapabilityBinding<Kind extends EpisodeCapabilityKind = EpisodeCapabilityKind> {
  readonly id: string;
  readonly kind: Kind;
  readonly details: StateValue;
  readonly validTime: ContextTimeInterval;
  readonly transactionTime: ContextTimeInterval;
  readonly applicability: {
    readonly decision: "applicable";
    readonly rationale: string;
  };
}

export interface ContextDecisionJournalEntry {
  readonly sequence: number;
  readonly domain: "capability" | "knowledge";
  readonly subjectId: string;
  readonly decision: "included" | "excluded";
  readonly reasons: readonly string[];
}

export interface EpisodeCapabilityContext {
  readonly id: string;
  readonly kind: "episode-capability-context";
  readonly principalId: PrincipalId;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly purpose: string;
  readonly validAt: string;
  readonly transactionAt: string;
  readonly providers: readonly EpisodeCapabilityBinding<"provider">[];
  readonly resources: readonly EpisodeCapabilityBinding<"resource">[];
  readonly authority: readonly EpisodeCapabilityBinding<"authority">[];
  readonly budgets: readonly EpisodeCapabilityBinding<"budget">[];
  readonly policies: readonly EpisodeCapabilityBinding<"policy">[];
  readonly journal: readonly ContextDecisionJournalEntry[];
}

export interface ContextSegmentSource {
  readonly id: string;
  readonly kind: string;
  readonly locator?: string;
}

export interface ContextSegmentRecord {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly content: StateValue;
  readonly source: ContextSegmentSource;
  readonly trustClass: ContextTrustClass;
  readonly validTime: ContextTimeInterval;
  readonly transactionTime: ContextTimeInterval;
  readonly provenance: readonly string[];
  readonly revokedAt?: string;
}

export interface ContextSegment extends ContextSegmentRecord {
  readonly authorityFilter: {
    readonly decision: "allowed";
    readonly rationale: string;
  };
}

export interface AgentKnowledgeWorkspace {
  readonly id: string;
  readonly kind: "agent-knowledge-workspace";
  readonly principalId: PrincipalId;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly purpose: string;
  readonly validAt: string;
  readonly transactionAt: string;
  readonly segments: readonly ContextSegment[];
  readonly journal: readonly ContextDecisionJournalEntry[];
}

export interface ApplicabilityDecision {
  readonly applicable: boolean;
  readonly rationale: string;
}

export interface ContextAccessDecision {
  readonly allowed: boolean;
  readonly rationale: string;
}

export interface CapabilityContextSourcePort {
  query(request: EpisodeContextRequest): Promise<readonly EpisodeCapabilityCandidate[]>;
}

export interface KnowledgeContextSourcePort {
  query(request: EpisodeContextRequest): Promise<readonly ContextSegmentRecord[]>;
  append(segment: ContextSegment): Promise<void>;
}

export interface ContextGatewayPorts {
  readonly capabilitySource: CapabilityContextSourcePort;
  readonly knowledgeSource: KnowledgeContextSourcePort;
  readonly evaluateApplicability?: (
    candidate: EpisodeCapabilityCandidate,
    request: EpisodeContextRequest,
  ) => ApplicabilityDecision;
  readonly evaluateRead?: (input: {
    readonly request: EpisodeContextRequest;
    readonly segment: ContextSegmentRecord;
  }) => ContextAccessDecision;
  readonly evaluateWrite?: (input: {
    readonly request: EpisodeContextRequest;
    readonly segment: ContextSegmentRecord;
  }) => ContextAccessDecision;
}

export class ContextGateway {
  readonly #ports: ContextGatewayPorts;

  constructor(ports: ContextGatewayPorts) {
    this.#ports = ports;
  }

  async buildEpisodeCapabilityContext(
    input: EpisodeContextRequest & { readonly id: string },
  ): Promise<EpisodeCapabilityContext> {
    const request = normalizeRequest(input);
    const candidates = uniqueById(
      (await this.#ports.capabilitySource.query(request)).map(normalizeCapabilityCandidate),
      "episode capability candidate",
    );
    const bindings: EpisodeCapabilityBinding[] = [];
    const journal: ContextDecisionJournalEntry[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const reasons = capabilityExclusionReasons(candidate, request);
      let rationale: string | undefined;
      if (reasons.length === 0) {
        const decision = evaluateApplicability(this.#ports.evaluateApplicability, candidate, request);
        if (decision.applicable) rationale = decision.rationale;
        else reasons.push(decision.rationale);
      }
      if (rationale !== undefined) bindings.push(capabilityBinding(candidate, rationale));
      journal.push(journalEntry(index + 1, "capability", candidate.id, reasons));
    }
    return deepFreeze({
      id: prefixed("episode capability context id", input.id, "episode-capability-context:"),
      kind: "episode-capability-context" as const,
      ...request,
      providers: bindingsOfKind(bindings, "provider"),
      resources: bindingsOfKind(bindings, "resource"),
      authority: bindingsOfKind(bindings, "authority"),
      budgets: bindingsOfKind(bindings, "budget"),
      policies: bindingsOfKind(bindings, "policy"),
      journal,
    });
  }

  async reconstructAgentKnowledgeWorkspace(
    input: EpisodeContextRequest & { readonly id: string },
  ): Promise<AgentKnowledgeWorkspace> {
    const request = normalizeRequest(input);
    const records = uniqueById(
      (await this.#ports.knowledgeSource.query(request)).map(normalizeContextSegmentRecord),
      "context segment",
    );
    const segments: ContextSegment[] = [];
    const journal: ContextDecisionJournalEntry[] = [];
    for (const [index, record] of records.entries()) {
      const reasons = segmentExclusionReasons(record, request);
      let rationale: string | undefined;
      if (reasons.length === 0) {
        const decision = evaluateAccess(this.#ports.evaluateRead, "read", request, record);
        if (decision.allowed) rationale = decision.rationale;
        else reasons.push(decision.rationale);
      }
      if (rationale !== undefined) segments.push(contextSegment(record, rationale));
      journal.push(journalEntry(index + 1, "knowledge", record.id, reasons));
    }
    return deepFreeze({
      id: prefixed("agent knowledge workspace id", input.id, "agent-knowledge-workspace:"),
      kind: "agent-knowledge-workspace" as const,
      ...request,
      segments,
      journal,
    });
  }

  async writeContextSegment(input: {
    readonly request: EpisodeContextRequest;
    readonly segment: ContextSegmentRecord;
  }): Promise<ContextSegment> {
    const request = normalizeRequest(input.request);
    const record = normalizeContextSegmentRecord(input.segment);
    if (scopeExclusionReasons(record, request).length > 0) {
      throw new Error("context segment is outside the episode scope");
    }
    const temporalReasons = temporalExclusionReasons(record, request);
    if (temporalReasons.length > 0) {
      throw new Error(`context segment is outside the episode temporal scope: ${temporalReasons.join(", ")}`);
    }
    if (containsSensitiveSegmentData(record)) {
      throw new Error("context segment contains raw secret, grant, or credential data");
    }
    const decision = evaluateAccess(this.#ports.evaluateWrite, "write", request, record);
    if (!decision.allowed) throw new Error(`context write denied: ${decision.rationale}`);
    const segment = contextSegment(record, decision.rationale);
    await this.#ports.knowledgeSource.append(segment);
    return segment;
  }
}

function normalizeRequest(input: EpisodeContextRequest): EpisodeContextRequest {
  const validAt = normalizeInstant(input.validAt);
  const transactionAt = normalizeInstant(input.transactionAt);
  return deepFreeze({
    principalId: prefixed("principal id", input.principalId, "principal:") as PrincipalId,
    workspaceId: prefixed("workspace id", input.workspaceId, "workspace:") as WorkspaceId,
    workInstanceId: prefixed("work instance id", input.workInstanceId, "work-instance:") as WorkInstanceId,
    workEpisodeId: prefixed("work episode id", input.workEpisodeId, "work-episode:") as WorkEpisodeId,
    purpose: requiredText("episode context purpose", input.purpose),
    validAt,
    transactionAt,
  });
}

function normalizeCapabilityCandidate(input: EpisodeCapabilityCandidate): EpisodeCapabilityCandidate {
  return deepFreeze({
    id: namespaced("episode capability id", input.id),
    kind: capabilityKind(input.kind),
    workspaceId: prefixed("workspace id", input.workspaceId, "workspace:") as WorkspaceId,
    workInstanceId: prefixed("work instance id", input.workInstanceId, "work-instance:") as WorkInstanceId,
    workEpisodeId: prefixed("work episode id", input.workEpisodeId, "work-episode:") as WorkEpisodeId,
    details: cloneStateValue(input.details),
    validTime: normalizeInterval("capability valid time", input.validTime),
    transactionTime: normalizeInterval("capability transaction time", input.transactionTime),
    ...(input.revokedAt === undefined ? {} : { revokedAt: normalizeInstant(input.revokedAt) }),
  });
}

function normalizeContextSegmentRecord(input: ContextSegmentRecord): ContextSegmentRecord {
  const source = {
    id: namespaced("context segment source id", input.source.id),
    kind: requiredText("context segment source kind", input.source.kind),
    ...(input.source.locator === undefined
      ? {}
      : { locator: requiredText("context segment source locator", input.source.locator) }),
  };
  return deepFreeze({
    id: prefixed("context segment id", input.id, "context-segment:"),
    workspaceId: prefixed("workspace id", input.workspaceId, "workspace:") as WorkspaceId,
    workInstanceId: prefixed("work instance id", input.workInstanceId, "work-instance:") as WorkInstanceId,
    workEpisodeId: prefixed("work episode id", input.workEpisodeId, "work-episode:") as WorkEpisodeId,
    content: cloneStateValue(input.content),
    source,
    trustClass: trustClass(input.trustClass),
    validTime: normalizeInterval("context segment valid time", input.validTime),
    transactionTime: normalizeInterval("context segment transaction time", input.transactionTime),
    provenance: uniqueStrings(
      "context segment provenance",
      input.provenance.map((item) => namespaced("context segment provenance id", item)),
    ),
    ...(input.revokedAt === undefined ? {} : { revokedAt: normalizeInstant(input.revokedAt) }),
  });
}

function capabilityExclusionReasons(
  candidate: EpisodeCapabilityCandidate,
  request: EpisodeContextRequest,
): string[] {
  const reasons = [...scopeExclusionReasons(candidate, request), ...temporalExclusionReasons(candidate, request)];
  if (containsSensitiveData(candidate.details)) reasons.push("sensitive-capability-details");
  return reasons;
}

function segmentExclusionReasons(record: ContextSegmentRecord, request: EpisodeContextRequest): string[] {
  const reasons = [...scopeExclusionReasons(record, request), ...temporalExclusionReasons(record, request)];
  if (containsSensitiveSegmentData(record)) reasons.push("sensitive-secret-grant-or-credential-data");
  return reasons;
}

function scopeExclusionReasons(
  value: Pick<EpisodeCapabilityCandidate, "workspaceId" | "workInstanceId" | "workEpisodeId">,
  request: EpisodeContextRequest,
): string[] {
  const reasons: string[] = [];
  if (value.workspaceId !== request.workspaceId) reasons.push("cross-workspace");
  if (value.workInstanceId !== request.workInstanceId) reasons.push("cross-work-instance");
  if (value.workEpisodeId !== request.workEpisodeId) reasons.push("cross-work-episode");
  return reasons;
}

function temporalExclusionReasons(
  value: Pick<EpisodeCapabilityCandidate, "validTime" | "transactionTime" | "revokedAt">,
  request: EpisodeContextRequest,
): string[] {
  const reasons: string[] = [];
  if (!containsInstant(value.validTime, request.validAt)) reasons.push("outside-valid-time");
  if (value.transactionTime.from > request.transactionAt) reasons.push("after-transaction-cutoff");
  if (value.transactionTime.to !== undefined && request.transactionAt >= value.transactionTime.to) {
    reasons.push("outside-transaction-time");
  }
  if (value.revokedAt !== undefined && value.revokedAt <= request.transactionAt) reasons.push("revoked");
  return reasons.sort(reasonOrder);
}

function evaluateApplicability(
  evaluator: ContextGatewayPorts["evaluateApplicability"],
  candidate: EpisodeCapabilityCandidate,
  request: EpisodeContextRequest,
): { readonly applicable: boolean; readonly rationale: string } {
  if (evaluator === undefined) {
    return { applicable: false, rationale: "no applicability evaluator configured" };
  }
  try {
    const decision = evaluator(candidate, request);
    return {
      applicable: decision?.applicable === true,
      rationale: requiredDecisionRationale(decision?.rationale, "applicability evaluator denied without rationale"),
    };
  } catch {
    return { applicable: false, rationale: "applicability evaluator failed" };
  }
}

function evaluateAccess(
  evaluator: ContextGatewayPorts["evaluateRead"] | ContextGatewayPorts["evaluateWrite"],
  operation: "read" | "write",
  request: EpisodeContextRequest,
  segment: ContextSegmentRecord,
): { readonly allowed: boolean; readonly rationale: string } {
  if (evaluator === undefined) return { allowed: false, rationale: `no ${operation} evaluator configured` };
  try {
    const decision = evaluator({ request, segment });
    return {
      allowed: decision?.allowed === true,
      rationale: requiredDecisionRationale(decision?.rationale, `${operation} evaluator denied without rationale`),
    };
  } catch {
    return { allowed: false, rationale: `${operation} evaluator failed` };
  }
}

function capabilityBinding(
  candidate: EpisodeCapabilityCandidate,
  rationale: string,
): EpisodeCapabilityBinding {
  return deepFreeze({
    id: candidate.id,
    kind: candidate.kind,
    details: cloneStateValue(candidate.details),
    validTime: candidate.validTime,
    transactionTime: candidate.transactionTime,
    applicability: { decision: "applicable" as const, rationale },
  });
}

function contextSegment(record: ContextSegmentRecord, rationale: string): ContextSegment {
  return deepFreeze({
    id: record.id,
    workspaceId: record.workspaceId,
    workInstanceId: record.workInstanceId,
    workEpisodeId: record.workEpisodeId,
    content: cloneStateValue(record.content),
    source: { ...record.source },
    trustClass: record.trustClass,
    validTime: { ...record.validTime },
    transactionTime: { ...record.transactionTime },
    provenance: [...record.provenance],
    ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt }),
    authorityFilter: { decision: "allowed" as const, rationale },
  });
}

function journalEntry(
  sequence: number,
  domain: ContextDecisionJournalEntry["domain"],
  subjectId: string,
  reasons: readonly string[],
): ContextDecisionJournalEntry {
  return deepFreeze({
    sequence,
    domain,
    subjectId,
    decision: reasons.length === 0 ? ("included" as const) : ("excluded" as const),
    reasons: reasons.length === 0 ? ["applicable-and-authorized"] : [...reasons],
  });
}

function bindingsOfKind<Kind extends EpisodeCapabilityKind>(
  values: readonly EpisodeCapabilityBinding[],
  kind: Kind,
): EpisodeCapabilityBinding<Kind>[] {
  return values.filter((value) => value.kind === kind) as EpisodeCapabilityBinding<Kind>[];
}

function uniqueById<Value extends { readonly id: string }>(values: readonly Value[], label: string): Value[] {
  const sorted = [...values].sort((left, right) => left.id.localeCompare(right.id));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]?.id === sorted[index]?.id) {
      throw new Error(`${label} appears more than once: ${sorted[index]?.id}`);
    }
  }
  return sorted;
}

function normalizeInterval(name: string, input: ContextTimeInterval): ContextTimeInterval {
  const from = normalizeInstant(input.from);
  const to = input.to === undefined ? undefined : normalizeInstant(input.to);
  if (to !== undefined && to <= from) throw new RangeError(`${name} end must follow start`);
  return deepFreeze({ from, ...(to === undefined ? {} : { to }) });
}

function containsInstant(interval: ContextTimeInterval, instant: string): boolean {
  return instant >= interval.from && (interval.to === undefined || instant < interval.to);
}

function containsSensitiveData(value: StateValue): boolean {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    return (
      normalized.includes("secret:") ||
      normalized.includes("capability-grant:") ||
      normalized.includes("credential-ref:")
    );
  }
  if (Array.isArray(value)) return value.some(containsSensitiveData);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, nested]) =>
        /(?:secret|password|passphrase|token|credential|bearer|private[-_]?key|grant)/i.test(key) ||
        containsSensitiveData(nested),
    );
  }
  return false;
}

function containsSensitiveSegmentData(record: ContextSegmentRecord): boolean {
  return (
    containsSensitiveData(record.content) ||
    containsSensitiveData({
      id: record.source.id,
      kind: record.source.kind,
      ...(record.source.locator === undefined ? {} : { locator: record.source.locator }),
    })
  );
}

function cloneStateValue(value: StateValue): StateValue {
  if (Array.isArray(value)) return value.map(cloneStateValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneStateValue(nested)]));
  }
  return value;
}

function uniqueStrings(name: string, values: readonly string[]): readonly string[] {
  const unique = [...new Set(values)].sort();
  if (unique.length === 0) throw new TypeError(`${name} must not be empty`);
  return unique;
}

function capabilityKind(value: string): EpisodeCapabilityKind {
  if (["provider", "resource", "authority", "budget", "policy"].includes(value)) {
    return value as EpisodeCapabilityKind;
  }
  throw new TypeError(`unsupported episode capability kind: ${value}`);
}

function trustClass(value: string): ContextTrustClass {
  if (["authoritative", "verified", "asserted", "inferred", "untrusted"].includes(value)) {
    return value as ContextTrustClass;
  }
  throw new TypeError(`unsupported context trust class: ${value}`);
}

function reasonOrder(left: string, right: string): number {
  const order = ["revoked", "cross-workspace", "cross-work-instance", "cross-work-episode", "outside-valid-time", "after-transaction-cutoff", "outside-transaction-time"];
  return order.indexOf(left) - order.indexOf(right) || left.localeCompare(right);
}

function requiredDecisionRationale(value: string | undefined, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.trim();
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

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an offset: ${value}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid timestamp: ${value}`);
  return date.toISOString();
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
