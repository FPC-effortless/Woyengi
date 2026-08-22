import type {
  Principal,
  PrincipalId,
  PrincipalKind,
  WorkspaceId,
} from "../../workspace/src/index.ts";

type OpaqueId<Kind extends string> = string & { readonly __kind: Kind };

export type WorkInstanceId = OpaqueId<"WorkInstanceId">;
export type WorkEpisodeId = OpaqueId<"WorkEpisodeId">;
export type ActivityId = OpaqueId<"ActivityId">;
export type AssignmentId = OpaqueId<"AssignmentId">;
export type WorkOutcomeId = OpaqueId<"WorkOutcomeId">;
export type WorkOperationId = OpaqueId<"WorkOperationId">;

export type WorkValue =
  | null
  | boolean
  | number
  | string
  | readonly WorkValue[]
  | { readonly [key: string]: WorkValue };

export interface ParticipantReference {
  readonly principalId: PrincipalId;
  readonly kind: PrincipalKind;
}

export interface WorkRoleBindings {
  readonly workOwners: readonly PrincipalId[];
  readonly decisionAuthorities: readonly PrincipalId[];
  readonly reviewers: readonly PrincipalId[];
  readonly approvers: readonly PrincipalId[];
}

export interface WorkOutcome {
  readonly id: WorkOutcomeId;
  readonly value: WorkValue;
  readonly recordedByPrincipalId: PrincipalId;
  readonly recordedAt: string;
}

export interface WorkInstance {
  readonly id: WorkInstanceId;
  readonly workspaceId: WorkspaceId;
  readonly intent: string;
  readonly version: number;
  readonly status: "active" | "suspended" | "completed";
  readonly participants: readonly ParticipantReference[];
  readonly roles: WorkRoleBindings;
  readonly context: Readonly<Record<string, WorkValue>>;
  readonly episodeIds: readonly WorkEpisodeId[];
  readonly activityIds: readonly ActivityId[];
  readonly assignmentIds: readonly AssignmentId[];
  readonly outcomes: readonly WorkOutcome[];
  readonly createdAt: string;
}

export interface WorkEpisode {
  readonly id: WorkEpisodeId;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly sequence: number;
  readonly objective: string;
  readonly status: "active" | "suspended" | "completed";
  readonly startedByPrincipalId: PrincipalId;
  readonly context: Readonly<Record<string, WorkValue>>;
  readonly startedAt: string;
}

export interface Activity {
  readonly id: ActivityId;
  readonly activityType: string;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly workEpisodeId: WorkEpisodeId;
  readonly status: "planned" | "active" | "suspended" | "completed";
  readonly context: Readonly<Record<string, WorkValue>>;
  readonly createdByPrincipalId: PrincipalId;
  readonly createdAt: string;
}

export interface AssignmentTransition {
  readonly kind: "assigned" | "handed-off" | "taken-over" | "given-back" | "suspended" | "resumed";
  readonly actorPrincipalId: PrincipalId;
  readonly authorizationReference: string;
  readonly from?: ParticipantReference;
  readonly to: ParticipantReference;
  readonly context: Readonly<Record<string, WorkValue>>;
  readonly transactionTime: { readonly from: string };
}

export interface Assignment {
  readonly id: AssignmentId;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly activityId: ActivityId;
  readonly assignee: ParticipantReference;
  readonly previousAssignee?: ParticipantReference;
  readonly status: "active" | "suspended";
  readonly context: Readonly<Record<string, WorkValue>>;
  readonly transitions: readonly AssignmentTransition[];
}

export type WorkActivityKind =
  | "work-instance.created"
  | "work-episode.started"
  | "activity.added"
  | "activity.assigned"
  | "activity.handed-off"
  | "activity.taken-over"
  | "activity.given-back"
  | "activity.suspended"
  | "activity.resumed"
  | "outcome.recorded";

export interface WorkActivityEntry {
  readonly id: WorkOperationId;
  readonly sequence: number;
  readonly kind: WorkActivityKind;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly actorPrincipalId: PrincipalId;
  readonly workEpisodeId?: WorkEpisodeId;
  readonly activityId?: ActivityId;
  readonly assignmentId?: AssignmentId;
  readonly transactionTime: { readonly from: string };
}

