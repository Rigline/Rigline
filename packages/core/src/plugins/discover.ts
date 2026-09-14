/**
 * Plugin discovery, manifest reading and registry baking (D12, D14).
 *
 * Discovery runs in Node at install time, never in the webview: the webview's CSP has no
 * `connect-src`, so the post hook can neither fetch a `rigline.json` nor list a directory to find
 * one by. A manifest is read here as data, through `validateManifest`, and the plugin's own module
 * is never imported — module evaluation is exactly where a broken plugin throws, and this code's
 * job is to say what broke, by name, before anything runs.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  readonly manifest: ValidManifest;
}

/** `~/.rigline/config.json`: the one thing a person, not a plugin author, controls at install time. */
export interface PluginsConfig {
  /** Where it was read from, so a report about it can name the file somebody has to edit. */
  readonly path: string;
  readonly disabled: readonly string[];
}

/**
 * Reads and validates `<dir>/rigline.json`. Every shape problem is collected into one throw, and a
 * `name`/directory mismatch or a missing capability is treated the same way as a missing entry
 * file: an authoring mistake, not version skew, so it fails the install loudly rather than being
 * silently dropped.
 */
export function readManifest(dir: string): ValidManifest {
  const manifestPath = join(dir, "rigline.json");
  if (!existsSync(manifestPath)) {
    throw new UserError(`${dir} has no rigline.json`);
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new UserError(`${manifestPath} is not valid JSON: ${(error as Error).message}`);
  }
  const { manifest, problems } = validateManifest(value, basename(dir));
  if (manifest === null) {
    throw new UserError(
      `${manifestPath} is not a valid manifest:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
  const entryPath = join(dir, manifest.entry);
  if (!existsSync(entryPath)) {
    throw new UserError(`${manifestPath} names entry "${manifest.entry}", which does not exist`);
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
  options?: { readonly last?: readonly string[] },
): DiscoveredPlugin[] {
  const found: DiscoveredPlugin[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(root, name, "rigline.json")))
      .sort();
    for (const name of names) {
      const dir = join(root, name);
      found.push({ name, dir, manifest: readManifest(dir) });
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
  if (!existsSync(path)) {
    return { path, disabled: [] };
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new UserError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserError(`${path} must be a JSON object`);
  }
  const disabled = (value as { disabled?: unknown }).disabled ?? [];
  if (!Array.isArray(disabled) || !disabled.every((d) => typeof d === "string")) {
    throw new UserError(`${path}: "disabled" must be an array of strings`);
  }
  return { path, disabled };
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
