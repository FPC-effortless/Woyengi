import type { StateValue } from "../../core/src/index.ts";
import {
  createPlatformEvent,
  type EventDelivery,
  type PlatformEvent,
  type Subscription,
} from "../../event-bus/src/index.ts";
import type { WorkInstanceId } from "../../work/src/index.ts";
import type {
  Principal,
  PrincipalId,
  WorkspaceContext,
  WorkspaceId,
} from "../../workspace/src/index.ts";

export type CollaborationVisibility = "internal" | "public";
export type CollaborationOperation = "SUBSCRIBE" | "PUBLISH" | "PRESENCE";

export interface DurableCollaborationEventPort {
  publish(event: PlatformEvent): Promise<void>;
  pending(subscription: Subscription): Promise<readonly EventDelivery[]>;
  consume(
    subscription: Subscription,
    handler: (delivery: EventDelivery) => Promise<void>,
  ): Promise<void>;
}

export interface CollaborationAuthorityRequest {
  readonly principalId: PrincipalId;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly visibility: CollaborationVisibility;
  readonly operation: CollaborationOperation;
}

export interface CollaborationEnvelope extends Readonly<Record<string, StateValue>> {
  readonly contract: "woyengi.collaboration.v1";
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly version: number;
  readonly visibility: CollaborationVisibility;
  readonly eventType: string;
  readonly payload: StateValue;
  readonly actorPrincipalId: PrincipalId;
  readonly transactionTime: { readonly from: string };
}

export interface CollaborationSession {
  readonly id: string;
  readonly principal: Principal;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly visibility: CollaborationVisibility;
  readonly subscription: Subscription;
}

export interface PresenceEntry {
  readonly sessionId: string;
  readonly principalId: PrincipalId;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly visibility: CollaborationVisibility;
  readonly state: string;
  readonly targetId?: string;
  readonly recordedAt: string;
}

export class CollaborationHub {
  readonly #events: DurableCollaborationEventPort;
  readonly #authorize: (request: CollaborationAuthorityRequest) => boolean;
  readonly #sessions = new Map<string, CollaborationSession>();
  readonly #presence = new Map<string, PresenceEntry>();
  #publishQueue: Promise<void> = Promise.resolve();

  constructor(input: {
    readonly events: DurableCollaborationEventPort;
    readonly authorize: (request: CollaborationAuthorityRequest) => boolean;
  }) {
    this.#events = input.events;
    this.#authorize = input.authorize;
  }

