import type {
  ExecutionCorrelation, ReconciliationStatus, ReconciliationStrategy,
} from "../../packages/effects/src/index.ts";
import { PostgresCanonicalLedger, type PostgresPool } from "../postgres-storage/index.ts";
import type { HostedComputeObservation } from "./index.ts";
import { PostgresHostedObservationJournal } from "./postgres-observations.ts";

/**
 * Return of an independently trusted verifier, such as an operator-managed
 * canonical read of the target system. This callback MUST NOT reuse the
 * execution worker's self-reported output as evidence.
 */
export interface HostedEffectReadRequest {
  readonly receiptId: string;
  readonly executionId: string;
  readonly correlation: ExecutionCorrelation;
  readonly expectedEffectId: string;
  readonly expectedEffectClass: HostedComputeObservation["expectedEffectClass"];
  readonly strategy: ReconciliationStrategy;
  readonly expectedAuthorityReference: string;
}

export interface HostedIndependentEffectEvidence {
  readonly status: ReconciliationStatus;
  /** Immutable reference to a verifiable observation made by the reader. */
  readonly evidenceId: string;
  /** Identity of independent canonical state/evidence provider. */
  readonly evidenceSourceId: string;
  readonly reason: string;
  readonly observedAt: string;
}

export type HostedIndependentEffectReader = (
  request: HostedEffectReadRequest,
) => Promise<HostedIndependentEffectEvidence>;

export interface HostedEffectVerificationRecord {
  readonly id: string;
  readonly kind: "compute.effect.reconciled";
  readonly workspaceId: string;
  readonly ledgerSequence?: number;
  readonly transactionTime: { readonly from: string };
  readonly receiptId: string;
  readonly executionId: string;
  readonly correlation: ExecutionCorrelation;
  readonly providerId: string;
  readonly verifierId: string;
  readonly expectedEffectId: string;
  readonly expectedEffectClass: HostedComputeObservation["expectedEffectClass"];
  readonly reconciliationId: string;
  readonly strategy: ReconciliationStrategy;
  readonly evidenceId: string;
  readonly evidenceSourceId: string;
  readonly reason: string;
  readonly observedAt: string;
  readonly status: ReconciliationStatus;
  /** A reconciliation record is evidence, NOT an acceptance/semantic commit. */
  readonly observationOnly: true;
  readonly acceptedTruth: false;
  readonly semanticMutation: false;
}

const statuses = new Set<ReconciliationStatus>(["CONFIRMED", "DIVERGED", "UNCERTAIN"]);
const strategies = new Set<ReconciliationStrategy>([
  "IN_PROCESS", "CANONICAL_READ", "IMMEDIATE_REREAD",
  "EVENTUAL_OBSERVATION", "WEBHOOK", "HUMAN_CONFIRMATION",
]);

function identifier(name: string, value: unknown, prefix: string): void {
  if (typeof value !== "string" || !value.startsWith(prefix)
    || value.length > 512 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.slice(prefix.length))) {
    throw new TypeError(`${name} must be a bounded ${prefix} identifier`);
  }
}