interface OperationBase {
  readonly id: WorkOperationId;
  readonly ledgerSequence: number;
  readonly kind: WorkActivityKind;
  readonly workspaceId: WorkspaceId;
  readonly workInstanceId: WorkInstanceId;
  readonly actorPrincipalId: PrincipalId;
  readonly transactionTime: { readonly from: string };
}

export interface WorkInstanceCreatedOperation extends OperationBase {
  readonly kind: "work-instance.created";
  readonly instance: WorkInstance;
}

export interface WorkEpisodeStartedOperation extends OperationBase {
  readonly kind: "work-episode.started";
  readonly expectedVersion: number;
  readonly episode: WorkEpisode;
}

export interface ActivityAddedOperation extends OperationBase {
  readonly kind: "activity.added";
  readonly expectedVersion: number;
  readonly activity: Activity;
}

export interface ActivityAssignedOperation extends OperationBase {
  readonly kind: "activity.assigned";
  readonly expectedVersion: number;
  readonly assignment: Assignment;
}

export interface AssignmentChangedOperation extends OperationBase {
  readonly kind:
    | "activity.handed-off"
    | "activity.taken-over"
    | "activity.given-back"
    | "activity.suspended"
    | "activity.resumed";
  readonly expectedVersion: number;
  readonly assignmentId: AssignmentId;
  readonly authorizationReference: string;
  readonly to?: ParticipantReference;
  readonly context: Readonly<Record<string, WorkValue>>;
}

export interface OutcomeRecordedOperation extends OperationBase {
  readonly kind: "outcome.recorded";
  readonly expectedVersion: number;
  readonly outcome: WorkOutcome;
}

export type WorkOperation =
  | WorkInstanceCreatedOperation
  | WorkEpisodeStartedOperation
  | ActivityAddedOperation
  | ActivityAssignedOperation
  | AssignmentChangedOperation
  | OutcomeRecordedOperation;

export class WorkRegistry {
  readonly #instances = new Map<string, WorkInstance>();
  readonly #episodes = new Map<string, WorkEpisode>();
  readonly #activities = new Map<string, Activity>();
  readonly #assignments = new Map<string, Assignment>();
  readonly #streams = new Map<string, WorkActivityEntry[]>();
  readonly #operations: WorkOperation[] = [];
  readonly #operationIds = new Set<string>();
  readonly #ledgerSequences = new Set<string>();
  readonly #lastLedgerSequenceByWorkspace = new Map<string, number>();

  static replay(operations: readonly WorkOperation[]): WorkRegistry {
    const registry = new WorkRegistry();
    for (const operation of [...operations].sort(compareOperations)) registry.#apply(operation);
    return registry;
  }

