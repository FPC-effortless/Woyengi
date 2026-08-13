import type { ClaimRecord } from "../../core/src/index.ts";

export interface ClaimHistoryFilter {
  readonly subject?: string;
  readonly predicate?: string;
}

export class ClaimLedger {
  readonly #claimsById = new Map<string, ClaimRecord>();

  append(claim: ClaimRecord): void {
    if (this.#claimsById.has(claim.id)) {
      throw new Error(`claim already exists: ${claim.id}`);
    }
    this.#claimsById.set(claim.id, claim);
  }

  history(filter: ClaimHistoryFilter = {}): readonly ClaimRecord[] {
    const claims = [...this.#claimsById.values()]
      .filter((claim) => filter.subject === undefined || claim.subject === filter.subject)
      .filter((claim) => filter.predicate === undefined || claim.predicate === filter.predicate)
      .sort(compareTransactionOrder);

    return Object.freeze(claims);
  }
}

function compareTransactionOrder(left: ClaimRecord, right: ClaimRecord): number {
  return (
    left.transactionTime.from.localeCompare(right.transactionTime.from) ||
    left.id.localeCompare(right.id)
  );
}