  connect(input: {
    readonly id: string;
    readonly principal: Principal;
    readonly workspaceId: WorkspaceId;
    readonly workspaceContext: WorkspaceContext;
    readonly workInstanceId: WorkInstanceId;
    readonly visibility: CollaborationVisibility;
  }): CollaborationSession {
    const id = prefixed("collaboration session id", input.id, "collaboration-session:");
    if (input.workspaceId !== input.workspaceContext.workspaceId) {
      throw new Error("workspace does not match workspace context");
    }
    if (input.principal.id !== input.workspaceContext.principalId) {
      throw new Error("principal does not match workspace context");
    }
    namespaced("work instance id", input.workInstanceId);
    this.#requireAuthority({
      principalId: input.principal.id,
      workspaceId: input.workspaceId,
      workInstanceId: input.workInstanceId,
      visibility: input.visibility,
      operation: "SUBSCRIBE",
    });
    const session = deepFreeze({
      id,
      principal: input.principal,
      workspaceId: input.workspaceId,
      workInstanceId: input.workInstanceId,
      visibility: input.visibility,
      subscription: {
        id: subscriptionId(input),
        topicPrefixes: ["work.collaboration."],
      },
    });
    this.#sessions.set(id, session);
    return session;
  }

  disconnect(session: CollaborationSession): void {
    const active = this.#activeSession(session);
    this.#sessions.delete(active.id);
    this.#presence.delete(active.id);
  }

  publish(
    session: CollaborationSession,
    input: {
      readonly id: string;
      readonly expectedVersion: number;
      readonly visibility: CollaborationVisibility;
      readonly eventType: string;
      readonly payload: StateValue;
      readonly recordedAt: string;
    },
  ): Promise<CollaborationEnvelope> {
    const run = async (): Promise<CollaborationEnvelope> => {
      const active = this.#activeSession(session);
      this.#requireSessionAuthority(active, "PUBLISH");
      if (active.visibility === "public" && input.visibility !== "public") {
        throw new Error("public collaboration sessions cannot publish internal events");
      }
      const eventType = dotted("collaboration event type", input.eventType);
      if (eventType.split(".").includes("presence")) {
        throw new Error("presence is ephemeral and cannot be published as a durable event");
      }
      if (input.visibility === "public" && containsInternalCapabilityData(input.payload)) {
        throw new Error("public collaboration payload contains internal capability data");
      }
      const actualVersion = await this.#currentVersion(active);
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
        throw new TypeError("expectedVersion must be a non-negative safe integer");
      }
      if (input.expectedVersion !== actualVersion) {
        throw new Error(
          `collaboration version conflict: expected ${input.expectedVersion}, actual ${actualVersion}`,
        );
      }
      const envelope: CollaborationEnvelope = deepFreeze({
        contract: "woyengi.collaboration.v1" as const,
        workspaceId: active.workspaceId,
        workInstanceId: active.workInstanceId,
        version: actualVersion + 1,
        visibility: input.visibility,
        eventType,
        payload: cloneStateValue(input.payload),
        actorPrincipalId: active.principal.id,
        transactionTime: { from: normalizeInstant(input.recordedAt) },
      });
      await this.#events.publish(
        createPlatformEvent({
          id: input.id,
          topic: `work.collaboration.${input.visibility}`,
          aggregateId: active.workInstanceId,
          causedBy: active.principal.id,
          payload: envelope,
          recordedAt: input.recordedAt,
        }),
      );
      return envelope;
    };
    const result = this.#publishQueue.then(run, run);
    this.#publishQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async receive(session: CollaborationSession): Promise<readonly CollaborationEnvelope[]> {
    const active = this.#activeSession(session);
    this.#requireSessionAuthority(active, "SUBSCRIBE");
    const received: CollaborationEnvelope[] = [];
    await this.#events.consume(active.subscription, async (delivery) => {
      const envelope = collaborationEnvelope(delivery.event);
      if (
        envelope === undefined ||
        envelope.workspaceId !== active.workspaceId ||
        envelope.workInstanceId !== active.workInstanceId
      ) {
        return;
      }
      if (active.visibility === "public") {
        if (envelope.visibility !== "public" || containsInternalCapabilityData(envelope.payload)) return;
      }
      received.push(envelope);
    });
    return deepFreeze(received);
  }

  updatePresence(
    session: CollaborationSession,
    input: { readonly state: string; readonly targetId?: string; readonly recordedAt: string },
  ): PresenceEntry {
    const active = this.#activeSession(session);
    this.#requireSessionAuthority(active, "PRESENCE");
    const entry: PresenceEntry = deepFreeze({
      sessionId: active.id,
      principalId: active.principal.id,
      workspaceId: active.workspaceId,
      workInstanceId: active.workInstanceId,
      visibility: active.visibility,
      state: requiredText("presence state", input.state),
      ...(input.targetId === undefined
        ? {}
        : { targetId: namespaced("presence target id", input.targetId) }),
      recordedAt: normalizeInstant(input.recordedAt),
    });
    this.#presence.set(active.id, entry);
    return entry;
  }

  presence(session: CollaborationSession): readonly PresenceEntry[] {
    const active = this.#activeSession(session);
    this.#requireSessionAuthority(active, "PRESENCE");
    return deepFreeze(
      [...this.#presence.values()].filter(
        (entry) =>
          entry.workspaceId === active.workspaceId &&
          entry.workInstanceId === active.workInstanceId &&
          (active.visibility === "internal" || entry.visibility === "public"),
      ),
    );
  }

  async #currentVersion(session: CollaborationSession): Promise<number> {
    const deliveries = await this.#events.pending({
      id: versionSubscriptionId(session.workspaceId, session.workInstanceId),
      topicPrefixes: ["work.collaboration."],
    });
    let version = 0;
    for (const delivery of deliveries) {
      const envelope = collaborationEnvelope(delivery.event);
      if (
        envelope !== undefined &&
        envelope.workspaceId === session.workspaceId &&
        envelope.workInstanceId === session.workInstanceId
      ) {
        version = Math.max(version, envelope.version);
      }
    }
    return version;
  }

  #activeSession(session: CollaborationSession): CollaborationSession {
    const active = this.#sessions.get(session.id);
    if (active !== session) throw new Error("collaboration session is not connected");
    return active;
  }

  #requireSessionAuthority(session: CollaborationSession, operation: CollaborationOperation): void {
    this.#requireAuthority({
      principalId: session.principal.id,
      workspaceId: session.workspaceId,
      workInstanceId: session.workInstanceId,
      visibility: session.visibility,
      operation,
    });
  }

  #requireAuthority(request: CollaborationAuthorityRequest): void {
    let allowed = false;
    try {
      allowed = this.#authorize(deepFreeze({ ...request })) === true;
    } catch {
      allowed = false;
    }
    if (!allowed) {
      throw new Error(
        `collaboration authority denied: ${request.operation} ${request.principalId} ${request.workspaceId}`,
      );
    }
  }
}