  createWorkInstance(input: {
    readonly operationId: string;
    readonly id: string;
    readonly workspaceId: string;
    readonly intent: string;
    readonly createdByPrincipalId: string;
    readonly participants: readonly Principal[];
    readonly roles: {
      readonly workOwners: readonly string[];
      readonly decisionAuthorities: readonly string[];
      readonly reviewers: readonly string[];
      readonly approvers: readonly string[];
    };
    readonly context: Readonly<Record<string, WorkValue>>;
    readonly recordedAt: string;
  }): WorkInstance {
    const participants = normalizeParticipants(input.participants);
    const roles = normalizeRoles(input.roles, participants);
    const createdBy = principalId(input.createdByPrincipalId);
    assertParticipant(participants, createdBy);
    const instance: WorkInstance = deepFreeze({
      id: workInstanceId(input.id),
      workspaceId: workspaceId(input.workspaceId),
      intent: requiredText("work intent", input.intent),
      version: 1,
      status: "active" as const,
      participants,
      roles,
      context: cloneContext(input.context),
      episodeIds: [],
      activityIds: [],
      assignmentIds: [],
      outcomes: [],
      createdAt: normalizeInstant(input.recordedAt),
    });
    this.#apply(
      deepFreeze({
        id: operationId(input.operationId),
        kind: "work-instance.created" as const,
        ledgerSequence: this.#nextLedgerSequence(instance.workspaceId),
        workspaceId: instance.workspaceId,
        workInstanceId: instance.id,
        actorPrincipalId: createdBy,
        transactionTime: { from: instance.createdAt },
        instance,
      }),
    );
    return instance;
  }

  startEpisode(input: {
    readonly operationId: string;
    readonly id: string;
    readonly workspaceId: string;
    readonly workInstanceId: string;
    readonly expectedVersion: number;
    readonly objective: string;
    readonly actorPrincipalId: string;
    readonly context: Readonly<Record<string, WorkValue>>;
    readonly recordedAt: string;
  }): WorkEpisode {
    const instance = this.#readInstance(input.workspaceId, input.workInstanceId);
    const episode: WorkEpisode = deepFreeze({
      id: workEpisodeId(input.id),
      workspaceId: instance.workspaceId,
      workInstanceId: instance.id,
      sequence: instance.episodeIds.length + 1,
      objective: requiredText("episode objective", input.objective),
      status: "active" as const,
      startedByPrincipalId: principalId(input.actorPrincipalId),
      context: cloneContext(input.context),
      startedAt: normalizeInstant(input.recordedAt),
    });
    this.#apply(
      deepFreeze({
        id: operationId(input.operationId),
        kind: "work-episode.started" as const,
        ledgerSequence: this.#nextLedgerSequence(instance.workspaceId),
        workspaceId: instance.workspaceId,
        workInstanceId: instance.id,
        actorPrincipalId: episode.startedByPrincipalId,
        transactionTime: { from: episode.startedAt },
        expectedVersion: version(input.expectedVersion),
        episode,
      }),
    );
    return episode;
  }

  addActivity(input: {
    readonly operationId: string;
    readonly id: string;
    readonly activityType: string;
    readonly workspaceId: string;
    readonly workInstanceId: string;
    readonly workEpisodeId: string;
    readonly expectedVersion: number;
    readonly actorPrincipalId: string;
    readonly context: Readonly<Record<string, WorkValue>>;
    readonly recordedAt: string;
  }): Activity {
    const instance = this.#readInstance(input.workspaceId, input.workInstanceId);
    const activity: Activity = deepFreeze({
      id: activityId(input.id),
      activityType: namespaced("activity type", input.activityType),
      workspaceId: instance.workspaceId,
      workInstanceId: instance.id,
      workEpisodeId: workEpisodeId(input.workEpisodeId),
      status: "planned" as const,
      context: cloneContext(input.context),
      createdByPrincipalId: principalId(input.actorPrincipalId),
      createdAt: normalizeInstant(input.recordedAt),
    });
    this.#apply(
      deepFreeze({
        id: operationId(input.operationId),
        kind: "activity.added" as const,
        ledgerSequence: this.#nextLedgerSequence(instance.workspaceId),
        workspaceId: instance.workspaceId,
        workInstanceId: instance.id,
        actorPrincipalId: activity.createdByPrincipalId,
        transactionTime: { from: activity.createdAt },
        expectedVersion: version(input.expectedVersion),
        activity,
      }),
    );
    return activity;
  }

  assignActivity(input: {
    readonly operationId: string;
    readonly id: string;
    readonly workspaceId: string;
    readonly workInstanceId: string;
    readonly activityId: string;
    readonly expectedVersion: number;
    readonly assignedByPrincipalId: string;
    readonly assignee: Principal;
    readonly authorizationReference: string;
    readonly context: Readonly<Record<string, WorkValue>>;
    readonly recordedAt: string;
  }): Assignment {
    const instance = this.#readInstance(input.workspaceId, input.workInstanceId);
    const actor = principalId(input.assignedByPrincipalId);
    const assignee = normalizeParticipant(input.assignee);
    const recordedAt = normalizeInstant(input.recordedAt);
    const context = cloneContext(input.context);
    const assignment: Assignment = deepFreeze({
      id: assignmentId(input.id),
      workspaceId: instance.workspaceId,
      workInstanceId: instance.id,
      activityId: activityId(input.activityId),
      assignee,
      status: "active" as const,
      context,
      transitions: [
        {
          kind: "assigned" as const,
          actorPrincipalId: actor,
          authorizationReference: namespaced("authorization reference", input.authorizationReference),
          to: assignee,
          context,
          transactionTime: { from: recordedAt },
        },
      ],
    });
    this.#apply(
      deepFreeze({
        id: operationId(input.operationId),
        kind: "activity.assigned" as const,
        ledgerSequence: this.#nextLedgerSequence(instance.workspaceId),
        workspaceId: instance.workspaceId,
        workInstanceId: instance.id,
        actorPrincipalId: actor,
        transactionTime: { from: recordedAt },
        expectedVersion: version(input.expectedVersion),
        assignment,
      }),
    );
    return assignment;
  }

  handoffActivity(input: TransitionInput & { readonly to: Principal }): Assignment {
    return this.#changeAssignment({ ...input, kind: "activity.handed-off", to: input.to });
  }

  takeOverActivity(input: Omit<TransitionInput, "actorPrincipalId"> & { readonly actor: Principal }): Assignment {
    return this.#changeAssignment({
      ...input,
      kind: "activity.taken-over",
      actorPrincipalId: input.actor.id,
      to: input.actor,
    });
  }

  giveBackActivity(input: TransitionInput): Assignment {
    return this.#changeAssignment({ ...input, kind: "activity.given-back" });
  }

  suspendActivity(input: TransitionInput): Assignment {
    return this.#changeAssignment({ ...input, kind: "activity.suspended" });
  }

  resumeActivity(input: TransitionInput): Assignment {
    return this.#changeAssignment({ ...input, kind: "activity.resumed" });
  }

  recordOutcome(input: {
    readonly operationId: string;
    readonly id: string;
    readonly workspaceId: string;
    readonly workInstanceId: string;
    readonly expectedVersion: number;
    readonly actorPrincipalId: string;
    readonly value: WorkValue;
    readonly recordedAt: string;
  }): WorkOutcome {
    const instance = this.#readInstance(input.workspaceId, input.workInstanceId);
    const outcome: WorkOutcome = deepFreeze({
      id: workOutcomeId(input.id),
      value: structuredClone(input.value),
      recordedByPrincipalId: principalId(input.actorPrincipalId),
      recordedAt: normalizeInstant(input.recordedAt),
    });
    this.#apply(
      deepFreeze({
        id: operationId(input.operationId),
        kind: "outcome.recorded" as const,
        ledgerSequence: this.#nextLedgerSequence(instance.workspaceId),
        workspaceId: instance.workspaceId,
        workInstanceId: instance.id,
        actorPrincipalId: outcome.recordedByPrincipalId,
        transactionTime: { from: outcome.recordedAt },
        expectedVersion: version(input.expectedVersion),
        outcome,
      }),
    );
    return outcome;
  }

  workInstance(input: { readonly workspaceId: string; readonly id: string }): WorkInstance {
    return this.#readInstance(input.workspaceId, input.id);
  }

  episodesFor(input: { readonly workspaceId: string; readonly workInstanceId: string }): readonly WorkEpisode[] {
    const instance = this.#readInstance(input.workspaceId, input.workInstanceId);
    return deepFreeze(instance.episodeIds.map((id) => this.#episodes.get(id) as WorkEpisode));
  }

  activitiesFor(input: { readonly workspaceId: string; readonly workInstanceId: string }): readonly Activity[] {
    const instance = this.#readInstance(input.workspaceId, input.workInstanceId);
    return deepFreeze(instance.activityIds.map((id) => this.#activities.get(id) as Activity));
  }

  assignment(input: { readonly workspaceId: string; readonly id: string }): Assignment {
    const id = assignmentId(input.id);
    const assignment = this.#assignments.get(id);
    if (assignment === undefined) throw new Error(`assignment does not exist: ${id}`);
    assertWorkspace(assignment.workspaceId, workspaceId(input.workspaceId), "assignment");
    return assignment;
  }

  activityStream(input: { readonly workspaceId: string; readonly workInstanceId: string }): readonly WorkActivityEntry[] {
    const instance = this.#readInstance(input.workspaceId, input.workInstanceId);
    return deepFreeze([...(this.#streams.get(instance.id) ?? [])]);
  }

  history(): readonly WorkOperation[] {
    return Object.freeze([...this.#operations].sort(compareOperations));
  }

  #changeAssignment(
    input: TransitionInput & {
      readonly kind: AssignmentChangedOperation["kind"];
      readonly to?: Principal;
    },
  ): Assignment {
    const instance = this.#readInstance(input.workspaceId, input.workInstanceId);
    const operation: AssignmentChangedOperation = deepFreeze({
      id: operationId(input.operationId),
      kind: input.kind,
      ledgerSequence: this.#nextLedgerSequence(instance.workspaceId),
      workspaceId: instance.workspaceId,
      workInstanceId: instance.id,
      actorPrincipalId: principalId(input.actorPrincipalId),
      transactionTime: { from: normalizeInstant(input.recordedAt) },
      expectedVersion: version(input.expectedVersion),
      assignmentId: assignmentId(input.assignmentId),
      authorizationReference: namespaced("authorization reference", input.authorizationReference),
      ...(input.to === undefined ? {} : { to: normalizeParticipant(input.to) }),
      context: cloneContext(input.context),
    });
    this.#apply(operation);
    return this.#assignments.get(operation.assignmentId) as Assignment;
  }

  #apply(rawOperation: WorkOperation): void {
    const operation = deepFreeze(structuredClone(rawOperation));
    validateOperation(operation);
    if (this.#operationIds.has(operation.id)) throw new Error(`work operation already exists: ${operation.id}`);
    const sequenceKey = `${operation.workspaceId}\u0000${operation.ledgerSequence}`;
    if (this.#ledgerSequences.has(sequenceKey)) throw new Error(`work ledger sequence already exists: ${operation.workspaceId}:${operation.ledgerSequence}`);
    if (operation.kind === "work-instance.created") {
      if (this.#instances.has(operation.workInstanceId)) {
        throw new Error(`work instance already exists: ${operation.workInstanceId}`);
      }
      this.#instances.set(operation.workInstanceId, operation.instance);
    } else {
      const instance = this.#assertExpectedVersion(operation);
      this.#assertParticipant(instance, operation.actorPrincipalId);
      switch (operation.kind) {
        case "work-episode.started":
          this.#applyEpisode(instance, operation);
          break;
        case "activity.added":
          this.#applyActivity(instance, operation);
          break;
        case "activity.assigned":
          this.#applyAssignment(instance, operation);
          break;
        case "activity.handed-off":
        case "activity.taken-over":
        case "activity.given-back":
        case "activity.suspended":
        case "activity.resumed":
          this.#applyAssignmentChange(instance, operation);
          break;
        case "outcome.recorded":
          this.#applyOutcome(instance, operation);
          break;
      }
    }
    this.#appendActivityEntry(operation);
    this.#operationIds.add(operation.id);
    this.#ledgerSequences.add(sequenceKey);
    this.#lastLedgerSequenceByWorkspace.set(operation.workspaceId, Math.max(this.#lastLedgerSequenceByWorkspace.get(operation.workspaceId) ?? 0, operation.ledgerSequence));
    this.#operations.push(operation);
  }

  #nextLedgerSequence(workspace: WorkspaceId): number {
    return (this.#lastLedgerSequenceByWorkspace.get(workspace) ?? 0) + 1;
  }

  #applyEpisode(instance: WorkInstance, operation: WorkEpisodeStartedOperation): void {
    if (this.#episodes.has(operation.episode.id)) throw new Error(`work episode already exists: ${operation.episode.id}`);
    this.#assertParticipant(instance, operation.episode.startedByPrincipalId);
    assertScope(operation.episode, instance, "work episode");
    this.#episodes.set(operation.episode.id, operation.episode);
    this.#advance(instance, { episodeIds: [...instance.episodeIds, operation.episode.id] });
  }

  #applyActivity(instance: WorkInstance, operation: ActivityAddedOperation): void {
    if (this.#activities.has(operation.activity.id)) throw new Error(`activity already exists: ${operation.activity.id}`);
    this.#assertParticipant(instance, operation.activity.createdByPrincipalId);
    assertScope(operation.activity, instance, "activity");
    const episode = this.#episodes.get(operation.activity.workEpisodeId);
    if (episode === undefined || episode.workInstanceId !== instance.id) {
      throw new Error(`work episode does not belong to work instance: ${operation.activity.workEpisodeId}`);
    }
    this.#activities.set(operation.activity.id, operation.activity);
    this.#advance(instance, { activityIds: [...instance.activityIds, operation.activity.id] });
  }

  #applyAssignment(instance: WorkInstance, operation: ActivityAssignedOperation): void {
    if (this.#assignments.has(operation.assignment.id)) throw new Error(`assignment already exists: ${operation.assignment.id}`);
    assertScope(operation.assignment, instance, "assignment");
    this.#assertParticipantReference(instance, operation.assignment.assignee);
    const activity = this.#activities.get(operation.assignment.activityId);
    if (activity === undefined || activity.workInstanceId !== instance.id) {
      throw new Error(`activity does not belong to work instance: ${operation.assignment.activityId}`);
    }
    this.#activities.set(activity.id, deepFreeze({ ...activity, status: "active" as const }));
    this.#assignments.set(operation.assignment.id, operation.assignment);
    this.#advance(instance, { assignmentIds: [...instance.assignmentIds, operation.assignment.id] });
  }

  #applyAssignmentChange(instance: WorkInstance, operation: AssignmentChangedOperation): void {
    const assignment = this.#assignments.get(operation.assignmentId);
    if (assignment === undefined) throw new Error(`assignment does not exist: ${operation.assignmentId}`);
    assertScope(assignment, instance, "assignment");
    if (
      operation.kind !== "activity.taken-over" &&
      assignment.assignee.principalId !== operation.actorPrincipalId
    ) {
      throw new Error(`only the current assignee can ${operation.kind}`);
    }
    const context = mergeContext(assignment.context, operation.context);
    let assignee = assignment.assignee;
    let previousAssignee = assignment.previousAssignee;
    let status = assignment.status;
    if (operation.kind === "activity.handed-off" || operation.kind === "activity.taken-over") {
      if (operation.to === undefined) throw new Error(`${operation.kind} requires a target participant`);
      this.#assertParticipantReference(instance, operation.to);
      previousAssignee = assignment.assignee;
      assignee = operation.to;
      status = "active";
    } else if (operation.kind === "activity.given-back") {
      if (assignment.previousAssignee === undefined) throw new Error("assignment has no previous assignee");
      assignee = assignment.previousAssignee;
      previousAssignee = assignment.assignee;
      status = "active";
    } else if (operation.kind === "activity.suspended") {
      if (assignment.status !== "active") throw new Error("assignment is already suspended");
      status = "suspended";
    } else {
      if (assignment.status !== "suspended") throw new Error("assignment is not suspended");
      status = "active";
    }
    const transition: AssignmentTransition = deepFreeze({
      kind: transitionKind(operation.kind),
      actorPrincipalId: operation.actorPrincipalId,
      authorizationReference: operation.authorizationReference,
      ...(assignment.assignee.principalId === assignee.principalId ? {} : { from: assignment.assignee }),
      to: assignee,
      context: operation.context,
      transactionTime: operation.transactionTime,
    });
    this.#assignments.set(
      assignment.id,
      deepFreeze({
        ...assignment,
        assignee,
        ...(previousAssignee === undefined ? {} : { previousAssignee }),
        status,
        context,
        transitions: [...assignment.transitions, transition],
      }),
    );
    const activity = this.#activities.get(assignment.activityId) as Activity;
    this.#activities.set(
      activity.id,
      deepFreeze({ ...activity, status: status === "suspended" ? "suspended" as const : "active" as const }),
    );
    this.#advance(instance, {});
  }

  #applyOutcome(instance: WorkInstance, operation: OutcomeRecordedOperation): void {
    if (instance.outcomes.some((outcome) => outcome.id === operation.outcome.id)) {
      throw new Error(`work outcome already exists: ${operation.outcome.id}`);
    }
    this.#assertParticipant(instance, operation.outcome.recordedByPrincipalId);
    this.#advance(instance, { outcomes: [...instance.outcomes, operation.outcome] });
  }

  #advance(
    instance: WorkInstance,
    changes: Partial<Pick<WorkInstance, "episodeIds" | "activityIds" | "assignmentIds" | "outcomes">>,
  ): void {
    this.#instances.set(instance.id, deepFreeze({ ...instance, ...changes, version: instance.version + 1 }));
  }

  #assertExpectedVersion(operation: Exclude<WorkOperation, WorkInstanceCreatedOperation>): WorkInstance {
    const instance = this.#instances.get(operation.workInstanceId);
    if (instance === undefined) throw new Error(`work instance does not exist: ${operation.workInstanceId}`);
    assertWorkspace(instance.workspaceId, operation.workspaceId, "work instance");
    if (operation.expectedVersion !== instance.version) {
      throw new Error(`work version conflict: expected ${operation.expectedVersion}, actual ${instance.version}`);
    }
    return instance;
  }

  #readInstance(workspace: string, id: string): WorkInstance {
    const idValue = workInstanceId(id);
    const instance = this.#instances.get(idValue);
    if (instance === undefined) throw new Error(`work instance does not exist: ${idValue}`);
    assertWorkspace(instance.workspaceId, workspaceId(workspace), "work instance");
    return instance;
  }

  #assertParticipant(instance: WorkInstance, principal: PrincipalId): void {
    assertParticipant(instance.participants, principal);
  }

  #assertParticipantReference(instance: WorkInstance, participant: ParticipantReference): void {
    const registered = instance.participants.find((item) => item.principalId === participant.principalId);
    if (registered === undefined || registered.kind !== participant.kind) {
      throw new Error(`participant is not registered for work instance: ${participant.principalId}`);
    }
  }

  #appendActivityEntry(operation: WorkOperation): void {
    const stream = this.#streams.get(operation.workInstanceId) ?? [];
    const entry: WorkActivityEntry = deepFreeze({
      id: operation.id,
      sequence: stream.length + 1,
      kind: operation.kind,
      workspaceId: operation.workspaceId,
      workInstanceId: operation.workInstanceId,
      actorPrincipalId: operation.actorPrincipalId,
      ...(operation.kind === "work-episode.started"
        ? { workEpisodeId: operation.episode.id }
        : operation.kind === "activity.added"
          ? { workEpisodeId: operation.activity.workEpisodeId, activityId: operation.activity.id }
          : operation.kind === "activity.assigned"
            ? { activityId: operation.assignment.activityId, assignmentId: operation.assignment.id }
            : "assignmentId" in operation
              ? { assignmentId: operation.assignmentId }
              : {}),
      transactionTime: operation.transactionTime,
    });
    stream.push(entry);
    this.#streams.set(operation.workInstanceId, stream);
  }
}

