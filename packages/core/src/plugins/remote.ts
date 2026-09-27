/**
 * Plugins from npm: `add <spec>`, and the plugin half of `update` (D47, D48, D49, D106).
 *
 * Everything here is about the container — resolving a version, the release-age gate, the integrity
 * hash, the tar reader's refusals — and the content is `addPlugin`'s, which checks a staged tarball
 * exactly as it checks a directory somebody pointed at (D70).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { UserError } from "../errors.ts";
import type { NpmSource } from "./config.ts";
import type { PluginListing } from "./list.ts";
import { type AddOptions, type AddResult, addPlugin } from "./manage.ts";
import {
  fetchTarball,
  parsePluginSpec,
  type RegistryOptions,
  type ResolvedVersion,
  releaseAgeProblem,
  resolveVersion,
} from "./npm.ts";
import { readPackageTarball } from "./tarball.ts";

/** Where a fetched plugin goes: `addPlugin`'s options, less what the fetch supplies. */
export type Placement = Omit<AddOptions, "from" | "source" | "now">;

export interface RemoteOptions {
  readonly add: Placement;
  readonly registry?: RegistryOptions;
  readonly now?: () => Date;
}

/**
 * Resolve, fetch, check the bytes, unpack, and add (D47, D48, D49).
 *
 * The order is the point: nothing is staged until the version has cleared the age gate, the bytes
 * have matched their integrity hash, and the archive has been read by a reader that refuses
 * everything but plain files (D57).
 */
export async function addFromNpm(spec: string, options: RemoteOptions): Promise<AddResult> {
  const resolved = await resolveVersion(parsePluginSpec(spec), options.registry);
  const withheld = releaseAgeProblem(resolved, options.registry);
  if (withheld !== null) throw new UserError(withheld);
  return await fetchAndAdd(resolved, options);
}

/** The shared tail of `add <spec>` and one plugin's `update`, which differ only in the age gate. */
async function fetchAndAdd(resolved: ResolvedVersion, options: RemoteOptions): Promise<AddResult> {
  const label = `${resolved.name}@${resolved.version}`;
  const files = readPackageTarball(await fetchTarball(resolved, options.registry), label);

  const staged = mkdtempSync(join(tmpdir(), "rigline-add-"));
  try {
    for (const file of files) {
      const target = join(staged, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.bytes);
    }
    const source: NpmSource = {
      kind: "npm",
      name: resolved.name,
      version: resolved.version,
      tag: resolved.tag,
      integrity: resolved.integrity,
      addedAt: (options.now?.() ?? new Date()).toISOString(),
    };
    return addPlugin({ ...options.add, from: staged, source });
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

export interface UpdatePluginsOptions extends RemoteOptions {
  /** What `list` reports, which is where `sources.json` is read (D74). */
  readonly listed: readonly PluginListing[];
  /** Only these plugins. Absent means every one `add` installed. */
  readonly names?: readonly string[];
  /** Each plugin as it is placed, for the report `add` prints. */
  readonly onAdded?: (result: AddResult) => void;
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
  const managed = options.listed.filter((plugin) => plugin.origin === "home");
  const byName = new Map(managed.map((plugin) => [plugin.name, plugin]));
  const names = options.names ?? managed.map((plugin) => plugin.name);
  const updates: PluginUpdate[] = [];

  for (const name of names) {
    const source = byName.get(name)?.source;
    if (source === undefined) {
      updates.push({ name, outcome: "failed", reason: "not installed by rigline" });
    } else if (source === null) {
      updates.push({ name, outcome: "unmanaged" });
    } else if (source.kind === "path") {
      updates.push({ name, outcome: "local", reason: source.from });
    } else if (source.tag === null) {
      updates.push({ name, outcome: "pinned", from: source.version });
    } else {
      updates.push(await updateOne(name, source, options));
    }
  }
  return updates;
}

async function updateOne(
  name: string,
  source: NpmSource,
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
    // `resolved.tag` is the tag being followed, so the new record keeps it — where `add
    // <name>@<version>` records none, which is how a person pins one (D58).
    options.onAdded?.(await fetchAndAdd(resolved, options));
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
