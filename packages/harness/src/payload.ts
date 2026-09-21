/**
 * Building the payload a real injector would leave beside the bundle (docs/host.md, "What the
 * injector leaves on disk"): pre.js and post.js from the host build, generated.js harvested fresh
 * from the corpus, and a registry baking whichever fixture plugins one test wants active.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bundledDir, generate, harvestAll, missingAnchorReason } from "@rigline/core";
import {
  type AnchorName,
  EMPTY_USES,
  SURFACES,
  type Surface,
  type Uses,
} from "@rigline/plugin-api";
import { corpusBundles } from "../../core/test/corpus.ts";

/** The two files the host builds to, which are the two this copies. */
const PAYLOAD_FILES = ["pre.js", "post.js"] as const;

export interface FixturePlugin {
  readonly name: string;
  /** An ES module source string: no build step, since none of these need one. */
  readonly source: string;
  /** The manifest fields the registry needs; `uses` keys not given default to their empty value. */
  readonly manifest: {
    readonly surfaces?: readonly Surface[];
    readonly uses?: Partial<Uses>;
  };
}

/**
 * Identifiers to delete from the harvested tables before writing them, so a test can stand an
 * extension update up in front of the real bundle. The bundle itself is untouched — what changes is
 * only what the loader believes about it, which is precisely the state a plugin meets on the
 * morning after an update it has not caught up with.
 */
export interface RemovedIdentifiers {
  readonly anchors?: readonly string[];
  readonly modules?: readonly string[];
  readonly messages?: readonly string[];
}

export interface PreparePayloadOptions {
  readonly version: string;
  readonly plugins: readonly FixturePlugin[];
  readonly remove?: RemovedIdentifiers;
}

/** Write pre.js, post.js, generated.js, registry.js and plugins/<name>/index.js into `dir`. */
export function preparePayload(dir: string, options: PreparePayloadOptions): void {
  // From `dist/bundled`, which is what a user's install carries, so this tier drives the bytes
  // they get rather than a second source of truth. `bundledDir` also carries the staleness chain
  // that used to live here: without it, a change to the host with no rebuild gives either a green
  // run against the previous payload — the worse outcome, since it reports a property of code that
  // is not running — or a failure debugged in source that was never loaded.
  const bundled = bundledDir();
  mkdirSync(dir, { recursive: true });
  for (const file of PAYLOAD_FILES) {
    copyFileSync(join(bundled, file), join(dir, file));
  }

  const generated = generate(harvestAll(corpusBundles(options.version)));
  writeFileSync(join(dir, "generated.js"), withoutIdentifiers(generated.runtime, options.remove));

  const plugins = options.plugins.map((plugin) => ({
    name: plugin.name,
    entry: `./plugins/${plugin.name}/index.js`,
    surfaces: plugin.manifest.surfaces ?? SURFACES,
    uses: { ...EMPTY_USES, ...plugin.manifest.uses },
    patchRefusal: null,
  }));
  const registrySource = `// Written by @rigline/harness's preparePayload for one test run. Do not edit.
export const plugins = ${JSON.stringify(plugins, null, 2)};
export const patches = [];
`;
  writeFileSync(join(dir, "registry.js"), registrySource, "utf8");

  for (const plugin of options.plugins) {
    const pluginDir = join(dir, "plugins", plugin.name);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "index.js"), plugin.source, "utf8");
  }
}

/**
 * `runtime` with the named identifiers gone. Rewritten as data rather than regenerated, because the
 * point is a table that disagrees with the bundle beside it, which no harvest would ever produce.
 */
function withoutIdentifiers(runtime: string, remove?: RemovedIdentifiers): string {
  if (!remove) return runtime;
  const prefix = runtime.slice(0, runtime.indexOf("{"));
  const tables = JSON.parse(runtime.slice(runtime.indexOf("{"), runtime.lastIndexOf("}") + 1)) as {
    anchors: Record<string, string | null>;
    anchorSelectors: Record<string, string | null>;
    unresolvedAnchors: Record<string, string>;
    moduleClasses: Record<string, unknown>;
    messageTypes: string[];
  };
  for (const anchor of remove.anchors ?? []) {
    // All three, because an anchor that resolved to a class and still to a selector is a state no
    // harvest produces: `watch` would go on finding the element the test says has gone.
    tables.anchors[anchor] = null;
    tables.anchorSelectors[anchor] = null;
    tables.unresolvedAnchors[anchor] = missingAnchorReason(anchor as AnchorName);
  }
  for (const module of remove.modules ?? []) delete tables.moduleClasses[module];
  const gone = new Set(remove.messages ?? []);
  tables.messageTypes = tables.messageTypes.filter((type) => !gone.has(type));
  return `${prefix}${JSON.stringify(tables)};
`;
}
