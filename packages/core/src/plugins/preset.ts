/**
 * A layout preset: a shareable file carrying a layout and nothing that changes a machine (D131).
 *
 * The reader refuses rather than carrying forward, which is where this parts company with
 * `readConfig` (D132). A config is a person's own file that a later engine may have written, so an
 * unknown key is named and kept; a preset is a stranger's, with no later engine to defer to, so
 * every doubt is a refusal that writes nothing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, sep } from "node:path";
import {
  type Layout,
  MAX_LAYOUT_ENTRIES,
  MAX_NAME,
  type Placement,
  parsePlace,
  placeElement,
  placementLabel,
  placeName,
  plainText,
  RIGLINE,
  withRigline,
} from "@rigline/plugin-api/internal";
import { Document } from "yaml";
import { writeFileAtomic } from "../atomic.ts";
import { UserError } from "../errors.ts";
import {
  type PluginsConfig,
  parseLayoutValue,
  parseYamlMapping,
  readConfig,
  readSources,
} from "./config.ts";
import type { DiscoveredPlugin } from "./discover.ts";
import { writeLayout } from "./layout.ts";

/** Bigger than any real preset by a wide margin, and small enough to read without thinking. */
export const MAX_PRESET_BYTES = 64 * 1024;

/** What a preset may hold at the top level, and inside its `preset` block. */
const PRESET_KEYS = ["preset", "layout"];
const BLOCK_KEYS = ["description", "plugins"];
const PLUGIN_KEYS = ["npm"];

/** A preset's name: a bare word, so it can never reach outside the presets directory. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const EXTENSION = ".yaml";
const EXTENSIONS = [EXTENSION, ".yml"];

const HEADER =
  " A Rigline layout preset. Apply it with `rigline layout apply <file>`.\n" +
  " https://github.com/Rigline/Rigline/blob/main/docs/presets.md";

/**
 * What a preset says about one plugin it names. The file's claim, never Rigline's: it is repeated
 * in that voice and never turned into a command, because a package name chosen by whoever wrote
 * the file, printed as `rigline add ...`, would read as Rigline recommending an install (D131).
 */
export interface PresetPlugin {
  /** The npm package the file says this plugin comes from, or null where it says nothing. */
  readonly npm: string | null;
}

export interface Preset {
  /** The file it was read from, so a report can name what somebody has to look at. */
  readonly path: string;
  /** What to call it: the name it was found under, or its file's basename. */
  readonly name: string;
  readonly description: string | null;
  /** By plugin name, for the plugins the layout names; a preset need not mention any. */
  readonly plugins: Readonly<Record<string, PresetPlugin>>;
  readonly layout: Layout;
}

/** Where a preset is kept: a person's own, or one shipped inside the engine. */
export type PresetOrigin = "yours" | "shipped";

export interface PresetListing {
  readonly name: string;
  readonly origin: PresetOrigin;
  readonly path: string;
  readonly description: string | null;
  /** Whether a shipped preset of this name is hidden by this one. */
  readonly shadows: boolean;
  /** Why it cannot be read, for a file in the directory that is not a preset. */
  readonly problem: string | null;
}

/** The two directories a name is looked up in, in the order they win. */
export interface PresetDirs {
  readonly yours: string;
  readonly shipped: string;
}

/**
 * Whether `arg` is a path rather than a name. Shape decides, the same rule for `export` and
 * `apply`: a separator or an extension makes it a path, and a bare word is a name.
 */
export function isPresetPath(arg: string): boolean {
  return (
    arg.includes("/") ||
    arg.includes(sep) ||
    isAbsolute(arg) ||
    EXTENSIONS.includes(extname(arg).toLowerCase())
  );
}

/** The file `arg` names for reading: a path as given, else the name in `yours`, then `shipped`. */
export function resolvePreset(arg: string, dirs: PresetDirs): string {
  if (isPresetPath(arg)) {
    if (!existsSync(arg)) throw new UserError(`${arg} does not exist`);
    return arg;
  }
  checkName(arg);
  for (const dir of [dirs.yours, dirs.shipped]) {
    for (const extension of EXTENSIONS) {
      const path = join(dir, `${arg}${extension}`);
      if (existsSync(path)) return path;
    }
  }
  const there = listPresets(dirs).map((preset) => preset.name);
  throw new UserError(
    there.length === 0
      ? `there is no preset called "${arg}", and none is installed; ` +
          "`rigline layout export NAME` saves your layout as one"
      : `there is no preset called "${arg}"; there is ${there.join(", ")}`,
  );
}