function instant(name: string, value: unknown): number {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${name} requires a valid offset-aware timestamp`);
  }
  return Date.parse(value);
}

function validate(record: HostedEffectVerificationRecord): void {
  if (record === null || typeof record !== "object" || record.kind !== "compute.effect.reconciled") {
    throw new Error("unsupported canonical hosted effect verification kind");
  }
  const expected = [
    "id", "kind", "workspaceId", "ledgerSequence", "transactionTime",
    "receiptId", "executionId", "correlation", "providerId", "verifierId",
    "expectedEffectId", "expectedEffectClass", "reconciliationId", "strategy",
    "evidenceId", "evidenceSourceId", "reason", "observedAt", "status",
    "observationOnly", "acceptedTruth", "semanticMutation",
  ];
  if (Object.keys(record).some(key => !expected.includes(key))) {
    throw new Error("unexpected canonical hosted effect verification field");
  }
  identifier("verification", record.id, "effect-verification:");
  identifier("workspace", record.workspaceId, "workspace:");
  identifier("receipt", record.receiptId, "compute-node-observation:");
  identifier("execution", record.executionId, "compute-execution:");
  identifier("execution provider", record.providerId, "provider:");
  identifier("verifier", record.verifierId, "verifier:");
  identifier("expected effect", record.expectedEffectId, "expected-effect:");
  identifier("reconciliation", record.reconciliationId, "reconciliation:");
  identifier("evidence", record.evidenceId, "canonical-evidence:");
  identifier("evidence source", record.evidenceSourceId, "provider:");
  if (record.evidenceSourceId === record.providerId) {
    throw new Error("effect reconciliation requires independent evidence source");
  }
  if (!record.correlation || record.correlation.workspaceId !== record.workspaceId
    || typeof record.correlation.workInstanceId !== "string"
    || typeof record.correlation.workEpisodeId !== "string"
    || typeof record.correlation.traceId !== "string") {
    throw new Error("effect verification Work correlation mismatch");
  }
  if (!statuses.has(record.status) || !strategies.has(record.strategy)
    || !["EXTERNAL", "SEMANTIC", "RUNTIME"].includes(record.expectedEffectClass)
    || typeof record.reason !== "string" || !record.reason.trim() || record.reason.length > 2048) {
    throw new Error("invalid effect reconciliation status/strategy/reason");
  }
  if (record.observationOnly !== true || record.acceptedTruth !== false
    || record.semanticMutation !== false) {
    throw new Error("effect reconciliation is not a semantic acceptance");
  }
  if (!record.transactionTime || instant("reconciliation recordedAt", record.transactionTime.from)
    < instant("independent read observedAt", record.observedAt)) {
    throw new Error("reconciliation cannot precede independent observation");
  }
}

function replay(records: readonly HostedEffectVerificationRecord[]): readonly HostedEffectVerificationRecord[] {
  const seen = new Set<string>();
  let last = 0;
  for (const record of records) {
    validate(record);
    if (record.ledgerSequence !== last + 1) {
      throw new Error("invalid hosted reconciliation causal sequence");
    }
    last = record.ledgerSequence;
    if (seen.has(record.receiptId) || seen.has(record.id)) {
      throw new Error("duplicate hosted effect verification receipt");
    }
    seen.add(record.receiptId);
    seen.add(record.id);
  }
  return records;
}

/**
 * State-side (operator only) PostgreSQL journal of independent effect reads.
 * It cannot accept instructions from the hosted worker over its compute RPC.
 *
 * It never edits the worker's observation and NEVER applies a semantic
 * mutation. Even CONFIRMED means a corroborating effect was observed, not
 * that a governance acceptance decision or semantic commit was authorized.
 */
export class PostgresHostedEffectVerificationJournal {
  readonly #ledger: PostgresCanonicalLedger<HostedEffectVerificationRecord>;
  readonly #observations: PostgresHostedObservationJournal;
  readonly #reader: HostedIndependentEffectReader;
  readonly #verifierId: string;

  private constructor(input: {
    readonly ledger: PostgresCanonicalLedger<HostedEffectVerificationRecord>;
    readonly observations: PostgresHostedObservationJournal;
    readonly verifierId: string;
    readonly readEffect: HostedIndependentEffectReader;
  }) {
    this.#ledger = input.ledger;
    this.#observations = input.observations;
    this.#verifierId = input.verifierId;
    this.#reader = input.readEffect;
  }

  static open(input: {
    readonly pool: PostgresPool;
    readonly namespace?: string;
    readonly observations: PostgresHostedObservationJournal;
    readonly verifierId: string;
    readonly readEffect: HostedIndependentEffectReader;
  }): PostgresHostedEffectVerificationJournal {
    identifier("verifier", input.verifierId, "verifier:");
    if (typeof input.readEffect !== "function") {
      throw new TypeError("trusted independent effect reader required");
    }
    return new PostgresHostedEffectVerificationJournal({
      ledger: PostgresCanonicalLedger.open({
        pool: input.pool, namespace: input.namespace ?? "hosted-effect-verification",
      }),
      observations: input.observations,
      verifierId: input.verifierId,
      readEffect: input.readEffect,
    });
  }

  async history(input: { readonly workspaceId: string }): Promise<readonly HostedEffectVerificationRecord[]> {
    identifier("workspace", input.workspaceId, "workspace:");
    return replay(await this.#ledger.load({ workspaceId: input.workspaceId }));
  }

  async verifyReceipt(input: {
    readonly workspaceId: string;
    readonly receiptId: string;
    readonly recordedAt: string;
  }): Promise<HostedEffectVerificationRecord> {
    identifier("workspace", input.workspaceId, "workspace:");
    identifier("receipt", input.receiptId, "compute-node-observation:");
    const at = instant("recordedAt", input.recordedAt);
    // Read the source via the canonical receipt journal. A worker-supplied
    // payload is never used as the verification authority.
    const receipts = await this.#observations.history({ workspaceId: input.workspaceId });
    const receipt = receipts.find(value => value.id === input.receiptId);
    if (!receipt) throw new Error("canonical hosted observation receipt not found");
    if (at < instant("provider receipt finishedAt", receipt.finishedAt)) {
      throw new Error("verification cannot precede provider receipt");
    }
    if (receipt.expectedEffectClass === "EXTERNAL"
      && receipt.reconciliation.required !== true) {
      throw new Error("external effect requires reconciliation");
    }

    const evidence = await this.#reader({
      receiptId: receipt.id,
      executionId: receipt.executionId,
      correlation: structuredClone(receipt.correlation),
      expectedEffectId: receipt.expectedEffectId,
      expectedEffectClass: receipt.expectedEffectClass,
      strategy: receipt.reconciliation.strategy,
      expectedAuthorityReference: receipt.authorityReference,
    });
    const record: HostedEffectVerificationRecord = {
      id: "effect-verification:" + receipt.executionId.slice("compute-execution:".length),
      kind: "compute.effect.reconciled",
      workspaceId: input.workspaceId,
      transactionTime: { from: new Date(at).toISOString() },
      receiptId: receipt.id,
      executionId: receipt.executionId,
      correlation: structuredClone(receipt.correlation),
      providerId: receipt.providerId,
      verifierId: this.#verifierId,
      expectedEffectId: receipt.expectedEffectId,
      expectedEffectClass: receipt.expectedEffectClass,
      reconciliationId: receipt.reconciliation.id,
      strategy: receipt.reconciliation.strategy,
      evidenceId: evidence.evidenceId,
      evidenceSourceId: evidence.evidenceSourceId,
      reason: evidence.reason,
      observedAt: evidence.observedAt,
      status: evidence.status,
      observationOnly: true,
      acceptedTruth: false,
      semanticMutation: false,
    };
    validate(record);
    if (instant("independent evidence observedAt", record.observedAt)
      < instant("provider receipt finishedAt", receipt.finishedAt)) {
      throw new Error("independent observation cannot precede execution receipt");
    }
    await this.#ledger.appendValidated({
      workspaceId: input.workspaceId,
      decide: history => {
        const existing = replay(history);
        if (existing.some(value => value.receiptId === record.receiptId || value.id === record.id)) {
          throw new Error("effect reconciliation already recorded for receipt");
        }
        return { record, result: undefined };
      },
    });
    const persisted = await this.#ledger.get(record.id);
    if (!persisted) throw new Error("committed effect verification record missing");
    validate(persisted);
    return persisted;
  }
}
