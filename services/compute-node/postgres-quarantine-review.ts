import { PostgresCanonicalLedger, type PostgresPool } from "../postgres-storage/index.ts";
import type { PostgresHostedComputeStatePort } from "./postgres-state.ts";
import type { PostgresHostedEffectVerificationJournal } from "./postgres-effect-verification.ts";

interface ReviewBase {
  readonly id: string;
  readonly workspaceId: string;
  readonly ledgerSequence?: number;
  readonly transactionTime: { readonly from: string };
  readonly leaseId: string;
  readonly executionId: string;
  readonly expectedEffectId: string;
  readonly quarantineRecordId: string;
  readonly reviewerPrincipalId: string;
  readonly observationOnly: true;
  readonly acceptedTruth: false;
  readonly semanticMutation: false;
}
export interface QuarantineReviewOpened extends ReviewBase {
  readonly kind: "compute.lease.review.opened";
}
export interface QuarantineReviewResolved extends ReviewBase {
  readonly kind: "compute.lease.review.resolved";
  readonly status: "EFFECT_CONFIRMED" | "EFFECT_DIVERGED";
  readonly verificationId: string;
  readonly evidenceId: string;
  readonly evidenceSourceId: string;
  readonly rationale: string;
}
export type QuarantineReviewOperation = QuarantineReviewOpened | QuarantineReviewResolved;

export interface TrustedQuarantineReviewerPolicy {
  (request: {
    readonly reviewerPrincipalId: string;
    readonly workspaceId: string;
    readonly leaseId: string;
    readonly action: "OPEN" | "RESOLVE";
  }): Promise<boolean>;
}

