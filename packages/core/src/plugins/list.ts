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
import { type DiscoveredPlugin, discoverPlugins, readConfig } from "./discover.ts";

/** A discovery root and what to call it in the report. */
export interface LabelledRoot {
  readonly label: string;
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
  /** The label of the root it was discovered under. */
  readonly origin: string;
  /** False when `config.json` switched it off, which is the one state a person chose. */
  readonly enabled: boolean;
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
  const discovered = discoverPlugins(
    options.roots.map((r) => r.path),
    { last: options.last },
  );
  const disabled = new Set(readConfig(options.configPath).disabled);
  const label = new Map(options.roots.map((r) => [r.path, r.label]));

  return discovered.map((plugin: DiscoveredPlugin) => ({
    name: plugin.name,
    dir: plugin.dir,
    origin: label.get(plugin.root) ?? plugin.root,
    enabled: !disabled.has(plugin.name),
    description: plugin.manifest.description,
    can: describeUses(plugin.manifest.uses as Uses),
    patches: plugin.manifest.patches.map((patch) => ({
      why: patch.why,
      required: patch.required === true,
    })),
  }));
}

export function formatPlugins(listings: readonly PluginListing[]): string {
  if (listings.length === 0) return "no plugins found";

  const lines: string[] = [];
  for (const plugin of listings) {
    lines.push(
      `${plugin.name} — ${plugin.origin}${plugin.enabled ? "" : ", switched off in config"}`,
    );
    if (plugin.description) lines.push(`  ${plugin.description}`);
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
