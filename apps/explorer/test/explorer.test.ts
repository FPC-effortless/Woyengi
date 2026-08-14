import assert from "node:assert/strict";
import { test } from "node:test";

import { ExplorerApp, type ExplorerEntityView } from "../src/index.ts";

const view: ExplorerEntityView = {
  entity: { id: "entity:daniel", name: "Daniel Waritimi", type: "Person", lifecycle: "verified" },
  summary: { claims: 12, relationships: 8, conflicts: 1, evidenceCoverage: 92 },
  currentState: [{ predicate: "project:lead", value: "Project Alpha", authority: "Executive decision", validFrom: "2026-02-10" }],
  events: [{ id: "event:meeting-17", title: "Alpha planning meeting", at: "2026-02-10T09:00:00Z", kind: "Meeting" }],
  relationships: [{ predicate: "LEADS", target: "Project Alpha", targetId: "entity:project-alpha" }],
  history: [{ title: "Role changed", detail: "Engineering Lead → Project Alpha Lead", at: "2026-02-10T09:20:00Z" }],
  evidence: [{ id: "evidence:8", label: "Meeting transcript, lines 118–121", status: "supports" }],
  provenance: [{ id: "claim:42", label: "Claim extracted from observation:17", status: "supported" }],
  authority: [{ source: "decision:8", level: 90, basis: "Approved executive decision" }],
  conflicts: [{ id: "conflict:4", label: "Previous project lead", status: "resolved" }],
  neighborhood: [{ id: "entity:project-alpha", label: "Project Alpha", relation: "LEADS", graph: "Projects" }],
  reconstructions: [{ id: "reconstruction:9", request: "Prepare me for Daniel", status: "complete", objectCount: 42 }],
  trace: [
    { stage: "Identity resolution", detail: "Daniel → entity:daniel", result: "selected" },
    { stage: "Graph activation", detail: "People, Meetings, Projects, Decisions", result: "4 graphs" },
    { stage: "Authority evaluation", detail: "Decision D8 selected over Proposal D2", result: "governing" },
  ],
};

test("serves an accessible Explorer shell and complete entity inspection data", async () => {
  const app = new ExplorerApp({ authorize: ({ authorization }) => authorization === "Bearer test", loadEntity: async (id) => id === view.entity.id ? view : undefined });
  const server = await app.listen({ hostname: "127.0.0.1", port: 0 });
  try {
    const page = await fetch(server.url);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /<main/);
    assert.match(html, /aria-label="Search state"/);
    assert.match(html, /data-theme-toggle/);
    assert.match(html, /Claims.*Events.*Relationships.*History.*Evidence.*Provenance.*Authority.*Lifecycle.*Conflicts.*Graph.*Reconstruction/s);

    assert.equal((await fetch(`${server.url}/api/entities/entity%3Adaniel`)).status, 401);
    const response = await fetch(`${server.url}/api/entities/entity%3Adaniel`, { headers: { authorization: "Bearer test" } });
    assert.equal(response.status, 200);
    const body = await response.json() as { data: ExplorerEntityView };
    assert.deepEqual(body.data, view);

    const missing = await fetch(`${server.url}/api/entities/entity%3Amissing`, { headers: { authorization: "Bearer test" } });
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});