interface TransitionInput {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly workInstanceId: string;
  readonly assignmentId: string;
  readonly expectedVersion: number;
  readonly actorPrincipalId: string;
  readonly authorizationReference: string;
  readonly context: Readonly<Record<string, WorkValue>>;
  readonly recordedAt: string;
}

function validateOperation(operation: WorkOperation): void {
  operationId(operation.id);
  if (!Number.isSafeInteger(operation.ledgerSequence) || operation.ledgerSequence < 1) throw new TypeError("work ledgerSequence must be a positive safe integer");
  workspaceId(operation.workspaceId);
  workInstanceId(operation.workInstanceId);
  principalId(operation.actorPrincipalId);
  normalizeInstant(operation.transactionTime.from);
  if (operation.kind !== "work-instance.created") version(operation.expectedVersion);
}

function normalizeParticipants(values: readonly Principal[]): readonly ParticipantReference[] {
  if (values.length === 0) throw new TypeError("work participants must not be empty");
  const participants = values.map(normalizeParticipant).sort((left, right) => left.principalId.localeCompare(right.principalId));
  if (new Set(participants.map((participant) => participant.principalId)).size !== participants.length) {
    throw new Error("work participants must not contain duplicate principals");
  }
  return deepFreeze(participants);
}

function normalizeParticipant(value: Principal): ParticipantReference {
  return deepFreeze({ principalId: principalId(value.id), kind: principalKind(value.kind) });
}

