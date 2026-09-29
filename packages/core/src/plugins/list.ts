/**
 * What is installed, where it came from, and what it can do.
 *
 * Deliberately not part of `install`, which runs unattended under `watch` and again after every
 * extension update: a description of every plugin there is the same paragraph on a loop, which is
 * the shape of output people stop reading. Here somebody asked the question.
 *
 * Listing order is discovery order, `last` included, so this and the baked registry can never
 * disagree about which plugin loads first — the thing mount ordering and rewrite composition both
 * rest on. Whether a plugin's declarations hold against an installed version is a different
 * question, and `check` owns it; nothing here reads an extension directory.
 */
import { dirname } from "node:path";
import { describeElements, describeUses, type Uses } from "@rigline/plugin-api/internal";
import { CORE_VERSION } from "../version.ts";
import { describeSource, type PluginSource, readConfig, readSources } from "./config.ts";
import { type DiscoveredPlugin, discoverPlugins } from "./discover.ts";

/**
 * Which root a plugin was found under.
 *
 * - `checkout`: a Rigline checkout's `plugins/`, which only a contributor has.
 * - `home`: `~/.rigline/plugins`, where `add` installs. A plugin here with no source record is one
 *   somebody copied in by hand; anywhere else a missing record says nothing at all.
 * - `bundled`: core's own `dist/bundled/plugins` (D71). A plugin here is versioned with the engine,
 *   and one found ahead of it is an override rather than a collision.
 */
export type PluginOrigin = "checkout" | "home" | "bundled";

export interface ListRoot {
  readonly role: PluginOrigin;
  readonly path: string;
}

/** One declared host patch, without the bytes: `list` says what a patch is for, not what it is. */
export interface PatchListing {
  readonly why: string;
  readonly required: boolean;
}

export interface PluginListing {
  readonly name: string;
  readonly dir: string;
  readonly origin: PluginOrigin;
  /** False when `config.yaml` switched it off, which is the one state a person chose. */
  readonly enabled: boolean;
  /**
   * Where `add` brought it from, or null for one placed by hand. Null is a fact worth printing
   * rather than leaving to be inferred from silence (D49): nothing knows where that plugin came
   * from, so nothing can fetch a newer one, and the person who dropped it in owns the version.
   */
  readonly source: PluginSource | null;
  /**
   * What version this is, or null for one placed by hand.
   *
   * Three sources, because a plugin has three ways of getting here (D71): the engine's own version
   * for one bundled inside it, since `rigline.json` carries no version and the bundled tree ships
   * nothing that does; the pinned version for one `add` brought from npm; and nothing at all for a
   * directory somebody copied in, which is the same absence `source` already reports.
   */
  readonly version: string | null;
  /** Whether a same-named bundled plugin is standing behind this one, shadowed by it (D71). */
  readonly overridesBundled: boolean;
  readonly description: string | null;
  /** One sentence per thing the manifest declares. */
  readonly can: readonly string[];
  readonly patches: readonly PatchListing[];
}

export interface ListOptions {
  readonly roots: readonly ListRoot[];
  readonly configPath: string;
  readonly sourcesPath: string;
  /** Plugins pinned to the end of registry order, as `install` pins them. */
  readonly last?: readonly string[];
  /** A plugin whose manifest does not hold, which is not listed, as the line naming it. */
  readonly refuse?: (line: string) => void;
  /** A source record this engine cannot read, which leaves its plugin looking hand-placed. */
  readonly note?: (line: string) => void;
}