function subscriptionId(input: {
  readonly id: string;
  readonly principal: Principal;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly visibility: CollaborationVisibility;
}): string {
  return `subscription:collaboration:${encodeURIComponent(input.id)}:${encodeURIComponent(input.principal.id)}:${encodeURIComponent(input.workspaceId)}:${encodeURIComponent(input.workInstanceId)}:${input.visibility}`;
}

function versionSubscriptionId(workspaceId: WorkspaceId, workInstanceId: WorkInstanceId): string {
  return `subscription:collaboration-version:${encodeURIComponent(workspaceId)}:${encodeURIComponent(workInstanceId)}`;
}

function collaborationEnvelope(event: PlatformEvent): CollaborationEnvelope | undefined {
  const value = event.payload;
  if (!isStateObject(value)) return undefined;
  if (
    value.contract !== "woyengi.collaboration.v1" ||
    typeof value.workspaceId !== "string" ||
    typeof value.workInstanceId !== "string" ||
    !Number.isSafeInteger(value.version) ||
    typeof value.version !== "number" ||
    value.version < 1 ||
    (value.visibility !== "internal" && value.visibility !== "public") ||
    typeof value.eventType !== "string" ||
    typeof value.actorPrincipalId !== "string" ||
    !isStateObject(value.transactionTime) ||
    typeof value.transactionTime.from !== "string" ||
    !("payload" in value)
  ) {
    return undefined;
  }
  return value as unknown as CollaborationEnvelope;
}

function isStateObject(value: unknown): value is { readonly [key: string]: StateValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function containsInternalCapabilityData(value: StateValue): boolean {
  if (typeof value === "string") return value.toLowerCase().includes("capability:");
  if (Array.isArray(value)) return value.some(containsInternalCapabilityData);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, nested]) =>
        /(?:capabilit|credential|secret|authorization-grant|permission-grant)/i.test(key) ||
        containsInternalCapabilityData(nested),
    );
  }
  return false;
}

function cloneStateValue(value: StateValue): StateValue {
  if (Array.isArray(value)) return value.map(cloneStateValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneStateValue(nested)]),
    );
  }
  return value;
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

function dotted(name: string, value: string): string {
  const normalized = requiredText(name, value);
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(normalized)) {
    throw new TypeError(`${name} must use dotted lower-case segments`);
  }
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
