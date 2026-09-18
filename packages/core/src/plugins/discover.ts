/**
 * Plugin discovery, manifest reading and registry baking (D12, D14).
 *
 * Discovery runs in Node at install time, never in the webview: the webview's CSP has no
 * `connect-src`, so the post hook can neither fetch a `rigline.json` nor list a directory to find
 * one by. A manifest is read here as data, through `validateManifest`, and the plugin's own module
 * is never imported — module evaluation is exactly where a broken plugin throws, and this code's
 * job is to say what broke, by name, before anything runs.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  capabilityDrift,
  capabilityUse,
  type Uses,
  type ValidManifest,
  validateManifest,
} from "@rigline/plugin-api";
import { UserError } from "../errors.ts";
import { type DeclaredPatch, type PatchOutcome, patchRefusal } from "../inject/hostpatch.ts";

/** One plugin found on disk, its manifest already validated. */
export interface DiscoveredPlugin {
  readonly name: string;
  readonly dir: string;
  /**
   * The root it was discovered under, which is the only thing that distinguishes a plugin of your
   * own from one somebody installed. Discovery flattens its roots into one ordered list, so without
   * this the origin is gone by the time anything reports on the result.
   */
  readonly root: string;
  readonly manifest: ValidManifest;
}

/**
 * Where a plugin came from, recorded by `add` (D49).
 *
 * A discriminated union from its first member, so that the npm source and the git source deferred
 * in D33 arrive as adapters rather than as a migration of everything already written. A plugin
 * somebody put in `~/.rigline/plugins/` by hand has no record at all, and that is the honest cost
 * of dropping a directory in: nothing knows where it came from, so nothing can fetch a newer one.
 */
export type PluginSource = PathSource | NpmSource;

export interface PathSource {
  readonly kind: "path";
  /** The directory it was copied from, absolute. `update` does not follow it; `add` again does. */
  readonly from: string;
  /** When, as an ISO instant. The record is for a person reading it as much as for a command. */
  readonly addedAt: string;
}

export interface NpmSource {
  readonly kind: "npm";
  /** The package name, which need not be the plugin's: the manifest owns that. */
  readonly name: string;
  /** Exact, always. There are no ranges (D58). */
  readonly version: string;
  /** The dist-tag `update` follows, or null when a person named a version and so pinned it. */
  readonly tag: string | null;
  /** What the bytes hashed to, as SRI, checked again on every fetch (D49). */
  readonly integrity: string;
  readonly addedAt: string;
}

/** `~/.rigline/config.json`: the one thing a person, not a plugin author, controls at install time. */
export interface PluginsConfig {
  /** Where it was read from, so a report about it can name the file somebody has to edit. */
  readonly path: string;
  readonly disabled: readonly string[];
  /** What `add` brought in, by plugin name. A plugin placed by hand is absent rather than null. */
  readonly sources: Readonly<Record<string, PluginSource>>;
}

/**
 * Reads and validates `<dir>/rigline.json`. Every shape problem is collected into one throw, and a
 * `name`/directory mismatch or a missing capability is treated the same way as a missing entry
 * file: an authoring mistake, not version skew, so it fails the install loudly rather than being
 * silently dropped.
 *
 * `expectedName` is the directory's own name everywhere a plugin is discovered, which is what makes
 * a directory's name and its plugin's name the same fact. `add` passes the manifest's own name
 * instead: it is reading a source directory that has not been renamed to match yet, and the copy it
 * is about to make is what settles the two together.
 */
export function readManifest(dir: string, expectedName: string = basename(dir)): ValidManifest {
  const manifestPath = join(dir, "rigline.json");
  if (!existsSync(manifestPath)) {
    throw new UserError(`${dir} has no rigline.json`);
  }
  return checkManifest({
    json: readFileSync(manifestPath, "utf8"),
    expectedName,
    label: manifestPath,
    hasFile: (path) => existsSync(join(dir, path)),
  });
}

export interface ManifestCheck {
  /** The text of `rigline.json`. */
  readonly json: string;
  /** The name it must call itself: a directory's, or its own where `add` has not placed it yet. */
  readonly expectedName: string;
  /** What to name in a refusal: a path, or a package and version. */
  readonly label: string;
  /** Whether the plugin carries this file, relative to its own directory. */
  readonly hasFile: (path: string) => boolean;
}

/**
 * One manifest, validated as data (D12).
 *
 * Shared by the directory `readManifest` reads and the tarball `add` unpacks in memory, so that a
 * plugin fetched from a registry is held to exactly the rules one discovered on disk is — and so
 * that a tarball whose manifest does not hold up is refused before a byte of it is written.
 */
