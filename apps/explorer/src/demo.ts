import { ExplorerApp, type ExplorerEntityView } from "./index.ts";

const entity: ExplorerEntityView = {
  entity: { id: "entity:daniel", name: "Daniel Waritimi", type: "Person", lifecycle: "verified" },
  summary: { claims: 12, relationships: 8, conflicts: 1, evidenceCoverage: 92 },
  currentState: [
    { predicate: "project:lead", value: "Project Alpha", authority: "Executive decision", validFrom: "2026-02-10" },
    { predicate: "organization:role", value: "Principal Engineer", authority: "HR system", validFrom: "2025-11-03" },
    { predicate: "contact:timezone", value: "Africa/Lagos", authority: "Self-declared", validFrom: "2025-06-18" },
  ],
  events: [
    { id: "event:meeting-17", title: "Alpha planning meeting", at: "2026-02-10T09:00:00Z", kind: "Meeting" },
    { id: "event:decision-8", title: "Project leadership approved", at: "2026-02-10T09:20:00Z", kind: "Decision" },
  ],
  relationships: [
    { predicate: "LEADS", target: "Project Alpha", targetId: "entity:project-alpha" },
    { predicate: "MEMBER_OF", target: "Platform Group", targetId: "entity:platform-group" },
  ],
  history: [
    { title: "Role changed", detail: "Engineering Lead → Project Alpha Lead", at: "2026-02-10T09:20:00Z" },
    { title: "Claim verified", detail: "Executive decision D8 established authority", at: "2026-02-10T10:04:00Z" },
    { title: "Identity confirmed", detail: "Alias daniel@woyengi resolved", at: "2026-01-22T16:15:00Z" },
  ],
  evidence: [{ id: "evidence:8", label: "Meeting transcript, lines 118–121", status: "supports" }],
  provenance: [{ id: "claim:42", label: "Claim extracted from observation:17", status: "supported" }],
  authority: [{ source: "decision:8", level: 90, basis: "Approved executive decision" }],
  conflicts: [{ id: "conflict:4", label: "Proposal D2 named a previous lead", status: "resolved by D8" }],
  neighborhood: [
    { id: "entity:project-alpha", label: "Project Alpha", relation: "LEADS", graph: "Projects" },
    { id: "event:meeting-17", label: "Alpha planning", relation: "PARTICIPATED_IN", graph: "Meetings" },
  ],
  reconstructions: [{ id: "reconstruction:9", request: "Prepare me for Daniel", status: "complete", objectCount: 42 }],
  trace: [
    { stage: "Intent resolution", detail: "Meeting preparation for a known person", result: "resolved" },
    { stage: "Identity resolution", detail: "Daniel → entity:daniel", result: "selected" },
    { stage: "Graph activation", detail: "People, Meetings, Projects, Decisions", result: "4 graphs" },
    { stage: "Temporal filtering", detail: "Removed 11 outdated objects", result: "31 retained" },
    { stage: "Authority evaluation", detail: "Decision D8 selected over Proposal D2", result: "governing" },
    { stage: "Evidence resolution", detail: "One resolved contradiction retained for transparency", result: "92% covered" },
  ],
};

const app = new ExplorerApp({
  authorize: ({ remoteAddress }) => remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1",
  loadEntity: async (id) => id === entity.entity.id ? entity : undefined,
});
const server = await app.listen({ hostname: process.env.WOYENGI_HOST ?? "127.0.0.1", port: Number(process.env.WOYENGI_PORT ?? 4310) });
process.stdout.write(`Woyengi Explorer listening on ${server.url}\n`);
