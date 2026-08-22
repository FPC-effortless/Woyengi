import assert from "node:assert/strict";
import { test } from "node:test";

import { WoyengiShell, type ShellSnapshot } from "../src/index.ts";

const snapshot: ShellSnapshot = {
  principal: { id: "principal:ada", name: "Ada", initials: "AO" },
  activeWorkspaceId: "workspace:personal-ada",
  workspaces: [
    { id: "workspace:personal-ada", name: "Ada's workspace", kind: "personal" },
    { id: "workspace:atlas", name: "Atlas Studio", kind: "organization" },
  ],
  focus: {
    greeting: "Good morning, Ada",
    summary: "You have three active outcomes and one decision waiting.",
    activeWork: 3,
    waiting: 1,
    completedThisWeek: 7,
  },
  work: [
    { id: "work:launch", title: "Launch the partner portal", status: "In progress", progress: 68, collaborator: "Mira", updated: "12 min ago" },
    { id: "work:research", title: "Map regional policy changes", status: "Waiting", progress: 42, collaborator: "Research agent", updated: "38 min ago" },
  ],
  apps: [
    { id: "app:briefing", name: "Daily briefing", description: "A focused morning view assembled around your active work.", accent: "coral" },
    { id: "app:tracker", name: "Outcome tracker", description: "Shared progress, decisions, and evidence in one place.", accent: "violet" },
  ],
  inbox: [{ id: "inbox:decision", title: "Approve the launch audience", source: "Partner portal", age: "8 min", unread: true }],
};

test("serves the accessible semantic shell while keeping inspection out of default navigation", async () => {
  const app = new WoyengiShell({ loadSnapshot: async (workspaceId) => workspaceId === "workspace:atlas" ? { ...snapshot, activeWorkspaceId: workspaceId } : snapshot });
  const server = await app.listen({ hostname: "127.0.0.1", port: 0 });

  try {
    const page = await fetch(server.url);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /<main[^>]+id="main-content"/);
    assert.match(html, /aria-label="Primary"/);
    assert.match(html, />Home<.*>Work<.*>Apps<.*>Inbox<.*>Search</s);
    assert.match(html, /id="workspace-switcher"/);
    assert.match(html, /aria-label="Ask, create, or delegate"/);
    assert.match(html, /Ask.*Create.*Delegate/s);
    assert.match(html, /data-composer-preview/);
    assert.match(html, /data-inspect-panel[^>]+hidden/);

    const defaultNavigation = html.match(/<nav aria-label="Primary"[\s\S]*?<\/nav>/)?.[0] ?? "";
    assert.doesNotMatch(defaultNavigation, /Claims|Provenance|Authority|Lifecycle|Conflicts|Graph/i);

    const response = await fetch(`${server.url}/api/shell?workspace=workspace%3Aatlas`);
    assert.equal(response.status, 200);
    const body = await response.json() as { data: ShellSnapshot };
    assert.equal(body.data.activeWorkspaceId, "workspace:atlas");
    assert.equal(Object.isFrozen(body.data), false, "wire responses remain ordinary JSON values");
  } finally {
    await server.close();
  }
});

test("rejects malformed workspace identifiers before loading shell state", async () => {
  let calls = 0;
  const app = new WoyengiShell({ loadSnapshot: async () => { calls += 1; return snapshot; } });
  const server = await app.listen({ hostname: "127.0.0.1", port: 0 });

  try {
    const response = await fetch(`${server.url}/api/shell?workspace=atlas`);
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});
