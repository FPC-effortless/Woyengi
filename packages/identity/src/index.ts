import type { Authority, EntityId, Provenance } from "../../core/src/index.ts";

interface IdentityOperationBase {
  readonly id: string;
  readonly transactionTime: { readonly from: string };
  readonly provenance: Provenance;
}

export interface EntityCreatedOperation extends IdentityOperationBase {
  readonly kind: "entity.created";
  readonly entityId: EntityId;
}

export interface AliasAddedOperation extends IdentityOperationBase {
  readonly kind: "alias.added";
  readonly entityId: EntityId;
  readonly alias: string;
  readonly aliasKind: "name" | "email" | "handle" | "external-id" | "other";
}

export interface MatchProposedOperation extends IdentityOperationBase {
  readonly kind: "match.proposed";
  readonly leftEntityId: EntityId;
  readonly rightEntityId: EntityId;
  readonly score: number;
  readonly rationale: string;
}

export interface EntitiesMergedOperation extends IdentityOperationBase {
  readonly kind: "entities.merged";
  readonly canonicalEntityId: EntityId;
  readonly mergedEntityId: EntityId;
  readonly proposalId?: string;
  readonly authority: Authority;
}

export interface EntitySplitOperation extends IdentityOperationBase {
  readonly kind: "entity.split";
  readonly entityId: EntityId;
  readonly authority: Authority;
}

export type IdentityOperation =
  | EntityCreatedOperation
  | AliasAddedOperation
  | MatchProposedOperation
  | EntitiesMergedOperation
  | EntitySplitOperation;

interface OperationInput {
  readonly id: string;
  readonly recordedAt: string;
  readonly provenance: Provenance;
}

export function createEntityOperation(
  input: OperationInput & { readonly entityId: string },
): EntityCreatedOperation {
  return deepFreeze({
    ...base(input),
    kind: "entity.created" as const,
    entityId: entityId(input.entityId),
  });
}

export function addAliasOperation(
  input: OperationInput & {
    readonly entityId: string;
    readonly alias: string;
    readonly aliasKind: AliasAddedOperation["aliasKind"];
  },
): AliasAddedOperation {
  return deepFreeze({
    ...base(input),
    kind: "alias.added" as const,
    entityId: entityId(input.entityId),
    alias: normalizeAlias(input.alias),
    aliasKind: input.aliasKind,
  });
}

export function proposeMatchOperation(
  input: OperationInput & {
    readonly leftEntityId: string;
    readonly rightEntityId: string;
    readonly score: number;
    readonly rationale: string;
  },
): MatchProposedOperation {
  if (input.score < 0 || input.score > 1) {
    throw new RangeError("identity match score must be between 0 and 1");
  }
  return deepFreeze({
    ...base(input),
    kind: "match.proposed" as const,
    leftEntityId: entityId(input.leftEntityId),
    rightEntityId: entityId(input.rightEntityId),
    score: input.score,
    rationale: requiredText("rationale", input.rationale),
  });
}

export function mergeEntitiesOperation(
  input: OperationInput & {
    readonly canonicalEntityId: string;
    readonly mergedEntityId: string;
    readonly proposalId?: string;
    readonly authority: Authority;
  },
): EntitiesMergedOperation {
  return deepFreeze({
    ...base(input),
    kind: "entities.merged" as const,
    canonicalEntityId: entityId(input.canonicalEntityId),
    mergedEntityId: entityId(input.mergedEntityId),
    ...(input.proposalId === undefined
      ? {}
      : { proposalId: operationId(input.proposalId) }),
    authority: cloneAuthority(input.authority),
  });
}

export function splitEntityOperation(
  input: OperationInput & {
    readonly entityId: string;
    readonly authority: Authority;
  },
): EntitySplitOperation {
  return deepFreeze({
    ...base(input),
    kind: "entity.split" as const,
    entityId: entityId(input.entityId),
    authority: cloneAuthority(input.authority),
  });
}

export class IdentityRegistry {
  readonly #entities = new Set<string>();
  readonly #aliases = new Map<string, Set<string>>();
  readonly #proposals = new Map<string, MatchProposedOperation>();
  readonly #confirmedProposals = new Set<string>();
  readonly #mergedInto = new Map<string, string>();
  readonly #mergeHistory = new Map<string, (EntitiesMergedOperation | EntitySplitOperation)[]>();
  readonly #operations: IdentityOperation[] = [];
  readonly #operationIds = new Set<string>();

  static replay(
    operations: readonly IdentityOperation[],
    options: { readonly until?: string } = {},
  ): IdentityRegistry {
    const registry = new IdentityRegistry();
    const until = options.until === undefined ? undefined : normalizeInstant(options.until);
    const ordered = [...operations]
      .filter((operation) => until === undefined || operation.transactionTime.from <= until)
      .sort(compareOperations);
    for (const operation of ordered) {
      registry.apply(operation);
    }
    return registry;
  }