/** The file `arg` names for writing: a path as given, else the name in the presets directory. */
export function presetTarget(arg: string, dirs: PresetDirs): string {
  if (isPresetPath(arg)) return arg;
  checkName(arg);
  return join(dirs.yours, `${arg}${EXTENSION}`);
}

function checkName(name: string): void {
  if (!NAME.test(name)) {
    throw new UserError(
      `"${name}" is not a preset name: a name is letters, digits, and . _ or - after the first; ` +
        "a path needs a separator or a .yaml extension",
    );
  }
}

/** Every preset in both directories, yours first, each name once. */
export function listPresets(dirs: PresetDirs): PresetListing[] {
  const listings: PresetListing[] = [];
  const taken = new Set<string>();
  for (const origin of ["yours", "shipped"] as const) {
    const dir = dirs[origin];
    for (const path of presetFiles(dir)) {
      const name = basename(path, extname(path));
      if (taken.has(name)) continue;
      taken.add(name);
      let description: string | null = null;
      let problem: string | null = null;
      try {
        description = readPreset(path).description;
      } catch (error) {
        problem = error instanceof UserError ? error.message : String(error);
      }
      listings.push({
        name,
        origin,
        path,
        description,
        shadows: origin === "yours" && shippedHas(dirs.shipped, name),
        problem,
      });
    }
  }
  return listings.sort((a, b) => a.name.localeCompare(b.name));
}

function presetFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && EXTENSIONS.includes(extname(entry.name).toLowerCase()))
    .map((entry) => join(dir, entry.name))
    .sort();
}

function shippedHas(dir: string, name: string): boolean {
  return EXTENSIONS.some((extension) => existsSync(join(dir, `${name}${extension}`)));
}

/** The preset in `path`, or a person's mistake named with the file. */
export function readPreset(path: string): Preset {
  const size = statSync(path).size;
  if (size > MAX_PRESET_BYTES) {
    throw new UserError(`${path} is ${size} bytes, and a preset may be ${MAX_PRESET_BYTES}`);
  }
  const doc = parseYamlMapping(path, readFileSync(path, "utf8"), "preset keys to values");
  const value = (doc.toJS() ?? {}) as Record<string, unknown>;
  refuseUnknown(path, "", value, PRESET_KEYS);
  // Absent, not empty: `layout:` with nothing under it says every element is where its plugin puts
  // it, which is a preset worth having. A missing key is a typo, and applying it would be a reset
  // nobody asked for.
  if (!Object.hasOwn(value, "layout")) {
    throw new UserError(`${path} has no "layout", so it is not a preset`);
  }
  const layout = checkLayout(path, parseLayoutValue(path, value.layout));
  const block = readBlock(path, value.preset);
  return {
    path,
    name: basename(path, extname(path)),
    description: block.description,
    plugins: block.plugins,
    layout,
  };
}

/** Every refusal a preset's layout earns beyond its shape, which `parseLayoutValue` has checked. */
function checkLayout(path: string, layout: Layout): Layout {
  let entries = 0;
  for (const [place, names] of Object.entries(layout)) {
    if (!plainText(place)) {
      throw new UserError(
        `${path} names a place that is empty, over ${MAX_NAME} characters, or not text`,
      );
    }
    // Refused, where `config.yaml` keeps it: an unreadable place is the one layout entry that
    // reaches *Needs you* and exits 1, so carrying one in would park the companion there (D132).
    const parsed = parsePlace(place);
    if ("problem" in parsed) throw new UserError(`${path}: ${parsed.problem}`);
    for (const name of names) {
      if (!plainText(name)) {
        throw new UserError(
          `${path} names an element that is empty, over ${MAX_NAME} characters, or not text`,
        );
      }
    }
    entries += 1 + names.length;
    if (entries > MAX_LAYOUT_ENTRIES) {
      throw new UserError(`${path} has more than ${MAX_LAYOUT_ENTRIES} places and names`);
    }
  }
  return layout;
}

interface PresetBlock {
  readonly description: string | null;
  readonly plugins: Readonly<Record<string, PresetPlugin>>;
}

