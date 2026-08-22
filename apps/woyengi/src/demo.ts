import { WoyengiShell, type ShellSnapshot } from "./index.ts";

const base: ShellSnapshot = {
  principal: { id: "principal:ada", name: "Ada", initials: "AO" },
  activeWorkspaceId: "workspace:personal-ada",
  workspaces: [
    { id: "workspace:personal-ada", name: "Ada's workspace", kind: "personal" },
    { id: "workspace:atlas", name: "Atlas Studio", kind: "organization" },
  ],
  focus: {
    greeting: "Good morning, Ada",
    summary: "A clear view of what matters, who is helping, and what needs you next.",
    activeWork: 3,
    waiting: 1,
    completedThisWeek: 7,
  },
  work: [
    { id: "work:launch", title: "Launch the partner portal", status: "In progress", progress: 68, collaborator: "Mira", updated: "12 min ago" },
    { id: "work:research", title: "Map regional policy changes", status: "Waiting", progress: 42, collaborator: "Research agent", updated: "38 min ago" },
    { id: "work:brief", title: "Shape the September narrative", status: "Ready", progress: 84, collaborator: "Ada + Nia", updated: "1 hr ago" },
  ],
  apps: [
    { id: "app:briefing", name: "Daily briefing", description: "A focused morning view assembled around your active work.", accent: "coral" },
    { id: "app:tracker", name: "Outcome tracker", description: "Shared progress, decisions, and evidence in one place.", accent: "violet" },
    { id: "app:signals", name: "Signal desk", description: "Changes worth noticing, organized by the work they affect.", accent: "blue" },
  ],
  inbox: [
    { id: "inbox:decision", title: "Approve the launch audience", source: "Partner portal", age: "8 min", unread: true },
    { id: "inbox:review", title: "Mira shared a research synthesis", source: "Regional policy", age: "41 min", unread: true },
  ],
};

const app = new WoyengiShell({
  loadSnapshot: async (workspaceId) => ({ ...base, activeWorkspaceId: workspaceId ?? base.activeWorkspaceId }),
});

const server = await app.listen({ hostname: "127.0.0.1", port: Number(process.env.WOYENGI_SHELL_PORT ?? "4173") });
console.log(`Woyengi shell listening at ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}