export function listPlugins(options: ListOptions): PluginListing[] {
  const bundledRoot = options.roots.find((r) => r.role === "bundled")?.path;
  const discovered = discoverPlugins(
    options.roots.map((r) => r.path),
    { last: options.last, bundledRoot, ...(options.refuse ? { refuse: options.refuse } : {}) },
  );
  const config = readConfig(options.configPath);
  const disabled = new Set(config.disabled);
  const sources = readSources(options.sourcesPath, options.note);
  const role = new Map(options.roots.map((r) => [r.path, r.role]));

  return discovered.map((plugin: DiscoveredPlugin) => {
    const source = sources[plugin.name] ?? null;
    return {
      name: plugin.name,
      dir: plugin.dir,
      origin: role.get(plugin.root) as PluginOrigin,
      enabled: !disabled.has(plugin.name),
      source,
      version: plugin.root === bundledRoot ? CORE_VERSION : versionOf(source),
      overridesBundled: plugin.overridesBundled,
      description: plugin.manifest.description,
      can: [
        ...describeUses(plugin.manifest.uses as Uses),
        ...describeElements(plugin.manifest.elements, plugin.name, config.layout),
      ],
      patches: plugin.manifest.patches.map((patch) => ({
        why: patch.why,
        required: patch.required === true,
      })),
    };
  });
}

/** The pinned version a source records, where its kind has one to record (D49). */
function versionOf(source: PluginSource | null): string | null {
  return source?.kind === "npm" ? source.version : null;
}

/** `rigline list --json`, kept for 1.x (D110). A projection, so the listing itself can change. */
export interface ListJson {
  readonly v: 1;
  readonly plugins: readonly PluginJson[];
}

export interface PluginJson {
  readonly name: string;
  readonly version: string | null;
  readonly origin: PluginOrigin;
  readonly dir: string;
  readonly enabled: boolean;
  readonly overridesBundled: boolean;
  readonly source: SourceJson | null;
  readonly description: string | null;
  /** Wording, like a report's. */
  readonly can: readonly string[];
  readonly patches: readonly PatchListing[];
}

/** What a person needs of a source; `sources.json` keeps the rest. `kind` may gain values in 1.x. */
export type SourceJson =
  | {
      readonly kind: "npm";
      readonly name: string;
      readonly version: string;
      readonly tag: string | null;
    }
  | { readonly kind: "path"; readonly from: string };

export function listJson(listings: readonly PluginListing[]): ListJson {
  return {
    v: 1,
    plugins: listings.map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      origin: plugin.origin,
      dir: plugin.dir,
      enabled: plugin.enabled,
      overridesBundled: plugin.overridesBundled,
      source: plugin.source === null ? null : sourceJson(plugin.source),
      description: plugin.description,
      can: plugin.can,
      patches: plugin.patches.map((patch) => ({ why: patch.why, required: patch.required })),
    })),
  };
}

function sourceJson(source: PluginSource): SourceJson {
  return source.kind === "npm"
    ? { kind: "npm", name: source.name, version: source.version, tag: source.tag }
    : { kind: "path", from: source.from };
}

/** Where a plugin was found, as the text report names it. */
function originLabel(plugin: PluginListing): string {
  if (plugin.origin === "checkout") return "this checkout";
  if (plugin.origin === "bundled") return "bundled";
  return dirname(plugin.dir);
}

export function formatPlugins(listings: readonly PluginListing[]): string {
  if (listings.length === 0) return "no plugins found";

  const lines: string[] = [];
  for (const plugin of listings) {
    lines.push(
      `${plugin.name}${plugin.version ? ` ${plugin.version}` : ""} — ${originLabel(plugin)}` +
        `${plugin.enabled ? "" : ", switched off in config"}`,
    );
    if (plugin.description) lines.push(`  ${plugin.description}`);
    if (plugin.source !== null) lines.push(`  added from ${describeSource(plugin.source)}`);
    else if (plugin.origin === "home") {
      lines.push("  placed here by hand, with no record of where from, so nothing can update it");
    }
    // Said here and at `add`, and nowhere else. It is the one arrangement where a plugin is
    // running and a same-named one is on the machine and is not, so a person reading this list
    // would otherwise have no way to know the bundled copy exists (D71).
    if (plugin.overridesBundled) lines.push("  overrides the copy bundled in the engine");
    for (const sentence of plugin.can) lines.push(`  - ${sentence}`);
    for (const patch of plugin.patches) {
      // Named apart from the capability sentences, because a host patch is the one declaration
      // that reaches outside the webview: it rewrites bytes in the extension's own bundle.
      lines.push(`  - patches extension.js${patch.required ? " (required)" : ""}: ${patch.why}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
