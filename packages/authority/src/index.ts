export interface AuthorityPolicy {
  readonly id: string;
  readonly principals: readonly string[];
  readonly predicatePrefixes: readonly string[];
  readonly purposes: readonly string[];
  readonly conditions: Readonly<Record<string, string>>;
  readonly level: number;
  readonly basis: string;
  readonly validFrom: string;
  readonly expiresAt: string;
}

export interface AuthorityCandidate {
  readonly id: string;
  readonly principal: string;
  readonly confidence: number;
}

export interface AuthorityTraceItem {
  readonly policyId: string;
  readonly matched: boolean;
  readonly failures: readonly string[];
}

export interface AuthorityAssessment {
  readonly candidate: AuthorityCandidate;
  readonly authority: {
    readonly level: number;
    readonly basis: string;
    readonly policyId?: string;
  };
  readonly rationale: string;
  readonly trace: readonly AuthorityTraceItem[];
}

export interface AuthorityRanking {
  readonly selected?: AuthorityAssessment;
  readonly assessments: readonly AuthorityAssessment[];
}

export function defineAuthorityPolicy(input: AuthorityPolicy): AuthorityPolicy {
  if (!Number.isFinite(input.level)) throw new TypeError("authority level must be finite");
  const validFrom = normalizeInstant(input.validFrom);
  const expiresAt = normalizeInstant(input.expiresAt);
  if (expiresAt <= validFrom) throw new RangeError("authority policy expiry must follow validFrom");
  return deepFreeze({
    id: prefixed("authority policy id", input.id, "authority-policy:"),
    principals: uniqueRequired("authority principals", input.principals),
    predicatePrefixes: uniqueRequired("predicate prefixes", input.predicatePrefixes),
    purposes: uniqueRequired("authority purposes", input.purposes),
    conditions: sortedRecord(input.conditions),
    level: input.level,
    basis: requiredText("authority basis", input.basis),
    validFrom,
    expiresAt,
  });
}

export class AuthorityEngine {
  readonly #policies = new Map<string, AuthorityPolicy>();

  register(policy: AuthorityPolicy): void {
    if (this.#policies.has(policy.id)) throw new Error(`authority policy already exists: ${policy.id}`);
    this.#policies.set(policy.id, policy);
  }

  rank(input: {
    readonly predicate: string;
    readonly purpose: string;
    readonly context: Readonly<Record<string, string>>;
    readonly at: string;
    readonly candidates: readonly AuthorityCandidate[];
  }): AuthorityRanking {
    const predicate = namespaced("predicate", input.predicate);
    const purpose = requiredText("purpose", input.purpose);
    const at = normalizeInstant(input.at);
    const policies = [...this.#policies.values()].sort((left, right) => left.id.localeCompare(right.id));
    const assessments = input.candidates
      .map((candidate) => assess(candidate, policies, { predicate, purpose, context: input.context, at }))
      .sort(compareAssessments);
    return deepFreeze({
      ...(assessments[0] === undefined ? {} : { selected: assessments[0] }),
      assessments,
    });
  }
}

function assess(
  input: AuthorityCandidate,
  policies: readonly AuthorityPolicy[],
  context: {
    readonly predicate: string;
    readonly purpose: string;
    readonly context: Readonly<Record<string, string>>;
    readonly at: string;
  },
): AuthorityAssessment {
  if (input.confidence < 0 || input.confidence > 1) {
    throw new RangeError("candidate confidence must be between 0 and 1");
  }
  const candidate: AuthorityCandidate = {
    id: namespaced("candidate id", input.id),
    principal: namespaced("candidate principal", input.principal),
    confidence: input.confidence,
  };
  const trace = policies.map((policy) => evaluatePolicy(policy, candidate, context));
  const matched = trace
    .filter((item) => item.matched)
    .map((item) => policies.find((policy) => policy.id === item.policyId) as AuthorityPolicy)
    .sort((left, right) => right.level - left.level || left.id.localeCompare(right.id));
  const governing = matched[0];
  const authority =
    governing === undefined
      ? { level: 0, basis: "no matching authority policy" }
      : { level: governing.level, basis: governing.basis, policyId: governing.id };
  return {
    candidate,
    authority,
    rationale:
      governing === undefined
        ? `${candidate.id} has authority 0 because no policy matched.`
        : `${candidate.id} has authority ${governing.level} under ${governing.id}: ${governing.basis}`,
    trace,
  };
}

function evaluatePolicy(
  policy: AuthorityPolicy,
  candidate: AuthorityCandidate,
  input: {
    readonly predicate: string;
    readonly purpose: string;
    readonly context: Readonly<Record<string, string>>;
    readonly at: string;
  },
): AuthorityTraceItem {
  const failures: string[] = [];
  if (!policy.principals.includes(candidate.principal)) failures.push("principal-not-authoritative");
  if (!policy.predicatePrefixes.some((prefix) => input.predicate.startsWith(prefix))) {
    failures.push("predicate-out-of-scope");
  }
  if (!policy.purposes.includes(input.purpose)) failures.push("purpose-out-of-scope");
  if (input.at < policy.validFrom || input.at >= policy.expiresAt) failures.push("outside-time-bound");
  for (const [name, value] of Object.entries(policy.conditions)) {
    if (input.context[name] !== value) failures.push(`condition-failed:${name}`);
  }
  return { policyId: policy.id, matched: failures.length === 0, failures };
}

function compareAssessments(left: AuthorityAssessment, right: AuthorityAssessment): number {
  return (
    right.authority.level - left.authority.level ||
    right.candidate.confidence - left.candidate.confidence ||
    left.candidate.id.localeCompare(right.candidate.id)
  );
}

function uniqueRequired(name: string, values: readonly string[]): string[] {
  const normalized = values.map((value) => requiredText(name, value));
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  if (new Set(normalized).size !== normalized.length) throw new Error(`${name} must not contain duplicates`);
  return normalized.sort();
}

function sortedRecord(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]): [string, string] => [requiredText("condition name", key), requiredText("condition value", item)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
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
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`timestamp must include an explicit UTC offset: ${value}`);
  }
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