function normalizeRoles(
  input: { readonly workOwners: readonly string[]; readonly decisionAuthorities: readonly string[]; readonly reviewers: readonly string[]; readonly approvers: readonly string[] },
  participants: readonly ParticipantReference[],
): WorkRoleBindings {
  const roles = deepFreeze({
    workOwners: principalIds("work owners", input.workOwners),
    decisionAuthorities: principalIds("decision authorities", input.decisionAuthorities),
    reviewers: principalIds("reviewers", input.reviewers),
    approvers: principalIds("approvers", input.approvers),
  });
  if (roles.workOwners.length === 0 || roles.decisionAuthorities.length === 0) {
    throw new TypeError("work owners and decision authorities must not be empty");
  }
  for (const id of Object.values(roles).flat()) assertParticipant(participants, id);
  return roles;
}

function principalIds(name: string, values: readonly string[]): readonly PrincipalId[] {
  const ids = values.map(principalId);
  if (new Set(ids).size !== ids.length) throw new Error(`${name} must not contain duplicates`);
  return Object.freeze(ids.sort());
}

function assertParticipant(values: readonly ParticipantReference[], id: PrincipalId): void {
  if (!values.some((participant) => participant.principalId === id)) {
    throw new Error(`principal is not a work participant: ${id}`);
  }
}

