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
import { basename, join, posix } from "node:path";

import {
  capabilityUse,
  type IdentifierTables,
  type Layout,
  layoutProblems,
  parsePlace,
  type SaveRecord,
  type Uses,
  undeclaredUse,
  unusedDeclaration,
  type ValidManifest,
  validateManifest,
  withRigline,
} from "@rigline/plugin-api/internal";
import { ManifestError, UserError } from "../errors.ts";
import { type DeclaredPatch, type PatchOutcome, patchRefusal } from "../inject/hostpatch.ts";
import { parseJson } from "../json.ts";
import { CORE_VERSION } from "../version.ts";
import type { PluginsConfig } from "./config.ts";

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
  /**
   * Whether this plugin won its name over a same-named one in the bundled set (D71).
   *
   * Recorded rather than logged. In this checkout all four first-party plugins are found twice —
   * once in `plugins/`, once in core's `dist/bundled/plugins` — so a shadowing line per collision
   * would put eight lines of noise under every installed version of every install, describing the
   * arrangement working exactly as designed. The two places somebody is actually asking read it
   * from here: `list`, and `add` at the moment a bundled name is taken.
   */
  readonly overridesBundled: boolean;
}

/**
 * Reads and validates `<dir>/rigline.json`. Every shape problem is collected into one throw, and a
 * `name`/directory mismatch or a missing capability is treated the same way as a missing entry
 * file. `add` lets the throw refuse the plugin; discovery catches it, reports the plugin by name
 * and loads the rest (P3).
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
    value = parseJson(check.json);
  } catch (error) {
    throw new UserError(`${check.label} is not valid JSON: ${(error as Error).message}`);
  }
  const { manifest, problems } = validateManifest(value, check.expectedName);
  if (manifest === null) throw new ManifestError(check.label, problems);
  if (!isPluginOutput(posix.normalize(manifest.entry.replaceAll("\\", "/")))) {
    throw new UserError(
      `${check.label} names entry "${manifest.entry}", which a plugin's copy leaves out: ` +
        "tests, node_modules and anything under a dot are never installed",
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
export interface DiscoverOptions {
  /** Plugins pinned to the end of registry order, in the order given. */
  readonly last?: readonly string[];
  /**
   * Core's `dist/bundled/plugins`, when it is one of `roots`. Naming it is what lets a bundled
   * plugin losing its name be told apart from any other collision (D71); without it every install
   * from this checkout reports four shadowed plugins as though something were wrong.
   */
  readonly bundledRoot?: string;
  readonly log?: (line: string) => void;
  /**
   * A plugin whose manifest does not hold, as one line naming it. It is not loaded, and it still
   * holds its name, so a same-named plugin further down does not stand in for it unannounced. Goes
   * to `log` when not given.
   */
  readonly refuse?: (line: string) => void;
}