export function checkManifest(check: ManifestCheck): ValidManifest {
  let value: unknown;
  try {
    value = JSON.parse(check.json);
  } catch (error) {
    throw new UserError(`${check.label} is not valid JSON: ${(error as Error).message}`);
  }
  const { manifest, problems } = validateManifest(value, check.expectedName);
  if (manifest === null) {
    throw new UserError(
      `${check.label} is not a valid manifest:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
  if (!check.hasFile(manifest.entry)) {
    throw new UserError(`${check.label} names entry "${manifest.entry}", which does not exist`);
  }
  return manifest;
}

/**
 * Every plugin discoverable under `roots`: each root's immediate subdirectories that contain a
 * `rigline.json`, sorted by name, roots taken in the order given. A root that does not exist yields
 * nothing rather than throwing, since a fresh checkout with no first-party plugins yet is a normal
 * state. `last` moves the named plugins to the end, in the order given, regardless of which root
 * found them — the probe plugin wants to run after everything a person installed.
 */
export function discoverPlugins(
  roots: readonly string[],
  options?: { readonly last?: readonly string[]; readonly log?: (line: string) => void },
): DiscoveredPlugin[] {
  const log = options?.log ?? (() => {});
  const found: DiscoveredPlugin[] = [];
  const seen = new Map<string, string>();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(root, name, "rigline.json")))
      .sort();
    for (const name of names) {
      const dir = join(root, name);
      const already = seen.get(name);
      if (already !== undefined) {
        // One name, one plugin (D56). Two of a name baked two registry entries, copied over each
        // other into the payload, and loaded the plugin twice. First root wins, because the root
        // order is the caller's and is already load order; the loser is named, because a plugin
        // missing from the panel with nothing said about it is the failure P8 refuses.
        log(`${dir} is shadowed by ${already}: a plugin called "${name}" is already discovered`);
        continue;
      }
      seen.set(name, dir);
      found.push({ name, dir, root, manifest: readManifest(dir) });
    }
  }

  const last = options?.last ?? [];
  if (last.length === 0) return found;
  const lastSet = new Set(last);
  const ordered = found.filter((p) => !lastSet.has(p.name));
  for (const name of last) {
    const plugin = found.find((p) => p.name === name);
    if (plugin) ordered.push(plugin);
  }
  return ordered;
}

/** `~/.rigline/config.json`. Absent means nothing is disabled; malformed is a person's mistake, loud. */
export function readConfig(path: string): PluginsConfig {
  const value = readConfigJson(path);
  if (value === null) return { path, disabled: [], sources: {} };

  const disabled = value.disabled ?? [];
  if (!Array.isArray(disabled) || !disabled.every((d) => typeof d === "string")) {
    throw new UserError(`${path}: "disabled" must be an array of strings`);
  }
  const rawSources = value.sources ?? {};
  if (typeof rawSources !== "object" || rawSources === null || Array.isArray(rawSources)) {
    throw new UserError(`${path}: "sources" must be an object of plugin name to source`);
  }
  const sources: Record<string, PluginSource> = {};
  for (const [name, source] of Object.entries(rawSources)) {
    // Unreadable rather than absent, which is a distinction worth keeping: a record nothing can
    // parse is a file somebody edited, and dropping it silently would turn a plugin `add` brought
    // in into one that looks hand-placed and so cannot be upgraded (D49).
    if (!isPluginSource(source)) {
      throw new UserError(`${path}: the source recorded for "${name}" is not one this can read`);
    }
    sources[name] = source;
  }
  return { path, disabled, sources };
}

/**
 * `config.json` with `mutate` applied, written back with every key this does not know about left
 * exactly as it was.
 *
 * A read-modify-write over the raw JSON rather than a render of `PluginsConfig`, because this file
 * belongs to the user: per-plugin settings are a thing it will hold one day, a person may have put
 * something of their own in it, and a command that rewrites it from a narrowed view would delete
 * both the first time it ran.
 */
export function updateConfig(
  path: string,
  mutate: (config: Record<string, unknown>) => void,
): void {
  const value = readConfigJson(path) ?? {};
  mutate(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** The file as raw JSON, or null when it is not there. Throws for anything that is not an object. */
function readConfigJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new UserError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserError(`${path} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function isPluginSource(value: unknown): value is PluginSource {
  // Read as a bag of unknowns rather than as a partial of the union: the two members disagree about
  // `kind`, so their intersection has no value for it and every field reads as never.
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  if (typeof source.addedAt !== "string") return false;
  if (source.kind === "path") return typeof source.from === "string";
  if (source.kind === "npm") {
    return (
      typeof source.name === "string" &&
      typeof source.version === "string" &&
      typeof source.integrity === "string" &&
      (source.tag === null || typeof source.tag === "string")
    );
  }
  return false;
}

/** Where a plugin came from, as one phrase a report can put after "added from". */
export function describeSource(source: PluginSource): string {
  return source.kind === "path"
    ? source.from
    : `${source.name}@${source.version} on npm` +
        (source.tag === null ? ", pinned" : `, following ${source.tag}`);
}

/**
 * `discovered` with every name in `config.disabled` removed, preserving discovery order. A name
 * disabled that was never discovered is not an error — the config may be ahead of what is on disk
 * — but it is worth a word, since it usually means a typo or a plugin that was already removed.
 */
export function enabledPlugins(
  discovered: readonly DiscoveredPlugin[],
  config: PluginsConfig,
  log: (line: string) => void = () => {},
): DiscoveredPlugin[] {
  const names = new Set(discovered.map((p) => p.name));
  for (const name of config.disabled) {
    if (!names.has(name)) {
      log(`${config.path} disables "${name}", which was not found among the discovered plugins`);
    }
  }
  const disabled = new Set(config.disabled);
  return discovered.filter((p) => !disabled.has(p.name));
}

/** Every enabled plugin's declared host patches, flattened and named by the plugin that owns each. */
export function declaredPatches(enabled: readonly DiscoveredPlugin[]): DeclaredPatch[] {
  return enabled.flatMap((p) => p.manifest.patches.map((patch) => ({ plugin: p.name, patch })));
}

function normalizeEntry(entry: string): string {
  return entry.replace(/\\/g, "/");
}

/**
 * The ES module the loader imports to learn which plugins are enabled and what happened to their
 * host patches. Registry order is discovery order — the order mounts sharing an anchor appear in
 * and the order rewriters compose in — so it is baked as an array, never a map.
 */
export function bakeRegistry(
  enabled: readonly DiscoveredPlugin[],
  outcomes: readonly PatchOutcome[],
): string {
  const entries = enabled.map((p) =>
    JSON.stringify({
      name: p.name,
      entry: `./plugins/${p.name}/${normalizeEntry(p.manifest.entry)}`,
      surfaces: p.manifest.surfaces,
      uses: p.manifest.uses,
      patchRefusal: patchRefusal(p.name, outcomes),
    }),
  );
  const body = entries.map((e) => `  ${e},`).join("\n");
  return `// Baked by rigline at install time. Do not edit; it is overwritten on every install.
export const plugins = [
${body}
];
export const patches = ${JSON.stringify(outcomes)};
`;
}

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/**
 * Whether `relativePath` — one path segment, or a path relative to a plugin's directory — belongs
 * in the copy a plugin ships. A plugin's shipped output is its whole directory (it may split
 * itself across modules or carry assets, and guessing which files its entry reaches would be a
 * bundler), so exclusion is the only filter: tests, `node_modules`, `.git`, and any dotfile or
 * dot-directory a tool of the author's own left behind.
 */
export function isPluginOutput(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((segment) => segment.length > 0 && segment.startsWith("."))) return false;
  if (segments.includes("node_modules")) return false;
  if (TEST_FILE.test(relativePath)) return false;
  return true;
}

/** Every shipped `.js`/`.mjs` file's text, concatenated, for the advisory capability-use scan. */
function shippedSource(dir: string): string {
  let source = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!isPluginOutput(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      source += shippedSource(full);
    } else if (/\.m?js$/.test(entry.name)) {
      source += readFileSync(full, "utf8");
    }
  }
  return source;
}

/**
 * Where a plugin's manifest and its shipped source disagree about a capability switch, by name.
 * Advisory only (decisions.md, D16): `capabilityUse` is a textual scan and says so in its own
 * doc comment, and acting on it here would put a scanner's blind spots in charge of whether a
 * plugin loads. The manifest stays the contract; this is a line at install time when it looks
 * wrong, in either direction — used without declaring throws and disables the plugin, declared but
 * never used is a stale dependency nothing else would notice.
 */
export function capabilityUseNotes(plugins: readonly DiscoveredPlugin[]): string[] {
  const notes: string[] = [];
  for (const p of plugins) {
    const used = capabilityUse(shippedSource(p.dir));
    for (const note of capabilityDrift(p.manifest.uses as Uses, used)) {
      notes.push(`${p.name}: ${note}`);
    }
  }
  return notes;
}
