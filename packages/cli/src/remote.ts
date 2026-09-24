/**
 * The wrapper's half of `add`, and all of `update`: turning a spec into a directory the engine can
 * take (D69, D70).
 *
 * The wrapper vets the container and the engine vets the content. Everything here is about bytes —
 * resolving a version, the release-age gate, the integrity hash, the tar reader's refusals — and
 * nothing here opens a manifest, places a plugin or writes `sources.json`. What it produces is a
 * staging directory and a source record, both handed to `rigline add <dir> --source <json>`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { UserError } from "./errors.ts";
import {
  fetchTarball,
  parsePluginSpec,
  type RegistryOptions,
  type ResolvedVersion,
  releaseAgeProblem,
  resolveVersion,
} from "./registry.ts";
import { readPackageTarball } from "./tarball.ts";

/** How a staged plugin reaches the engine: the argv the wrapper would have run, and its exit code. */
export type RunEngine = (argv: readonly string[]) => Promise<number>;

/** What `add` recorded, as the engine will read it back (D49). */
export interface NpmSourceRecord {
  readonly kind: "npm";
  readonly name: string;
  readonly version: string;
  readonly tag: string | null;
  readonly integrity: string;
  readonly addedAt: string;
}

export interface AddFromNpmOptions {
  /** `clock`, `clock@1.2.0`, `clock@next`, `@scope/clock` (D58). */
  readonly spec: string;
  readonly engine: RunEngine;
  readonly registry?: RegistryOptions;
  readonly now?: () => Date;
}

/**
 * Resolve, fetch, check the bytes, unpack, and hand the engine a directory (D47, D48, D49).
 *
 * The order is the point: nothing is staged until the version has cleared the age gate, the bytes
 * have matched their integrity hash, and the archive has been read by a reader that refuses
 * everything but plain files (D57). A tarball that fails any of those never reaches the engine.
 */
export async function addFromNpm(options: AddFromNpmOptions): Promise<number> {
  const resolved = await resolveVersion(parsePluginSpec(options.spec), options.registry);
  const withheld = releaseAgeProblem(resolved, options.registry);
  if (withheld !== null) throw new UserError(withheld);
  return await stageAndAdd(resolved, options);
}