export function discoverPlugins(
  roots: readonly string[],
  options?: DiscoverOptions,
): DiscoveredPlugin[] {
  const log = options?.log ?? (() => {});
  const refuse = options?.refuse ?? log;
  const found: (DiscoveredPlugin & { overridesBundled: boolean })[] = [];
  const winner = new Map<string, (typeof found)[number]>();
  const refused = new Map<string, string>();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const bundled = root === options?.bundledRoot;
    const names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(root, name, "rigline.json")))
      .sort();
    for (const name of names) {
      const dir = join(root, name);
      const refusedDir = refused.get(name);
      if (refusedDir !== undefined) {
        if (!bundled) log(`${dir} is shadowed by ${refusedDir}, which is not loaded`);
        continue;
      }
      const already = winner.get(name);
      if (already !== undefined) {
        // One name, one plugin (D56). Two of a name baked two registry entries, copied over each
        // other into the payload, and loaded the plugin twice. First root wins, because the root
        // order is the caller's and is already load order.
        //
        // Two shapes, and only one of them is news. A bundled plugin losing its name is the escape
        // hatch working: a fork in `~/.rigline/plugins`, or this checkout's own source, standing in
        // front of the copy inside the engine (D71). That is recorded on the winner and said once,
        // where somebody is asking. Anything else is a plugin missing from the panel with nothing
        // said about it, which is the failure P8 refuses, so it is named here.
        if (bundled) already.overridesBundled = true;
        else
          log(
            `${dir} is shadowed by ${already.dir}: a plugin called "${name}" is already discovered`,
          );
        continue;
      }
      let manifest: ValidManifest;
      try {
        manifest = readManifest(dir);
      } catch (error) {
        if (!(error instanceof UserError)) throw error;
        refused.set(name, dir);
        refuse(`"${name}" is not loaded: ${unloadable(error)}`);
        continue;
      }
      const plugin = { name, dir, root, manifest, overridesBundled: false };
      winner.set(name, plugin);
      found.push(plugin);
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

/** Why a plugin's manifest refused it, on one line, since a report gives each problem one. */
function unloadable(error: UserError): string {
  return error instanceof ManifestError
    ? `${error.label} does not hold: ${error.problems.join("; ")}`
    : error.message;
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

/** Each entry of the layout that does not resolve against `enabled`, naming the file (D92). */
export function layoutNotes(config: PluginsConfig, enabled: readonly DiscoveredPlugin[]): string[] {
  const plugins = withRigline(
    enabled.map((p) => ({ name: p.name, elements: p.manifest.elements })),
  );
  // A place this version cannot read needs a person, so `unknownPlaceLines` says it, not this.
  const unknown = new Set(
    Object.keys(config.layout).flatMap((place) => {
      const parsed = parsePlace(place);
      return "problem" in parsed ? [parsed.problem] : [];
    }),
  );
  return layoutProblems(config.layout, plugins, config.disabled)
    .filter((problem) => !unknown.has(problem))
    .map((problem) => `${config.path}: ${problem}`);
}

/** Every enabled plugin's declared host patches, flattened and named by the plugin that owns each. */
export function declaredPatches(enabled: readonly DiscoveredPlugin[]): DeclaredPatch[] {
  return enabled.flatMap((p) => p.manifest.patches.map((patch) => ({ plugin: p.name, patch })));
}

function normalizeEntry(entry: string): string {
  return entry.replace(/\\/g, "/");
}

/**
 * The ES module the loader imports to learn which plugins are enabled, what happened to their host
 * patches, and the person's layout. Registry order is discovery order — the order mounts sharing an
 * anchor appear in and the order rewriters compose in — so it is baked as an array, never a map.
 *
 * The layout goes in whole, entries that do not resolve included, because it is also what the panel
 * would save back (D92). `save` is null where there is nothing to save through (D93).
 */
export function bakeRegistry(
  enabled: readonly DiscoveredPlugin[],
  outcomes: readonly PatchOutcome[],
  layout: Layout = {},
  save: SaveRecord | null = null,
): string {
  const entries = enabled.map((p) =>
    JSON.stringify({
      name: p.name,
      entry: `./plugins/${p.name}/${normalizeEntry(p.manifest.entry)}`,
      surfaces: p.manifest.surfaces,
      uses: p.manifest.uses,
      elements: p.manifest.elements,
      patchRefusal: patchRefusal(p.name, outcomes),
    }),
  );
  const body = entries.map((e) => `  ${e},`).join("\n");
  return `// Baked by rigline at install time. Do not edit; it is overwritten on every install.
export const ${ENGINE_EXPORT} = ${JSON.stringify(CORE_VERSION)};
export const plugins = [
${body}
];
export const patches = ${JSON.stringify(outcomes)};
export const layout = ${JSON.stringify(layout)};
export const save = ${JSON.stringify(save)};
`;
}

/** The name the payload stamp is exported under, shared by what writes it and what reads it back. */
const ENGINE_EXPORT = "engine";

/**
 * The engine version out of a baked `registry.js`, or null when the file predates the stamp (D75).
 *
 * A bounded regex over a line this repository writes itself, rather than a second file beside the
 * registry. The webview cannot fetch, so anything the probe reads has to be a module the post hook
 * already imports; making the Node side read the same module is what keeps one fact in one place
 * instead of two writes that can disagree. Bounded because the rule about running a regex over
 * generated text holds even when we generated it.
 */
export function registryEngine(source: string): string | null {
  const match = new RegExp(`^export const ${ENGINE_EXPORT} = "([^"\\\\]{1,64})";$`, "m").exec(
    source,
  );
  return match?.[1] ?? null;
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

const SCRIPT = /\.m?js$/;
const SCRIPT_OR_STYLE = /\.(?:m?js|css)$/;

/** The text of every shipped file whose name `kind` matches, concatenated, for the advisory scans. */
function shippedSource(dir: string, kind: RegExp): string {
  let source = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!isPluginOutput(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Joined by a newline so the last token of one file never runs into the first of the next.
      source += `${shippedSource(full, kind)}\n`;
    } else if (kind.test(entry.name)) {
      source += `${readFileSync(full, "utf8")}\n`;
    }
  }
  return source;
}

/**
 * Switches a plugin declares and its shipped source never calls: a stale dependency nothing else
 * would notice. Advisory only (decisions.md, D16): `capabilityUse` is a textual scan and says so in
 * its own doc comment, and acting on it would put a scanner's blind spots in charge of whether a
 * plugin loads. `capabilityUseProblems` is the other direction.
 */
export function capabilityUseNotes(plugins: readonly DiscoveredPlugin[]): string[] {
  return plugins.flatMap((p) =>
    unusedDeclaration(p.manifest.uses as Uses, capabilityUse(shippedSource(p.dir, SCRIPT))).map(
      (note) => `${p.name}: ${note}`,
    ),
  );
}

/**
 * The half of the drift that is certain: a switch called and never declared throws and disables
 * the plugin, so it goes in the plain report, where a person reading why a plugin is off will look.
 */
export function capabilityUseProblems(plugins: readonly DiscoveredPlugin[]): string[] {
  return plugins.flatMap((p) =>
    undeclaredUse(p.manifest.uses as Uses, capabilityUse(shippedSource(p.dir, SCRIPT))).map(
      (problem) => `${p.name}: ${problem}`,
    ),
  );
}

/** A run of the characters a hashed class is made of, capped so a data URI stays a bounded read. */
const CLASS_TOKEN = /[A-Za-z0-9_$-]{8,128}/g;
/** How the class harvest's locals begin (`layers/classes.ts`). */
const LOCAL_START = /^[A-Za-z_$]/;
const HASH_LENGTH = 6;

/** A class of the extension's that a plugin's shipped source spells out. */
export interface HandWrittenClass {
  readonly cls: string;
  readonly module: string;
  /** Its local name, or null where this version's module has no such class. */
  readonly local: string | null;
}

/**
 * Every token in `source` ending in `_` and a module hash this version has (D107). Only the hash is
 * tested: a local the module lacks is a class written against an older extension, and a hash no
 * module has cannot be told from a plugin's own class, so it passes.
 */
export function handWrittenClasses(source: string, tables: IdentifierTables): HandWrittenClass[] {
  const found = new Map<string, HandWrittenClass>();
  for (const [token] of source.matchAll(CLASS_TOKEN)) {
    const split = token.length - HASH_LENGTH - 1;
    if (found.has(token) || token[split] !== "_" || !LOCAL_START.test(token)) continue;
    const module = token.slice(split + 1);
    if (!Object.hasOwn(tables.moduleClasses, module)) continue;
    const locals = tables.moduleClasses[module] ?? {};
    const local = token.slice(0, split);
    found.set(token, {
      cls: token,
      module,
      local: Object.hasOwn(locals, local) && locals[local] === token ? local : null,
    });
  }
  return [...found.values()];
}

/**
 * Where a plugin's shipped scripts or stylesheets spell out a class of the extension's by hand,
 * which no declaration covers and no runtime check sees: `ctx.style` reads only the text it is
 * handed (D107). Advisory, like `capabilityUseNotes`.
 */
export function handWrittenClassNotes(
  plugins: readonly DiscoveredPlugin[],
  tables: IdentifierTables,
): string[] {
  const anchorOf = new Map<string, string>();
  for (const [name, cls] of Object.entries(tables.anchors)) {
    if (cls !== null && !anchorOf.has(cls)) anchorOf.set(cls, name);
  }
  const notes: string[] = [];
  for (const p of plugins) {
    for (const { cls, module, local } of handWrittenClasses(
      shippedSource(p.dir, SCRIPT_OR_STYLE),
      tables,
    )) {
      if (local === null) {
        notes.push(
          `${p.name}: writes ${cls} by hand, in module ${module}'s naming, and this version has ` +
            "no such class, so whatever it styles or finds is gone",
        );
        continue;
      }
      const anchor = anchorOf.get(cls);
      const instead =
        anchor === undefined
          ? `ctx.cls("${module}", "${local}"), declared under uses.classes`
          : `ctx.anchor("${anchor}"), declared under uses.anchors`;
      notes.push(
        `${p.name}: writes the extension's class ${cls} by hand, which changes when Claude Code ` +
          `rebuilds module ${module}; reach it through ${instead}`,
      );
    }
  }
  return notes;
}