  apply(operation: IdentityOperation): void {
    if (this.#operationIds.has(operation.id)) {
      throw new Error(`identity operation already exists: ${operation.id}`);
    }
    switch (operation.kind) {
      case "entity.created":
        if (this.#entities.has(operation.entityId)) {
          throw new Error(`entity already exists: ${operation.entityId}`);
        }
        this.#entities.add(operation.entityId);
        break;
      case "alias.added":
        this.#assertEntity(operation.entityId);
        this.#addAlias(operation.alias, operation.entityId);
        break;
      case "match.proposed":
        this.#assertEntity(operation.leftEntityId);
        this.#assertEntity(operation.rightEntityId);
        this.#proposals.set(operation.id, operation);
        break;
      case "entities.merged":
        this.#applyMerge(operation);
        break;
      case "entity.split":
        this.#applySplit(operation);
        break;
    }
    this.#operationIds.add(operation.id);
    this.#operations.push(operation);
  }

  resolveAlias(alias: string): readonly EntityId[] {
    const owners = this.#aliases.get(normalizeAlias(alias)) ?? new Set<string>();
    const resolved = [...new Set([...owners].map((owner) => this.#canonical(owner)))].sort();
    return Object.freeze(resolved.map((item) => item as EntityId));
  }

  matchStatus(proposalId: string): "provisional" | "confirmed" | undefined {
    if (!this.#proposals.has(proposalId)) {
      return undefined;
    }
    return this.#confirmedProposals.has(proposalId) ? "confirmed" : "provisional";
  }

  mergeHistory(entity: string): readonly (EntitiesMergedOperation | EntitySplitOperation)[] {
    return Object.freeze([...(this.#mergeHistory.get(entity) ?? [])].sort(compareOperations));
  }

  history(): readonly IdentityOperation[] {
    return Object.freeze([...this.#operations].sort(compareOperations));
  }

  #applyMerge(operation: EntitiesMergedOperation): void {
    this.#assertEntity(operation.canonicalEntityId);
    this.#assertEntity(operation.mergedEntityId);
    if (this.#canonical(operation.canonicalEntityId) === this.#canonical(operation.mergedEntityId)) {
      throw new Error("cannot merge identities that already resolve together");
    }
    if (operation.proposalId !== undefined) {
      if (!this.#proposals.has(operation.proposalId)) {
        throw new Error(`identity match proposal does not exist: ${operation.proposalId}`);
      }
      this.#confirmedProposals.add(operation.proposalId);
    }
    this.#mergedInto.set(operation.mergedEntityId, operation.canonicalEntityId);
    this.#appendMergeHistory(operation.mergedEntityId, operation);
  }

  #applySplit(operation: EntitySplitOperation): void {
    this.#assertEntity(operation.entityId);
    if (!this.#mergedInto.delete(operation.entityId)) {
      throw new Error(`entity is not merged: ${operation.entityId}`);
    }
    this.#appendMergeHistory(operation.entityId, operation);
  }

  #canonical(entity: string): string {
    const visited = new Set<string>();
    let current = entity;
    while (this.#mergedInto.has(current)) {
      if (visited.has(current)) {
        throw new Error(`identity merge cycle detected at ${current}`);
      }
      visited.add(current);
      current = this.#mergedInto.get(current) as string;
    }
    return current;
  }

  #addAlias(alias: string, entity: string): void {
    const owners = this.#aliases.get(alias) ?? new Set<string>();
    owners.add(entity);
    this.#aliases.set(alias, owners);
  }

  #appendMergeHistory(
    entity: string,
    operation: EntitiesMergedOperation | EntitySplitOperation,
  ): void {
    const history = this.#mergeHistory.get(entity) ?? [];
    history.push(operation);
    this.#mergeHistory.set(entity, history);
  }

  #assertEntity(entity: string): void {
    if (!this.#entities.has(entity)) {
      throw new Error(`entity does not exist: ${entity}`);
    }
  }
}

function base(input: OperationInput): IdentityOperationBase {
  return {
    id: operationId(input.id),
    transactionTime: { from: normalizeInstant(input.recordedAt) },
    provenance: cloneProvenance(input.provenance),
  };
}

function operationId(value: string): string {
  const normalized = requiredText("identity operation id", value);
  if (!normalized.startsWith("identity-op:")) {
    throw new TypeError("identity operation id must start with identity-op:");
  }
  return normalized;
}

function entityId(value: string): EntityId {
  const normalized = requiredText("entity id", value);
  if (!normalized.startsWith("entity:")) {
    throw new TypeError("entity id must start with entity:");
  }
  return normalized as EntityId;
}

function normalizeAlias(value: string): string {
  return requiredText("alias", value).toLocaleLowerCase("en-US");
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`timestamp must include an explicit UTC offset: ${value}`);
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError(`invalid timestamp: ${value}`);
  }
  return instant.toISOString();
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
  return normalized;
}

function cloneProvenance(value: Provenance): Provenance {
  return {
    derivedFrom: value.derivedFrom.map((reference) => ({ ...reference })),
    transformations: [...value.transformations],
  };
}

function cloneAuthority(value: Authority): Authority {
  return {
    level: value.level,
    basis: requiredText("authority basis", value.basis),
    ...(value.principal === undefined ? {} : { principal: value.principal }),
  };
}

function compareOperations(left: IdentityOperation, right: IdentityOperation): number {
  return (
    left.transactionTime.from.localeCompare(right.transactionTime.from) || left.id.localeCompare(right.id)
  );
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
