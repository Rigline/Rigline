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
import { describeUses, type Uses } from "@rigline/plugin-api";
import { CORE_VERSION } from "../version.ts";
import {
  type DiscoveredPlugin,
  describeSource,
  discoverPlugins,
  type PluginSource,
  readConfig,
} from "./discover.ts";

/** A discovery root and what to call it in the report. */
export interface LabelledRoot {
  readonly label: string;
  readonly path: string;
  /**
   * The root `add` installs into, where a plugin with no source record is one somebody copied in by
   * hand. Everywhere else a missing record says nothing at all — a first-party plugin in a checkout
   * was never added and has nothing to be updated from.
   */
  readonly managed?: boolean;
  /**
   * Core's own `dist/bundled/plugins` (D71). A plugin found here is versioned with the engine, and
   * one found ahead of it is an override rather than a collision.
   */
  readonly bundled?: boolean;
}

/** One declared host patch, without the bytes: `list` says what a patch is for, not what it is. */
export interface PatchListing {
  readonly why: string;
  readonly required: boolean;
}

export interface PluginListing {
  readonly name: string;
  readonly dir: string;
  /** The label of the root it was discovered under. */
  readonly origin: string;
  /** False when `config.json` switched it off, which is the one state a person chose. */
  readonly enabled: boolean;
  /**
   * Where `add` brought it from, or null for one placed by hand. Null is a fact worth printing
   * rather than leaving to be inferred from silence (D49): nothing knows where that plugin came
   * from, so nothing can fetch a newer one, and the person who dropped it in owns the version.
   */
  readonly source: PluginSource | null;
  /** Whether it sits in the root `add` installs into, which is what makes a missing source a fact. */
  readonly managed: boolean;
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
  readonly roots: readonly LabelledRoot[];
  readonly configPath: string;
  /** Plugins pinned to the end of registry order, as `install` pins them. */
  readonly last?: readonly string[];
}

export function listPlugins(options: ListOptions): PluginListing[] {
  const bundledRoot = options.roots.find((r) => r.bundled)?.path;
  const discovered = discoverPlugins(
    options.roots.map((r) => r.path),
    { last: options.last, bundledRoot },
  );
  const config = readConfig(options.configPath);
  const disabled = new Set(config.disabled);
  const label = new Map(options.roots.map((r) => [r.path, r.label]));
  const managed = new Set(options.roots.filter((r) => r.managed).map((r) => r.path));

  return discovered.map((plugin: DiscoveredPlugin) => {
    const source = config.sources[plugin.name] ?? null;
    return {
      name: plugin.name,
      dir: plugin.dir,
      origin: label.get(plugin.root) ?? plugin.root,
      enabled: !disabled.has(plugin.name),
      source,
      managed: managed.has(plugin.root),
      version: plugin.root === bundledRoot ? CORE_VERSION : versionOf(source),
      overridesBundled: plugin.overridesBundled,
      description: plugin.manifest.description,
      can: describeUses(plugin.manifest.uses as Uses),
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

export function formatPlugins(listings: readonly PluginListing[]): string {
  if (listings.length === 0) return "no plugins found";

  const lines: string[] = [];
  for (const plugin of listings) {
    lines.push(
      `${plugin.name}${plugin.version ? ` ${plugin.version}` : ""} — ${plugin.origin}` +
        `${plugin.enabled ? "" : ", switched off in config"}`,
    );
    if (plugin.description) lines.push(`  ${plugin.description}`);
    if (plugin.source !== null) lines.push(`  added from ${describeSource(plugin.source)}`);
    else if (plugin.managed) {
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