function readBlock(path: string, value: unknown): PresetBlock {
  if (value === undefined || value === null) return { description: null, plugins: {} };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new UserError(`${path}: "preset" must be a mapping`);
  }
  const block = value as Record<string, unknown>;
  refuseUnknown(path, "preset", block, BLOCK_KEYS);
  const { description = null } = block;
  if (description !== null && (typeof description !== "string" || !plainText(description))) {
    throw new UserError(
      `${path}: "preset.description" must be one line of at most ${MAX_NAME} characters`,
    );
  }
  return { description, plugins: readPlugins(path, block.plugins) };
}

function readPlugins(path: string, value: unknown): Record<string, PresetPlugin> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new UserError(`${path}: "preset.plugins" must be a mapping of plugin names`);
  }
  const plugins: Record<string, PresetPlugin> = {};
  for (const [name, claim] of Object.entries(value as Record<string, unknown>)) {
    if (!plainText(name)) throw new UserError(`${path}: "preset.plugins" names a plugin oddly`);
    if (claim === undefined || claim === null) {
      plugins[name] = { npm: null };
      continue;
    }
    if (typeof claim !== "object" || Array.isArray(claim)) {
      throw new UserError(`${path}: "preset.plugins.${name}" must be a mapping`);
    }
    const entry = claim as Record<string, unknown>;
    refuseUnknown(path, `preset.plugins.${name}`, entry, PLUGIN_KEYS);
    const npm = entry.npm ?? null;
    if (npm !== null && (typeof npm !== "string" || !plainText(npm))) {
      throw new UserError(`${path}: "preset.plugins.${name}.npm" must be a package name`);
    }
    plugins[name] = { npm };
  }
  return plugins;
}

/**
 * Refused, never carried: a key this engine does not read is a typo or a setting from a later
 * Rigline, and either way applying the file would do something other than what it says (D132).
 */
function refuseUnknown(
  path: string,
  at: string,
  value: Record<string, unknown>,
  known: readonly string[],
): void {
  const unknown = Object.keys(value).filter((key) => !known.includes(key));
  if (unknown.length === 0) return;
  const where = at === "" ? "" : ` in "${at}"`;
  throw new UserError(
    `${path} has ${unknown.map((key) => `"${key}"`).join(", ")}${where}, which a preset ` +
      `does not carry; a preset holds ${known.join(" and ")}. ` +
      "A later Rigline may have written it, in which case `rigline update` reads it.",
  );
}

/** A preset as a file, with its header. */
export function writePreset(path: string, preset: Omit<Preset, "path" | "name">): void {
  const doc = new Document({});
  doc.commentBefore = HEADER;
  const block: Record<string, unknown> = {};
  if (preset.description !== null) block.description = preset.description;
  if (Object.keys(preset.plugins).length > 0) {
    block.plugins = Object.fromEntries(
      Object.entries(preset.plugins).map(([name, claim]) => [
        name,
        claim.npm === null ? null : { npm: claim.npm },
      ]),
    );
  }
  if (Object.keys(block).length > 0) doc.set("preset", doc.createNode(block));
  doc.set("layout", doc.createNode(preset.layout));
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, doc.toString({ flowCollectionPadding: false }));
}

/**
 * The preset to write for `config`'s layout: the person's decisions, sparse, with a claim for every
 * plugin it names that is not bundled and not Rigline's own.
 */
export function presetFromConfig(
  config: PluginsConfig,
  options: {
    readonly description?: string | null;
    readonly discovered: readonly DiscoveredPlugin[];
    readonly bundledRoot: string;
    readonly sourcesPath: string;
  },
): Omit<Preset, "path" | "name"> {
  const sources = readSources(options.sourcesPath);
  // `overridesBundled` as well as the root: this checkout's `plugins/` wins every bundled name, so
  // a root test alone calls all six of them third-party and writes a claim for each (D71).
  const bundled = new Set(
    options.discovered
      .filter((p) => p.root === options.bundledRoot || p.overridesBundled)
      .map((p) => p.name),
  );
  const plugins: Record<string, PresetPlugin> = {};
  for (const name of pluginsNamed(config.layout)) {
    if (bundled.has(name)) continue;
    const source = sources[name];
    plugins[name] = { npm: source?.kind === "npm" ? source.name : null };
  }
  return { description: options.description ?? null, plugins, layout: config.layout };
}

