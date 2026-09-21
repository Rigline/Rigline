/**
 * `rigline build`: the convenience preset that turns a plugin's TypeScript into the one file its
 * manifest points at.
 *
 * The contract a plugin meets is an output, not a toolchain (decisions.md, P6): one browser-target
 * ES module plus rigline.json. This is the shortest way to produce that output and nothing more.
 * Everything the entry imports is bundled in, `@rigline/plugin-api` included, because a plugin
 * directory is copied into the extension as it stands and nothing there resolves a bare specifier.
 * Source maps are inline for the same reason the loader's are: the webview's CSP makes a sibling
 * `.map` fetch a gamble.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { UserError } from "@rigline/core";
import type { build as bundle } from "rolldown";

/**
 * Rolldown, loaded when a build is actually asked for.
 *
 * A static import here is a static import in `index.ts`, which means every `rigline --help` and
 * every `rigline install` pays for 20 MB of native binding — and, once rolldown is a devDependency
 * rather than a dependency, throws before the command has been read. It is a devDependency because
 * a plugin author's workspace declares its own, which is the only place a build ever happens: the
 * output contract is one browser ES module and a manifest, however it was produced (P6), so a
 * toolchain in the published CLI is a toolchain nobody asked for.
 */
async function rolldown(): Promise<typeof bundle> {
  try {
    return (await import("rolldown")).build;
  } catch {
    throw new UserError(
      "`rigline build` needs rolldown, which is not installed here. Add it to your workspace: " +
        "`pnpm add -D rolldown`. A plugin is one browser ES module and a manifest however you " +
        "build it, so any bundler will do; this command is the shortcut, not the contract.",
    );
  }
}

export interface BuildOptions {
  /** The plugin directory. Defaults to the current directory. */
  readonly dir?: string;
  /** The TypeScript entry, relative to the plugin directory. Defaults to src/index.ts. */
  readonly source?: string;
}

/** Build one plugin from its source entry to the `entry` its manifest names. */
export async function buildPlugin(
  options: BuildOptions = {},
): Promise<{ input: string; output: string }> {
  const dir = resolve(options.dir ?? process.cwd());
  const manifestPath = join(dir, "rigline.json");
  if (!existsSync(manifestPath)) throw new UserError(`${dir} has no rigline.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { entry?: unknown };
  if (typeof manifest.entry !== "string" || manifest.entry.length === 0) {
    throw new UserError(`${manifestPath} has no "entry"`);
  }
  const input = resolve(dir, options.source ?? "src/index.ts");
  if (!existsSync(input)) throw new UserError(`no plugin source at ${input}`);
  const output = resolve(dir, manifest.entry);

  const bundle = await rolldown();
  await bundle({
    input,
    platform: "browser",
    output: { file: output, format: "esm", sourcemap: "inline", codeSplitting: false },
  });
  return { input: relative(dir, input), output: relative(dir, output) };
}