function identifier(label: string, value: unknown, prefix: string): void {
  if (typeof value !== "string" || !value.startsWith(prefix)
    || value.length > 512 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.slice(prefix.length))) {
    throw new TypeError(`${label} requires bounded ${prefix} identifier`);
  }
}
function timestamp(label: string, value: unknown): number {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid offset-aware timestamp`);
  }
  return Date.parse(value);
}
function validate(record: QuarantineReviewOperation): void {
  if (!record || (record.kind !== "compute.lease.review.opened"
    && record.kind !== "compute.lease.review.resolved")) {
    throw new Error("unsupported canonical quarantine review operation");
  }
  const keys = ["id", "kind", "workspaceId", "ledgerSequence", "transactionTime",
    "leaseId", "executionId", "expectedEffectId", "quarantineRecordId",
    "reviewerPrincipalId", "observationOnly", "acceptedTruth", "semanticMutation"];
  if (record.kind === "compute.lease.review.resolved") {
    keys.push("status", "verificationId", "evidenceId", "evidenceSourceId", "rationale");
  }
  if (Object.keys(record).some(key => !keys.includes(key))) {
    throw new Error("unexpected quarantine review record field");
  }
  identifier("record", record.id, "quarantine-review:");
  identifier("workspace", record.workspaceId, "workspace:");
  identifier("lease", record.leaseId, "compute-lease:");
  identifier("execution", record.executionId, "compute-execution:");
  identifier("expected effect", record.expectedEffectId, "expected-effect:");
  identifier("quarantine event", record.quarantineRecordId, "compute-state:quarantined:");
  identifier("human reviewer", record.reviewerPrincipalId, "principal:");
  if (record.observationOnly !== true || record.acceptedTruth !== false
    || record.semanticMutation !== false) {
    throw new Error("review events cannot accept truth or mutate semantic state");
  }
  timestamp("review transaction time", record.transactionTime?.from);
  if (record.kind === "compute.lease.review.resolved") {
    if (!["EFFECT_CONFIRMED", "EFFECT_DIVERGED"].includes(record.status)) {
      throw new Error("quarantine review cannot resolve without decisive external evidence");
    }
    identifier("verification", record.verificationId, "effect-verification:");
    identifier("evidence", record.evidenceId, "canonical-evidence:");
    identifier("independent provider", record.evidenceSourceId, "provider:");
    if (typeof record.rationale !== "string"
      || !record.rationale.trim() || record.rationale.length > 2048) {
      throw new Error("reviewer rationale is required and bounded");
    }
  }
}

/** Replay validates strictly ordered, one-open/one-resolve transitions. */
function replay(history: readonly QuarantineReviewOperation[]): Map<string, {
  readonly open: QuarantineReviewOpened;
  resolved?: QuarantineReviewResolved;
}> {
  const result = new Map<string, { readonly open: QuarantineReviewOpened; resolved?: QuarantineReviewResolved }>();
  const seen = new Set<string>();
  let sequence = 0;
  for (const record of history) {
    validate(record);
    if (record.ledgerSequence !== ++sequence || seen.has(record.id)) {
      throw new Error("invalid quarantine review causal sequence or duplicate operation");
    }
    seen.add(record.id);
    if (record.kind === "compute.lease.review.opened") {
      if (result.has(record.leaseId)) throw new Error("duplicate quarantine review case");
      result.set(record.leaseId, { open: record });
    } else {
      const existing = result.get(record.leaseId);
      if (!existing || existing.resolved) {
        throw new Error("quarantine review resolved without unique open case");
      }
      if (existing.open.workspaceId !== record.workspaceId
        || existing.open.executionId !== record.executionId
        || existing.open.expectedEffectId !== record.expectedEffectId
        || existing.open.quarantineRecordId !== record.quarantineRecordId
        || timestamp("review resolution", record.transactionTime.from)
          < timestamp("review open", existing.open.transactionTime.from)) {
        throw new Error("quarantine review resolution does not match opened case");
      }
      existing.resolved = record;
    }
  }
  return result;
}

/**
 * Operator-only durable quarantined-lease review.
 *
 * Nothing here releases an issued lease, starts a worker, compensates an
 * external effect, or creates a governed semantic acceptance. A trusted human
 * policy and independent corroborating verification are both necessary to
 * write an immutable review conclusion.
 */
export class PostgresHostedQuarantineReviewJournal {
  readonly #ledger: PostgresCanonicalLedger<QuarantineReviewOperation>;
  readonly #state: PostgresHostedComputeStatePort;
  readonly #verifications: PostgresHostedEffectVerificationJournal;
  readonly #authorizeReviewer: TrustedQuarantineReviewerPolicy;

  private constructor(input: {
    readonly ledger: PostgresCanonicalLedger<QuarantineReviewOperation>;
    readonly computeState: PostgresHostedComputeStatePort;
    readonly verifications: PostgresHostedEffectVerificationJournal;
    readonly authorizeReviewer: TrustedQuarantineReviewerPolicy;
  }) {
    this.#ledger = input.ledger;
    this.#state = input.computeState;
    this.#verifications = input.verifications;
    this.#authorizeReviewer = input.authorizeReviewer;
  }

  static open(input: {
    readonly pool: PostgresPool;
    readonly namespace?: string;
    readonly computeState: PostgresHostedComputeStatePort;
    readonly verifications: PostgresHostedEffectVerificationJournal;
    readonly authorizeReviewer: TrustedQuarantineReviewerPolicy;
  }): PostgresHostedQuarantineReviewJournal {
    if (typeof input.authorizeReviewer !== "function") {
      throw new TypeError("trusted human reviewer policy required");
    }
    return new PostgresHostedQuarantineReviewJournal({
      ledger: PostgresCanonicalLedger.open({
        pool: input.pool, namespace: input.namespace ?? "hosted-quarantine-reviews",
      }),
      computeState: input.computeState,
      verifications: input.verifications,
      authorizeReviewer: input.authorizeReviewer,
    });
  }

  async history(input: { readonly workspaceId: string }): Promise<readonly QuarantineReviewOperation[]> {
    identifier("workspace", input.workspaceId, "workspace:");
    const history = await this.#ledger.load({ workspaceId: input.workspaceId });
    replay(history);
    return history;
  }

  async #context(input: {
    readonly workspaceId: string;
    readonly leaseId: string;
  }): Promise<{
    readonly executionId: string;
    readonly expectedEffectId: string;
    readonly quarantineRecordId: string;
    readonly quarantineRecordedAt: number;
  }> {
    const state = await this.#state.history();
    const queued = state.find(x => x.kind === "compute.lease.queued"
      && x.lease.id === input.leaseId);
    const quarantine = state.find(x => x.kind === "compute.lease.quarantined"
      && x.leaseId === input.leaseId);
    if (queued?.kind !== "compute.lease.queued"
      || quarantine?.kind !== "compute.lease.quarantined") {
      throw new Error("quarantine review requires a canonical quarantined lease");
    }
    if (queued.lease.envelope.correlation.workspaceId !== input.workspaceId) {
      throw new Error("quarantine review workspace scope mismatch");
    }
    return {
      executionId: queued.lease.envelope.executionId,
      expectedEffectId: queued.lease.envelope.expectedEffect.id,
      quarantineRecordId: quarantine.id,
      quarantineRecordedAt: timestamp("quarantine event", quarantine.transactionTime.from),
    };
  }

  async #allow(input: {
    readonly workspaceId: string;
    readonly leaseId: string;
    readonly reviewerPrincipalId: string;
    readonly action: "OPEN" | "RESOLVE";
  }): Promise<void> {
    if (await this.#authorizeReviewer(input) !== true) {
      throw new Error("quarantine reviewer denied by trusted human policy");
    }
  }

  async openCase(input: {
    readonly workspaceId: string;
    readonly leaseId: string;
    readonly reviewerPrincipalId: string;
    readonly recordedAt: string;
  }): Promise<QuarantineReviewOpened> {
    identifier("workspace", input.workspaceId, "workspace:");
    identifier("lease", input.leaseId, "compute-lease:");
    identifier("human reviewer", input.reviewerPrincipalId, "principal:");
    const at = timestamp("case openedAt", input.recordedAt);
    await this.#allow({ ...input, action: "OPEN" });
    const context = await this.#context(input);
    if (at < context.quarantineRecordedAt) throw new Error("review cannot predate quarantine");
    const record: QuarantineReviewOpened = {
      id: "quarantine-review:opened:" + input.leaseId,
      kind: "compute.lease.review.opened", workspaceId: input.workspaceId,
      transactionTime: { from: new Date(at).toISOString() },
      leaseId: input.leaseId, ...contextForRecord(context),
      reviewerPrincipalId: input.reviewerPrincipalId,
      observationOnly: true, acceptedTruth: false, semanticMutation: false,
    };
    await this.#ledger.appendValidated({
      workspaceId: input.workspaceId,
      decide: history => {
        if (replay(history).has(input.leaseId)) throw new Error("quarantine review case already open");
        return { record, result: undefined };
      },
    });
    const persisted = await this.#ledger.get(record.id);
    if (persisted?.kind !== "compute.lease.review.opened") throw new Error("committed open review missing");
    return persisted;
  }

  async resolveCase(input: {
    readonly workspaceId: string;
    readonly leaseId: string;
    readonly reviewerPrincipalId: string;
    readonly recordedAt: string;
    readonly rationale: string;
  }): Promise<QuarantineReviewResolved> {
    identifier("workspace", input.workspaceId, "workspace:");
    identifier("lease", input.leaseId, "compute-lease:");
    identifier("human reviewer", input.reviewerPrincipalId, "principal:");
    const at = timestamp("review resolution", input.recordedAt);
    if (typeof input.rationale !== "string" || !input.rationale.trim()
      || input.rationale.length > 2048) throw new TypeError("reviewer rationale is required and bounded");
    await this.#allow({ ...input, action: "RESOLVE" });
    const context = await this.#context(input);
    const expectedReceiptId = "compute-node-observation:"
      + context.executionId.slice("compute-execution:".length);
    const verifications = await this.#verifications.history({ workspaceId: input.workspaceId });
    const independent = verifications.find(x => x.receiptId === expectedReceiptId
      && x.executionId === context.executionId
      && x.expectedEffectId === context.expectedEffectId);
    if (!independent || independent.status === "UNCERTAIN") {
      throw new Error("cannot resolve review without decisive independently verified effect evidence");
    }
    if (at < timestamp("verification recordedAt", independent.transactionTime.from)) {
      throw new Error("review cannot predate independent verification");
    }
    const record: QuarantineReviewResolved = {
      id: "quarantine-review:resolved:" + input.leaseId,
      kind: "compute.lease.review.resolved",
      workspaceId: input.workspaceId,
      transactionTime: { from: new Date(at).toISOString() },
      leaseId: input.leaseId, ...contextForRecord(context),
      reviewerPrincipalId: input.reviewerPrincipalId,
      status: independent.status === "CONFIRMED" ? "EFFECT_CONFIRMED" : "EFFECT_DIVERGED",
      verificationId: independent.id,
      evidenceId: independent.evidenceId, evidenceSourceId: independent.evidenceSourceId,
      rationale: input.rationale.trim(),
      observationOnly: true, acceptedTruth: false, semanticMutation: false,
    };
    await this.#ledger.appendValidated({
      workspaceId: input.workspaceId,
      decide: history => {
        const current = replay(history).get(input.leaseId);
        if (!current) throw new Error("quarantine review case not opened");
        if (current.resolved) throw new Error("quarantine review already resolved");
        if (current.open.quarantineRecordId !== context.quarantineRecordId
          || current.open.executionId !== context.executionId
          || at < timestamp("case opened", current.open.transactionTime.from)) {
          throw new Error("quarantine review does not match its opened case");
        }
        return { record, result: undefined };
      },
    });
    const persisted = await this.#ledger.get(record.id);
    if (persisted?.kind !== "compute.lease.review.resolved") {
      throw new Error("committed quarantine review resolution missing");
    }
    return persisted;
  }
}

function contextForRecord(context: {
  readonly executionId: string; readonly expectedEffectId: string;
  readonly quarantineRecordId: string;
}): { readonly executionId: string; readonly expectedEffectId: string;
  readonly quarantineRecordId: string } {
  return { executionId: context.executionId,
    expectedEffectId: context.expectedEffectId,
    quarantineRecordId: context.quarantineRecordId };
}
