import type { HostedComputeObservation } from "./index.ts";
import { PostgresCanonicalLedger, type PostgresPool } from "../postgres-storage/index.ts";

interface ComputeObservationRecord {
  readonly id: string;
  readonly kind: "compute.observation.received";
  readonly workspaceId: string;
  readonly ledgerSequence?: number;
  readonly transactionTime: { readonly from: string };
  readonly observation: HostedComputeObservation;
}

function namespaced(name: string, value: unknown, prefix: string): void {
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > 512
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.slice(prefix.length))) {
    throw new TypeError(`${name} must be a valid ${prefix} identifier`);
  }
}

function instant(label: string, value: string): number {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} requires a valid offset-aware timestamp`);
  }
  return Date.parse(value);
}

function verify(observation: HostedComputeObservation): void {
  if (!observation || typeof observation !== "object"
    || observation.contract !== "woyengi.hosted-compute-observation.v1"
    || observation.observationOnly !== true
    || observation.acceptedTruth !== false
    || observation.semanticMutation !== false
    || observation.reconciliation?.status !== "PENDING") {
    throw new Error("compute receipt must be observation-only with pending reconciliation");
  }
  namespaced("observation", observation.id, "compute-node-observation:");
  namespaced("execution", observation.executionId, "compute-execution:");
  namespaced("workspace", observation.correlation?.workspaceId, "workspace:");
  namespaced("node", observation.nodeId, "compute-node:");
  namespaced("expected effect", observation.expectedEffectId, "expected-effect:");
  namespaced("reconciliation", observation.reconciliation.id, "reconciliation:");
  if (!observation.authorityReference || !observation.idempotencyKey
    || !["RUNTIME", "EXTERNAL", "SEMANTIC"].includes(observation.expectedEffectClass)) {
    throw new TypeError("compute receipt lacks authority or expected effect");
  }
  const started = instant("startedAt", observation.startedAt);
  const finished = instant("finishedAt", observation.finishedAt);
  if (finished < started) throw new TypeError("compute receipt time is reversed");
  const usage = observation.usage;
  if (!usage || !Number.isFinite(usage.durationMs) || usage.durationMs < 0
    || !Number.isFinite(usage.outputBytes) || usage.outputBytes < 0
    || !Number.isFinite(usage.cost?.amount) || usage.cost.amount < 0
    || typeof usage.cost.currency !== "string" || usage.cost.currency.length === 0) {
    throw new TypeError("compute receipt must include finite nonnegative usage and cost");
  }
}

/** Stable semantic fingerprint, independent of JSON object-key order. */
function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(fingerprint).join(",") + "]";
  if (value && typeof value === "object") {
    const fields = Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return "{" + fields.map(([key, item]) =>
      JSON.stringify(key) + ":" + fingerprint(item)
    ).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

function verifyRecord(record: ComputeObservationRecord, workspaceId: string): void {
  if (record.kind !== "compute.observation.received" || record.workspaceId !== workspaceId) {
    throw new Error("unsupported or mismatched canonical compute observation kind");
  }
  if (Object.keys(record).some(key => ![
    "id", "kind", "workspaceId", "ledgerSequence", "transactionTime", "observation",
  ].includes(key))) throw new Error("unexpected canonical compute observation fields");
  if (record.id !== record.observation?.id
    || record.transactionTime?.from !== record.observation.finishedAt
    || !Number.isSafeInteger(record.ledgerSequence)) {
    throw new Error("unexpected canonical compute observation causal identity");
  }
  verify(record.observation);
}

/**
 * Append-only PostgreSQL observation receipt journal for the trusted state
 * process. A receipt is not a verified fact or an effect application.
 *
 * Duplicate identical publications are idempotent even across separate
 * pools, including concurrent writers; conflicting payloads cannot replace
 * accepted canonical observations.
 */
export class PostgresHostedObservationJournal {
  readonly #ledger: PostgresCanonicalLedger<ComputeObservationRecord>;

  private constructor(ledger: PostgresCanonicalLedger<ComputeObservationRecord>) {
    this.#ledger = ledger;
  }

  static open(input: {
    readonly pool: PostgresPool;
    readonly namespace?: string;
  }): PostgresHostedObservationJournal {
    return new PostgresHostedObservationJournal(PostgresCanonicalLedger.open({
      pool: input.pool, namespace: input.namespace ?? "hosted-compute-observations",
    }));
  }

  async publishObservation(observation: HostedComputeObservation): Promise<void> {
    verify(observation);
    const record: ComputeObservationRecord = {
      id: observation.id,
      kind: "compute.observation.received",
      workspaceId: observation.correlation.workspaceId,
      transactionTime: { from: observation.finishedAt },
      observation: structuredClone(observation),
    };
    try {
      await this.#ledger.append(record);
    } catch (error) {
      // A competing publisher may have committed the same observation.
      // Only reuse the prior receipt if its canonical content is identical.
      // A database fault without a committed record must still propagate.
      const prior = await this.#ledger.get(record.id);
      if (!prior) throw error;
      verifyRecord(prior, record.workspaceId);
      if (fingerprint(prior.observation) !== fingerprint(record.observation)) {
        throw new Error("canonical compute observation conflict");
      }
    }
  }

  /** Trusted state operator only; not a user/agent-readable HTTP endpoint. */
  async history(input: { readonly workspaceId: string }): Promise<readonly HostedComputeObservation[]> {
    namespaced("workspace", input.workspaceId, "workspace:");
    const records = await this.#ledger.load({ workspaceId: input.workspaceId });
    let previous = 0;
    return Object.freeze(records.map(record => {
      verifyRecord(record, input.workspaceId);
      if (record.ledgerSequence !== previous + 1) throw new Error("invalid compute receipt causal history");
      previous = record.ledgerSequence;
      return record.observation;
    }));
  }
}
