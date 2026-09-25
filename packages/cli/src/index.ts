#!/usr/bin/env node
/**
 * `rigline`: the command a person installs.
 *
 * It retrieves bytes and hands them over. `update` and the remote half of `add` are its own, the
 * engine is installed under `<RIGLINE_HOME>/engine` and spawned, and every other verb is forwarded
 * verbatim — including one neither package knows, because the wrapper holds no verb list and the
 * engine prints the usage for all of it (D69, D70, D73).
 */
import { parseArgs } from "node:util";
import {
  ENGINE_PACKAGE,
  type Engine,
  type EngineOptions,
  engineDir,
  ensureEngine,
  formatEngineUpdate,
  readEngineState,
  updateEngine,
  wrapperVersion,
} from "./engine.ts";
import { UserError } from "./errors.ts";
import { addFromNpm, formatUpdates, type ListedPlugin, updatePlugins } from "./remote.ts";

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
  const engine = await ensureEngine();
  if (isPathSpec(spec)) return await engine.run(["add", spec]);
  return await addFromNpm({
    spec,
    engine: engine.run,
    registry: { ignoreReleaseAge: values.now },
  });
}

/** Every plugin the engine knows about, since `sources.json` is the engine's to read (D74). */
async function listed(engine: Engine): Promise<readonly ListedPlugin[]> {
  const answer = await engine.json(["list", "--json"]);
  if (!Array.isArray(answer)) throw new UserError("the engine's plugin list was not a list");
  return answer as ListedPlugin[];
}

/** The engine's `add` places the plugin and stops, where this is set (D98). */
const DEFER_INJECT = "RIGLINE_DEFER_INJECT";

/**
 * The engine, then the plugins, then one injection.
 *
 * The new engine is what places every plugin and writes every payload, so a stale injection cannot
 * outlive the run (D75). Each `add` defers its injection, so the report and its tail come last, once
 * (D98). An engine older than that ignores the variable and re-injects per plugin, as it always did.
 */
async function updateCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { now: { type: "boolean", default: false }, tag: { type: "string" } },
    allowPositionals: true,
  });
  const registry: EngineOptions["registry"] = { ignoreReleaseAge: values.now };

  const engineUpdate = await updateEngine({ registry, ...(values.tag ? { tag: values.tag } : {}) });
  console.log(formatEngineUpdate(engineUpdate));

  const engine = await ensureEngine({ registry });
  const updates = await updatePlugins({
    listed: await listed(engine),
    engine: (argv) => engine.run(argv, { [DEFER_INJECT]: "1" }),
    ...(positionals.length > 0 ? { names: positionals } : {}),
    registry,
  });
  console.log(formatUpdates(updates));

  const moved =
    engineUpdate.outcome === "moved" ||
    engineUpdate.outcome === "installed" ||
    updates.some((u) => u.outcome === "updated");
  let injected = 0;
  if (moved) {
    console.log("");
    injected = await engine.run(["install"]);
  }

  const failed = updates.some((u) => u.outcome === "failed") || engineUpdate.outcome === "failed";
  return failed || injected !== 0 ? 1 : 0;
}

/**
 * The one question the wrapper answers itself (D69).
 *
 * What is on this machine, which it can read from the manifest it already reads to find the bin —
 * where a usage is what the tool can do, which only the engine knows. It installs nothing, because
 * a version query is what somebody runs when something is already wrong.
 */
function versionCommand(): number {
  const prefix = engineDir();
  const state = readEngineState(prefix);
  console.log(`rigline ${wrapperVersion()}`);
  console.log(
    state.kind === "none"
      ? `engine: none in ${prefix} — the next command installs one`
      : `engine: ${ENGINE_PACKAGE} ${state.version} in ${prefix}` +
          (state.kind === "unusable" ? ` (unusable: ${state.why})` : ""),
  );
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "--version":
    case "-v":
      return versionCommand();
    case "add":
      return await addCommand(rest);
    case "update":
      return await updateCommand(rest);
    default: {
      const engine = await ensureEngine();
      return await engine.run(argv);
    }
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
