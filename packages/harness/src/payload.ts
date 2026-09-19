/**
 * Building the payload a real injector would leave beside the bundle (docs/host.md, "What the
 * injector leaves on disk"): pre.js and post.js from the host build, generated.js harvested fresh
 * from the corpus, and a registry baking whichever fixture plugins one test wants active.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generate, harvestAll, missingAnchorReason } from "@rigline/core";
import {
  type AnchorName,
  EMPTY_USES,
  SURFACES,
  type Surface,
  type Uses,
} from "@rigline/plugin-api";
import { corpusBundles } from "../../core/test/corpus.ts";

/** packages/host/dist, resolved from this file rather than assumed relative to the cwd. */
const HOST_DIST = fileURLToPath(new URL("../../host/dist/", import.meta.url));

/** packages/host/src, the sources `dist` is built from and is checked against below. */
const HOST_SRC = fileURLToPath(new URL("../../host/src/", import.meta.url));

/** The two files the host builds to, which are the two this copies. */
const PAYLOAD_FILES = ["pre.js", "post.js"] as const;

const BUILD_HINT = "run `pnpm build` (or `pnpm --filter @rigline/host build`) and try again";

/** The newest mtime anywhere under `dir`, or 0 for a directory that is not there. */
function newestMtime(dir: string): number {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const at = entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs;
    if (at > newest) newest = at;
  }
  return newest;
}

/**
 * Refuse to build a payload out of a host build older than the host sources.
 *
 * These tests drive the *real* `pre.js` and `post.js`, copied from `dist`, so vitest on its own
 * exercises whatever was last built. Without this, a change to the host with no rebuild gives
 * either a green run against the previous payload — the worse outcome, since it reports a
 * property of code that is not running — or a failure debugged in source that was never loaded.
 * It was a rule in CLAUDE.md that every contributor had to keep; this is the tooling keeping it.
 *
 * Mtimes rather than content hashes: the question is only "was this built after it was edited",
 * a rebuild of unchanged sources answers it correctly, and the cost is a stat per source file.
 */
function assertHostBuildIsCurrent(): void {
  const built = PAYLOAD_FILES.map((file) => join(HOST_DIST, file));
  const missing = built.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(
      `@rigline/host is not built: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing — ${BUILD_HINT}`,
    );
  }
  const oldestBuilt = Math.min(...built.map((file) => statSync(file).mtimeMs));
  const newestSource = newestMtime(HOST_SRC);
  if (newestSource > oldestBuilt) {
    throw new Error(
      `@rigline/host has sources newer than its build, so these tests would run against a stale ` +
        `pre.js/post.js and report a property of code that is not loaded — ${BUILD_HINT}`,
    );
  }
}

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
  assertHostBuildIsCurrent();
  mkdirSync(dir, { recursive: true });
  for (const file of PAYLOAD_FILES) {
    copyFileSync(join(HOST_DIST, file), join(dir, file));
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