function assertScope(
  value: { readonly workspaceId: WorkspaceId; readonly workInstanceId: WorkInstanceId },
  instance: WorkInstance,
  name: string,
): void {
  assertWorkspace(value.workspaceId, instance.workspaceId, name);
  if (value.workInstanceId !== instance.id) throw new Error(`${name} belongs to another work instance`);
}

function assertWorkspace(actual: WorkspaceId, expected: WorkspaceId, name: string): void {
  if (actual !== expected) throw new Error(`${name} is outside workspace: ${expected}`);
}

function transitionKind(kind: AssignmentChangedOperation["kind"]): AssignmentTransition["kind"] {
  return {
    "activity.handed-off": "handed-off",
    "activity.taken-over": "taken-over",
    "activity.given-back": "given-back",
    "activity.suspended": "suspended",
    "activity.resumed": "resumed",
  }[kind] as AssignmentTransition["kind"];
}

function mergeContext(
  current: Readonly<Record<string, WorkValue>>,
  update: Readonly<Record<string, WorkValue>>,
): Readonly<Record<string, WorkValue>> {
  return deepFreeze({ ...structuredClone(current), ...structuredClone(update) });
}

function cloneContext(value: Readonly<Record<string, WorkValue>>): Readonly<Record<string, WorkValue>> {
  return deepFreeze(structuredClone(value));
}

