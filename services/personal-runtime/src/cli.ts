import { join, resolve } from "node:path";

import { readApplicationPackage } from "../../../packages/apps/src/index.ts";
import { runCli, type CliIo } from "../../../packages/cli/src/index.ts";
import { openPersonalRuntime, seedPersonalRuntime } from "./index.ts";

/**
 * Service-level composition root for the public "woyengi" command. Platform
 * packages must not import this service; they stay usable by other runtimes.
 */
export async function runWoyengiCli(
  args: readonly string[],
  io: CliIo = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  if (args[0] !== "start") return runCli(args, io);

  try {
    const options = startupOptions(args.slice(1));
    const localStateDirectory = resolve(requiredOption(options, "workspace"));
    const startedAt = new Date().toISOString();

    if (!options.has("package")) {
      if (options.has("owner") || options.has("platform-version")) {
        throw new Error("--owner and --platform-version require --package when seeding a Personal Workspace");
      }
      // Reopen only. Missing or corrupted persisted state must fail closed.
      const reopened = await openPersonalRuntime({ localStateDirectory, startedAt });
      emitStart(io, reopened);
      return 0;
    }

    const owner = options.get("owner") ?? "local";
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i.test(owner)) {
      throw new Error("owner must be a 1-64 character alphanumeric/hyphen slug");
    }
    const applicationPackageDirectory = resolve(requiredOption(options, "package"));
    const applicationPackage = await readApplicationPackage(join(applicationPackageDirectory, "application-package.json"));
    const principalId = `principal:${owner}`;
    const seeded = await seedPersonalRuntime({
      localStateDirectory,
      applicationPackageDirectory,
      platformApiVersion: options.get("platform-version") ?? "1.0.0",
      startedAt,
      owner: {
        principalId,
        accountId: `account:${owner}`,
        workspaceId: `workspace:${owner}`,
      },
      installation: {
        instanceId: `application-instance:${applicationPackage.id.slice("application-package:".length)}`,
        semanticObjectBindings: {},
        roleBindings: { owner: principalId },
        participantBindings: { owner: principalId },
        integrationBindings: {},
        surfaceConfiguration: {},
        configuration: {},
      },
    });
    emitStart(io, seeded);
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function startupOptions(args: readonly string[]): ReadonlyMap<string, string> {
  const permitted = new Set(["workspace", "package", "owner", "platform-version"]);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (key === undefined || !key.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`invalid start command option near: ${key ?? "<end>"}`);
    }
    const name = key.slice(2);
    if (!permitted.has(name)) throw new Error(`unsupported start command option: ${key}`);
    if (options.has(name)) throw new Error(`duplicate start command option: ${key}`);
    options.set(name, value);
  }
  return options;
}

function requiredOption(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name)?.trim();
  if (value === undefined || value.length === 0) throw new Error(`missing required option: --${name}`);
  return value;
}

function emitStart(io: CliIo, session: Awaited<ReturnType<typeof openPersonalRuntime>>): void {
  io.stdout(`${JSON.stringify({
    command: "start",
    mode: session.evidence.mode,
    workspaceId: session.workspace.id,
    applicationId: session.application.id,
    packageId: session.application.packageId,
    evidence: session.evidence,
  })}\n`);
}
