import type { StateValue } from "../../core/src/index.ts";

type RawSpan = readonly [number, number];

export interface RawDecomposition {
  readonly claims: readonly {
    readonly localId: string;
    readonly subject: string;
    readonly predicate: string;
    readonly object: StateValue;
    readonly span: RawSpan;
  }[];
  readonly events: readonly {
    readonly localId: string;
    readonly eventType: string;
    readonly participants: readonly string[];
    readonly span: RawSpan;
  }[];
  readonly relationships: readonly {
    readonly localId: string;
    readonly type: string;
    readonly from: string;
    readonly to: string;
    readonly span: RawSpan;
  }[];
  readonly evidence: readonly { readonly localId: string; readonly span: RawSpan }[];
  readonly identities: readonly {
    readonly mention: string;
    readonly candidates: readonly { readonly entityId: string; readonly score: number }[];
    readonly span: RawSpan;
  }[];
}

export interface SourceSpan {
  readonly artifactId: string;
  readonly start: number;
  readonly end: number;
}

export interface SemanticCompilation {
  readonly observationId: string;
  readonly claims: readonly {
    readonly id: string;
    readonly subject: string;
    readonly predicate: string;
    readonly object: StateValue;
    readonly lifecycle: "provisional";
    readonly sourceSpan: SourceSpan;
  }[];
  readonly events: readonly {
    readonly id: string;
    readonly eventType: string;
    readonly participants: readonly string[];
    readonly lifecycle: "provisional";
    readonly sourceSpan: SourceSpan;
  }[];
  readonly relationships: readonly {
    readonly id: string;
    readonly type: string;
    readonly from: string;
    readonly to: string;
    readonly lifecycle: "provisional";
    readonly sourceSpan: SourceSpan;
  }[];
  readonly evidence: readonly {
    readonly id: string;
    readonly locator: string;
    readonly lifecycle: "provisional";
    readonly sourceSpan: SourceSpan;
  }[];
  readonly identityCandidates: readonly {
    readonly mention: string;
    readonly candidates: readonly { readonly entityId: string; readonly score: number }[];
    readonly status: "provisional";
    readonly sourceSpan: SourceSpan;
  }[];
  readonly transactionTime: { readonly from: string };
}

export interface SemanticCompilerPorts {
  readonly decompose: (input: {
    readonly observationId: string;
    readonly sourceArtifactId: string;
    readonly text: string;
  }) => Promise<RawDecomposition>;
  readonly proposeStateWrite?: (proposal: unknown) => void;
}

export class SemanticCompiler {
  readonly #decompose: SemanticCompilerPorts["decompose"];

  constructor(ports: SemanticCompilerPorts) {
    this.#decompose = ports.decompose;
  }

  async compile(input: {
    readonly id: string;
    readonly sourceArtifactId: string;
    readonly text: string;
    readonly recordedAt: string;
  }): Promise<SemanticCompilation> {
    const observationId = prefixed("observation id", input.id, "observation:");
    const artifactId = prefixed("source artifact id", input.sourceArtifactId, "artifact:");
    const text = requiredText("observation text", input.text);
    const raw = await this.#decompose({ observationId, sourceArtifactId: artifactId, text });
    const span = (value: RawSpan): SourceSpan => sourceSpan(artifactId, text, value);
    return deepFreeze({
      observationId,
      claims: raw.claims.map((item) => ({
        id: localId("claim", item.localId),
        subject: requiredText("claim subject", item.subject),
        predicate: namespaced("claim predicate", item.predicate),
        object: item.object,
        lifecycle: "provisional" as const,
        sourceSpan: span(item.span),
      })),
      events: raw.events.map((item) => ({
        id: localId("event", item.localId),
        eventType: namespaced("event type", item.eventType),
        participants: item.participants.map((participant) => requiredText("event participant", participant)),
        lifecycle: "provisional" as const,
        sourceSpan: span(item.span),
      })),
      relationships: raw.relationships.map((item) => ({
        id: localId("relationship", item.localId),
        type: namespaced("relationship type", item.type),
        from: requiredText("relationship from", item.from),
        to: requiredText("relationship to", item.to),
        lifecycle: "provisional" as const,
        sourceSpan: span(item.span),
      })),
      evidence: raw.evidence.map((item) => {
        const source = span(item.span);
        return {
          id: localId("evidence", item.localId),
          locator: `span://${source.artifactId}#${source.start}-${source.end}`,
          lifecycle: "provisional" as const,
          sourceSpan: source,
        };
      }),
      identityCandidates: raw.identities.map((item) => ({
        mention: requiredText("identity mention", item.mention),
        candidates: item.candidates.map((candidate) => {
          if (candidate.score < 0 || candidate.score > 1) throw new RangeError("identity score must be between 0 and 1");
          return { entityId: prefixed("entity id", candidate.entityId, "entity:"), score: candidate.score };
        }),
        status: "provisional" as const,
        sourceSpan: span(item.span),
      })),
      transactionTime: { from: normalizeInstant(input.recordedAt) },
    });
  }
}

function sourceSpan(artifactId: string, text: string, value: RawSpan): SourceSpan {
  const [start, end] = value;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
    throw new RangeError(`source span ${start}-${end} is outside the observation text`);
  }
  return { artifactId, start, end };
}
function localId(kind: string, value: string): string {
  const normalized = requiredText(`${kind} local id`, value);
  return normalized.startsWith(`${kind}:`) ? normalized : `${kind}:proposal:${normalized}`;
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