function compareOperations(left: WorkOperation, right: WorkOperation): number {
  return left.workspaceId.localeCompare(right.workspaceId) || left.ledgerSequence - right.ledgerSequence;
}

function workInstanceId(value: string): WorkInstanceId {
  return prefixedId("work instance id", value, "work-instance:") as WorkInstanceId;
}
function workEpisodeId(value: string): WorkEpisodeId {
  return prefixedId("work episode id", value, "work-episode:") as WorkEpisodeId;
}
function activityId(value: string): ActivityId {
  return prefixedId("activity id", value, "activity:") as ActivityId;
}
function assignmentId(value: string): AssignmentId {
  return prefixedId("assignment id", value, "assignment:") as AssignmentId;
}
function workOutcomeId(value: string): WorkOutcomeId {
  return prefixedId("work outcome id", value, "work-outcome:") as WorkOutcomeId;
}
function operationId(value: string): WorkOperationId {
  return prefixedId("work operation id", value, "work-operation:") as WorkOperationId;
}
function workspaceId(value: string): WorkspaceId {
  return prefixedId("workspace id", value, "workspace:") as WorkspaceId;
}
function principalId(value: string): PrincipalId {
  return prefixedId("principal id", value, "principal:") as PrincipalId;
}

function prefixedId(name: string, value: string, prefix: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${name} must start with ${prefix}`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(normalized.slice(prefix.length))) {
    throw new TypeError(`${name} must contain an opaque namespace-qualified identifier`);
  }
  return normalized;
}

function namespaced(name: string, value: string): string {
  const normalized = requiredText(name, value);
  if (!normalized.includes(":")) throw new TypeError(`${name} must be namespace-qualified`);
  return normalized;
}

function principalKind(value: PrincipalKind): PrincipalKind {
  const kinds: readonly PrincipalKind[] = ["human", "agent", "service", "automation"];
  if (!kinds.includes(value)) throw new TypeError(`unsupported principal kind: ${String(value)}`);
  return value;
}

function version(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("expected version must be a positive integer");
  return value;
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`timestamp requires an explicit UTC offset: ${value}`);
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