/**
 * Every plugin a layout names, each once, in the order it first names them. Rigline's own elements
 * are not a plugin's: nothing installs `rigline`, so nothing says where it comes from (D97).
 */
function pluginsNamed(layout: Layout): string[] {
  const names = new Set<string>();
  for (const entries of Object.values(layout)) {
    for (const entry of entries) {
      const plugin = entry.split("/")[0];
      if (plugin !== undefined && plugin !== "" && plugin !== RIGLINE) names.add(plugin);
    }
  }
  return [...names];
}

export interface ApplyResult {
  readonly changed: boolean;
  /** Each element whose place the apply moved, as one line: what it was, and what it is now. */
  readonly moved: readonly string[];
  /** Each plugin the preset names that is not installed, with what the file says about it. */
  readonly needs: readonly string[];
  /** Where the layout it replaced was kept, which is what `undo` reads. */
  readonly stashed: string;
}

/**
 * Writes a preset's layout over the config's, having kept the one it replaced.
 *
 * It replaces rather than merges, since a merge could not move anything back, and it names what
 * moved rather than only where things are: a preset naming the bundled elements alone sends every
 * other element back to its plugin's default, which is a loss a person should not have to spot by
 * comparing two reports (D131).
 */
export function applyPreset(
  paths: { readonly config: string; readonly previousLayout: string },
  discovered: readonly DiscoveredPlugin[],
  preset: Preset,
): ApplyResult {
  const before = readConfig(paths.config);
  const stashed = stash(paths.previousLayout, before, preset.name);
  const changed = writeLayout(paths.config, preset.layout);
  return {
    changed,
    moved: moves(before.layout, preset.layout, discovered),
    needs: needs(preset, discovered),
    stashed,
  };
}

/** The layout now in `config`, kept where `undo` reads it. */
function stash(path: string, config: PluginsConfig, applying: string): string {
  writePreset(path, {
    description: `The layout from before \`rigline layout apply ${applying}\`.`,
    plugins: {},
    layout: config.layout,
  });
  return path;
}

/** Where every element of every installed plugin sits under `from`, against where it sits under `to`. */
function moves(from: Layout, to: Layout, discovered: readonly DiscoveredPlugin[]): string[] {
  const lines: string[] = [];
  for (const plugin of withRigline(
    discovered.map((p) => ({ name: p.name, elements: p.manifest.elements })),
  )) {
    for (const [id, spec] of Object.entries(plugin.elements)) {
      const name = `${plugin.name}/${id}`;
      const was = placeElement(from, name, spec).placement;
      const now = placeElement(to, name, spec).placement;
      if (placeName(was) === placeName(now)) continue;
      lines.push(`${name}: ${where(was)} to ${where(now)}`);
    }
  }
  return lines;
}

function where(placement: Placement | null): string {
  return placement === null ? "off" : placementLabel(placement);
}

/**
 * A line per plugin the preset's layout names that is not installed, carrying the file's claim as
 * the file's claim. Never a command: see `PresetPlugin`.
 */
function needs(preset: Preset, discovered: readonly DiscoveredPlugin[]): string[] {
  const installed = new Set(discovered.map((p) => p.name));
  const lines: string[] = [];
  for (const name of pluginsNamed(preset.layout)) {
    if (installed.has(name)) continue;
    const npm = preset.plugins[name]?.npm ?? null;
    lines.push(
      npm === null
        ? `${name} is not installed, and the preset does not say where it comes from`
        : `${name} is not installed; the preset says it comes from the npm package "${npm}"`,
    );
  }
  return lines;
}

export interface UndoResult {
  readonly changed: boolean;
  /** What the layout came back from, for the line that says what happened. */
  readonly from: string;
}

/**
 * Puts back the layout the last `apply` replaced, and leaves the kept copy alone, so running it
 * twice says there is nothing to do rather than toggling. `apply` is the only thing that writes
 * the copy, so a `reset` or a Save since then is not undone by this.
 */
export function undoLayout(paths: {
  readonly config: string;
  readonly previousLayout: string;
}): UndoResult {
  if (!existsSync(paths.previousLayout)) {
    throw new UserError(
      "there is no layout to go back to: `rigline layout apply` keeps the one it replaces in " +
        paths.previousLayout,
    );
  }
  const kept = readPreset(paths.previousLayout);
  return { changed: writeLayout(paths.config, kept.layout), from: paths.previousLayout };
}
