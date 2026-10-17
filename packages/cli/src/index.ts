import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { LedgerRecord } from "../../ledger/src/index.ts";
import { LocalCanonicalLedger, sha256 } from "../../storage/src/index.ts";

export interface CliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

interface BackupEntry {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly content: string;
}

interface BackupArchive {
  readonly format: "woyengi-workspace-backup";
  readonly version: 1;
  readonly entries: readonly BackupEntry[];
}

const INSPECTION_KINDS: Readonly<Record<string, readonly string[]>> = {
  provenance: ["provenance", "provenance-node", "provenance-edge"],
  conflicts: ["conflict", "conflict-set"],
  permissions: ["capability", "permission", "permission-decision"],
  reconstructions: ["reconstruction", "reconstruction-trace"],
};

export async function runCli(args: readonly string[], io: CliIo = processIo): Promise<number> {
  try {
    const [command, ...tail] = args;
    if (command === undefined) throw new Error(usage());
    const options = parseOptions(tail);
    switch (command) {
      case "replay":
        await replay(options, io);
        break;
      case "inspect":
        await inspect(options, io);
        break;
      case "migrate":
        await migrate(options, io);
        break;
      case "backup":
        await backup(options, io);
        break;
      case "restore":
        await restore(options, io);
        break;
      case "integrity":
        return await integrity(options, io);
      default:
        throw new Error(`unknown command: ${command}\n${usage()}`);
    }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function replay(options: ReadonlyMap<string, string>, io: CliIo): Promise<void> {
  const workspace = absoluteOption(options, "workspace");
  const until = requiredOption(options, "until");
  const output = absoluteOption(options, "output");
  const ledger = await LocalCanonicalLedger.open(join(workspace, "ledger", "records.json"));
  const records = ledger.query({ until });
  await writeJson(output, { workspace: basename(workspace), until: normalizeInstant(until), records });
  emit(io, { command: "replay", records: records.length, output });
}

async function inspect(options: ReadonlyMap<string, string>, io: CliIo): Promise<void> {
  const workspace = absoluteOption(options, "workspace");
  const view = requiredOption(options, "view");
  const kinds = INSPECTION_KINDS[view];
  if (kinds === undefined) throw new Error(`unsupported inspection view: ${view}`);
  const ledger = await LocalCanonicalLedger.open<LedgerRecord>(join(workspace, "ledger", "records.json"));
  const records = ledger.query({ kinds });
  emit(io, { view, records });
}

async function migrate(options: ReadonlyMap<string, string>, io: CliIo): Promise<void> {
  const workspace = absoluteOption(options, "workspace");
  const target = positiveInteger(requiredOption(options, "to"), "migration target");
  if (target > 2) throw new Error(`unsupported workspace schema version: ${target}`);
  const path = join(workspace, ".woyengi", "workspace.json");
  const metadata = asObject(JSON.parse(await readFile(path, "utf8")), "workspace metadata");
  const current = positiveInteger(metadata.schemaVersion, "current workspace schema version");
  if (target < current) throw new Error("workspace schema downgrades are not supported");
  await writeJson(path, { ...metadata, schemaVersion: target });
  emit(io, { command: "migrate", from: current, to: target });
}

async function backup(options: ReadonlyMap<string, string>, io: CliIo): Promise<void> {
  const workspace = absoluteOption(options, "workspace");
  const output = absoluteOption(options, "output");
  const paths = await listRegularFiles(workspace);
  const entries: BackupEntry[] = [];
  for (const path of paths) {
    const bytes = new Uint8Array(await readFile(path));
    entries.push({
      path: portable(relative(workspace, path)),
      size: bytes.byteLength,
      sha256: sha256(bytes),
      content: Buffer.from(bytes).toString("base64"),
    });
  }
  const archive: BackupArchive = { format: "woyengi-workspace-backup", version: 1, entries };
  await writeJson(output, archive);
  emit(io, { command: "backup", entries: entries.length, output });
}

async function restore(options: ReadonlyMap<string, string>, io: CliIo): Promise<void> {
  const archivePath = absoluteOption(options, "archive");
  const workspace = absoluteOption(options, "workspace");
  if ((await directoryEntries(workspace)).length > 0) throw new Error("restore target must be empty");
  const archive = await readArchive(archivePath);
  validateArchive(archive);
  for (const entry of archive.entries) {
    const output = safeArchiveTarget(workspace, entry.path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, Buffer.from(entry.content, "base64"), { flag: "wx" });
  }
  emit(io, { command: "restore", entries: archive.entries.length, workspace });
}

async function integrity(options: ReadonlyMap<string, string>, io: CliIo): Promise<number> {
  const archive = await readArchive(absoluteOption(options, "archive"));
  try {
    validateArchive(archive);
    emit(io, { valid: true, entries: archive.entries.length });
    return 0;
  } catch (error) {
    emit(io, { valid: false, error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
}

function validateArchive(archive: BackupArchive): void {
  if (archive.format !== "woyengi-workspace-backup" || archive.version !== 1) {
    throw new Error("unsupported backup archive");
  }
  const seen = new Set<string>();
  for (const entry of archive.entries) {
    if (seen.has(entry.path)) throw new Error(`duplicate backup entry: ${entry.path}`);
    seen.add(entry.path);
    safeArchiveTarget(resolve("."), entry.path);
    const bytes = new Uint8Array(Buffer.from(entry.content, "base64"));
    if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256) {
      throw new Error(`backup integrity failure: ${entry.path}`);
    }
  }
}

async function readArchive(path: string): Promise<BackupArchive> {
  const value = asObject(JSON.parse(await readFile(path, "utf8")), "backup archive");
  if (!Array.isArray(value.entries)) throw new Error("backup archive entries must be an array");
  return value as unknown as BackupArchive;
}

async function listRegularFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`workspace backup refuses symbolic link: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`workspace backup refuses non-regular file: ${path}`);
    }
  }
  await visit(root);
  return files.sort((left, right) => portable(relative(root, left)).localeCompare(portable(relative(root, right))));
}

function safeArchiveTarget(root: string, entryPath: string): string {
  if (entryPath.length === 0 || isAbsolute(entryPath) || entryPath.includes("\\")) {
    throw new Error(`unsafe backup entry path: ${entryPath}`);
  }
  const target = resolve(root, entryPath);
  const prefix = `${resolve(root)}${sep}`;
  if (!target.startsWith(prefix)) throw new Error(`unsafe backup entry path: ${entryPath}`);
  return target;
}

async function directoryEntries(path: string): Promise<readonly string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function parseOptions(args: readonly string[]): ReadonlyMap<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined || !key.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`invalid command option near: ${key ?? "<end>"}`);
    }
    if (options.has(key.slice(2))) throw new Error(`duplicate command option: ${key}`);
    options.set(key.slice(2), value);
  }
  return options;
}

function requiredOption(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name)?.trim();
  if (value === undefined || value.length === 0) throw new Error(`missing required option: --${name}`);
  return value;
}

function absoluteOption(options: ReadonlyMap<string, string>, name: string): string {
  return resolve(requiredOption(options, name));
}

function positiveInteger(value: unknown, name: string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) throw new Error(`${name} must be a positive integer`);
  return numeric;
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new Error(`timestamp requires an offset: ${value}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid timestamp: ${value}`);
  return date.toISOString();
}

function portable(path: string): string {
  return path.split(sep).join("/");
}

function emit(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value)}\n`);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function usage(): string {
  return "usage: woyengi <replay|inspect|migrate|backup|restore|integrity> [options]";
}

const processIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};
