/**
 * Building the payload a real injector would leave beside the bundle (docs/host.md, "What the
 * injector leaves on disk"): pre.js and post.js from the host build, generated.js harvested fresh
 * from the corpus, and a registry baking whichever fixture plugins one test wants active.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generate, harvestAll } from "@prototype/core";
import { EMPTY_USES, SURFACES, type Surface, type Uses } from "@prototype/plugin-api";
import { corpusBundles } from "../../core/test/corpus.ts";

/** packages/host/dist, resolved from this file rather than assumed relative to the cwd. */
const HOST_DIST = fileURLToPath(new URL("../../host/dist/", import.meta.url));

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

export interface PreparePayloadOptions {
  readonly version: string;
  readonly plugins: readonly FixturePlugin[];
}

/** Write pre.js, post.js, generated.js, registry.js and plugins/<name>/index.js into `dir`. */
export function preparePayload(dir: string, options: PreparePayloadOptions): void {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(HOST_DIST, "pre.js"), join(dir, "pre.js"));
  copyFileSync(join(HOST_DIST, "post.js"), join(dir, "post.js"));

  const generated = generate(harvestAll(corpusBundles(options.version)));
  writeFileSync(join(dir, "generated.js"), generated.runtime, "utf8");

  const plugins = options.plugins.map((plugin) => ({
    name: plugin.name,
    entry: `./plugins/${plugin.name}/index.js`,
    surfaces: plugin.manifest.surfaces ?? SURFACES,
    uses: { ...EMPTY_USES, ...plugin.manifest.uses },
    patchRefusal: null,
  }));
  const registrySource = `// Written by @prototype/harness's preparePayload for one test run. Do not edit.
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
