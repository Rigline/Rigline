#!/usr/bin/env node
/**
 * `rigline`: the command a person installs.
 *
 * It owns `update` and the remote half of `add`, and forwards every other verb to the engine (D69,
 * D70). Still calls the engine in-process; what replaces that is installing `@rigline/core` under
 * `<RIGLINE_HOME>/engine` and spawning its bin, which is why the seam is an argv array.
 */
import { parseArgs } from "node:util";
import {
  bundledPluginsDir,
  checkoutPluginsDir,
  listPlugins,
  riglinePaths,
  runEngine,
} from "@rigline/core";
import { UserError } from "./errors.ts";
import {
  addFromNpm,
  formatUpdates,
  type ListedPlugin,
  type RunEngine,
  updatePlugins,
} from "./remote.ts";

const engine: RunEngine = (argv) => runEngine(argv);

/**
 * Whether a spec is a directory rather than a published plugin.
 *
 * A leading dot or a path separator, which is the rule every package manager uses: an npm name
 * cannot hold a separator except the one in a scope, and a scope starts with `@`.
 */
function isPathSpec(spec: string): boolean {
  if (spec.startsWith("@")) return false;
  return spec.startsWith(".") || spec.includes("/") || spec.includes("\\");
}

/** `add`: a path goes straight to the engine, a spec is resolved and staged first (D70). */
async function addCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { now: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  if (positionals.length !== 1) {
    throw new UserError("add needs exactly one plugin directory or npm package");
  }
  const spec = positionals[0] as string;
  if (isPathSpec(spec)) return await engine(["add", spec]);
  return await addFromNpm({ spec, engine, registry: { ignoreReleaseAge: values.now } });
}

/**
 * Every plugin the engine knows about, since `config.json` is the engine's to read (D74).
 *
 * In-process while the wrapper still depends on core. Once it does not, this is
 * `rigline-engine list --json` and the parsed stdout, which is the shape `ListedPlugin` describes.
 */
function listed(): readonly ListedPlugin[] {
  const paths = riglinePaths();
  const checkout = checkoutPluginsDir();
  return listPlugins({
    roots: [
      ...(checkout === null ? [] : [{ label: "this checkout", path: checkout }]),
      { label: paths.plugins, path: paths.plugins, managed: true },
      { label: "bundled", path: bundledPluginsDir(), bundled: true },
    ],
    last: ["probe"],
    configPath: paths.config,
  });
}

async function updateCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { now: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  const updates = await updatePlugins({
    listed: listed(),
    engine,
    names: positionals.length > 0 ? positionals : undefined,
    registry: { ignoreReleaseAge: values.now },
  });
  console.log(formatUpdates(updates));
  return updates.some((u) => u.outcome === "failed") ? 1 : 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "add":
      return await addCommand(rest);
    case "update":
      return await updateCommand(rest);
    default:
      // Everything else is the engine's, including a verb neither package knows: the wrapper holds
      // no verb list, which is what lets core add a command without a wrapper release.
      return await engine(argv);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UserError) {
      console.error(`rigline: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  },
);