/** The shared tail of `add <spec>` and one plugin's `update`, which differ only in the age gate. */
async function stageAndAdd(
  resolved: ResolvedVersion,
  options: {
    readonly engine: RunEngine;
    readonly registry?: RegistryOptions;
    readonly now?: () => Date;
  },
): Promise<number> {
  const label = `${resolved.name}@${resolved.version}`;
  const files = readPackageTarball(await fetchTarball(resolved, options.registry), label);

  const staged = mkdtempSync(join(tmpdir(), "rigline-add-"));
  try {
    for (const file of files) {
      const target = join(staged, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.bytes);
    }
    const source: NpmSourceRecord = {
      kind: "npm",
      name: resolved.name,
      version: resolved.version,
      tag: resolved.tag,
      integrity: resolved.integrity,
      addedAt: (options.now?.() ?? new Date()).toISOString(),
    };
    return await options.engine(["add", staged, "--source", JSON.stringify(source)]);
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

/** What `update` did about one plugin. */
export interface PluginUpdate {
  readonly name: string;
  readonly outcome:
    | "updated"
    | "current"
    | "pinned"
    | "local"
    | "unmanaged"
    | "withheld"
    | "failed";
  /** The version it was on, for an npm source. */
  readonly from?: string;
  /** The version it is on now, or the one that was withheld. */
  readonly to?: string;
  /** Why, where the outcome is not self-explanatory. */
  readonly reason?: string;
}

/**
 * One plugin as `rigline-engine list --json` reports it: the engine owns `sources.json` (D74).
 *
 * Only the fields `update` reads, structurally typed rather than imported, because the wrapper
 * depends on no Rigline package (D69) and this arrives as parsed JSON from another process.
 */
export interface ListedSource {
  readonly kind: string;
  /** A `path` source's directory, and an `npm` source's package, version and tag (D49). */
  readonly from?: string;
  readonly name?: string;
  readonly version?: string;
  readonly tag?: string | null;
}

export interface ListedPlugin {
  readonly name: string;
  readonly managed: boolean;
  readonly source: ListedSource | null;
}

export interface UpdatePluginsOptions {
  readonly listed: readonly ListedPlugin[];
  readonly engine: RunEngine;
  readonly registry?: RegistryOptions;
  /** Only these plugins. Absent means every one the engine listed. */
  readonly names?: readonly string[];
  readonly now?: () => Date;
}

/**
 * Moves every plugin with an npm source to whatever its tag resolves to now (D49, D58).
 *
 * It never stops at the first failure: a registry that is down, or one plugin whose package has
 * been unpublished, must not cost every other plugin its update. Each becomes a line with a reason.
 *
 * It never asks about what the new version declares either (D49); the install-time declaration
 * check still runs afterwards and still refuses a plugin the extension cannot honour (D43).
 */
export async function updatePlugins(options: UpdatePluginsOptions): Promise<PluginUpdate[]> {
  const managed = options.listed.filter((plugin) => plugin.managed);
  const byName = new Map(managed.map((plugin) => [plugin.name, plugin]));
  const names = options.names ?? managed.map((plugin) => plugin.name);
  const updates: PluginUpdate[] = [];

  for (const name of names) {
    const plugin = byName.get(name);
    if (plugin === undefined) {
      updates.push({ name, outcome: "failed", reason: "not installed by rigline" });
      continue;
    }
    const source = plugin.source;
    if (source === null) {
      updates.push({ name, outcome: "unmanaged" });
      continue;
    }
    if (source.kind === "path") {
      updates.push({
        name,
        outcome: "local",
        reason: typeof source.from === "string" ? source.from : "a directory",
      });
      continue;
    }
    if (source.kind !== "npm") {
      updates.push({ name, outcome: "unmanaged", reason: `source kind "${source.kind}"` });
      continue;
    }
    if (source.name === undefined || source.version === undefined) {
      updates.push({ name, outcome: "failed", reason: "its npm source is incomplete" });
      continue;
    }
    if (source.tag === null || source.tag === undefined) {
      updates.push({ name, outcome: "pinned", from: source.version });
      continue;
    }
    updates.push(
      await updateOne(
        name,
        { name: source.name, version: source.version, tag: source.tag },
        options,
      ),
    );
  }
  return updates;
}

async function updateOne(
  name: string,
  source: { readonly name: string; readonly version: string; readonly tag: string },
  options: UpdatePluginsOptions,
): Promise<PluginUpdate> {
  try {
    const resolved = await resolveVersion(
      { name: source.name, version: null, tag: source.tag },
      options.registry,
    );
    if (resolved.version === source.version) {
      return { name, outcome: "current", from: source.version };
    }
    const withheld = releaseAgeProblem(resolved, options.registry);
    if (withheld !== null) {
      return {
        name,
        outcome: "withheld",
        from: source.version,
        to: resolved.version,
        reason: withheld,
      };
    }
    // `resolved.tag` is the tag being followed, so the record the engine writes keeps it — where
    // `add <name>@<version>` records none, which is how a person pins one (D58).
    const code = await stageAndAdd(resolved, options);
    if (code !== 0) {
      return { name, outcome: "failed", from: source.version, reason: `the engine exited ${code}` };
    }
    return { name, outcome: "updated", from: source.version, to: resolved.version };
  } catch (error) {
    return {
      name,
      outcome: "failed",
      from: source.version,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** A plain-text report of one `update` run. */
export function formatUpdates(updates: readonly PluginUpdate[]): string {
  // Not "no plugins are installed": the bundled four always are, and they move with the engine
  // rather than on their own (D71). What is empty here is the set `update` has anything to do about.
  if (updates.length === 0) return "no plugins to update — the bundled ones move with the engine";
  return updates.map(updateLine).join("\n");
}

function updateLine(update: PluginUpdate): string {
  switch (update.outcome) {
    case "updated":
      return `${update.name}: ${update.from} -> ${update.to}`;
    case "current":
      return `${update.name}: ${update.from}, which is what its tag resolves to`;
    case "pinned":
      return `${update.name}: pinned to ${update.from}; add it again to move it`;
    case "local":
      return `${update.name}: added from ${update.reason}; run rigline add again to refresh it`;
    case "unmanaged":
      return `${update.name}: placed by hand, so there is nowhere to fetch a newer one from`;
    case "withheld":
      return `${update.name}: staying on ${update.from} — ${update.reason}`;
    default:
      return `${update.name}: FAILED — ${update.reason}`;
  }
}
