import {
  ContextGateway, type ContextGatewayPorts, type EpisodeContextRequest,
} from "../../packages/context-gateway/src/index.ts";
import type { PostgresEpisodeKnowledgeJournal } from "./index.ts";

/**
 * Bind a ContextGateway to a single authenticated episode request.
 * The caller supplies independently trusted, synchronous per-record read/write
 * evaluators. Missing evaluators default-deny in the constitutional gateway.
 */
export function createEpisodeKnowledgeGateway(input: {
  readonly journal: PostgresEpisodeKnowledgeJournal;
  readonly request: EpisodeContextRequest;
  readonly capabilitySource?: ContextGatewayPorts["capabilitySource"];
  readonly evaluateApplicability?: ContextGatewayPorts["evaluateApplicability"];
  readonly evaluateRead?: ContextGatewayPorts["evaluateRead"];
  readonly evaluateWrite?: ContextGatewayPorts["evaluateWrite"];
}): Pick<ContextGateway, "buildEpisodeCapabilityContext"
  | "reconstructAgentKnowledgeWorkspace" | "writeContextSegment"> {
  const bound = input.request;
  const assertBound = (request: EpisodeContextRequest): void => {
    if (request.principalId !== bound.principalId
      || request.workspaceId !== bound.workspaceId
      || request.workInstanceId !== bound.workInstanceId
      || request.workEpisodeId !== bound.workEpisodeId
      || request.purpose !== bound.purpose
      || Date.parse(request.validAt) !== Date.parse(bound.validAt)
      || Date.parse(request.transactionAt) !== Date.parse(bound.transactionAt)) {
      throw new Error("episode context request does not match bound authenticated principal and episode");
    }
  };
  const inner = new ContextGateway({
    capabilitySource: input.capabilitySource ?? { query: async () => [] },
    knowledgeSource: {
      query: async request => {
        assertBound(request);
        return input.journal.query({ actorPrincipalId: bound.principalId, request });
      },
      append: async segment => {
        if (segment.workspaceId !== bound.workspaceId
          || segment.workInstanceId !== bound.workInstanceId
          || segment.workEpisodeId !== bound.workEpisodeId) {
          throw new Error("episode knowledge append outside bound scope");
        }
        await input.journal.propose({
          actorPrincipalId: bound.principalId,
          segment,
          rationale: segment.authorityFilter.rationale,
        });
      },
    },
    evaluateApplicability: input.evaluateApplicability,
    evaluateRead: input.evaluateRead,
    evaluateWrite: input.evaluateWrite,
  });
  return {
    buildEpisodeCapabilityContext: async request => {
      assertBound(request);
      return inner.buildEpisodeCapabilityContext(request);
    },
    reconstructAgentKnowledgeWorkspace: async request => {
      assertBound(request);
      return inner.reconstructAgentKnowledgeWorkspace(request);
    },
    writeContextSegment: async input => {
      assertBound(input.request);
      return inner.writeContextSegment(input);
    },
  };
}
