#!/usr/bin/env node
/**
 * The prototype command: a thin surface over @prototype/core.
 *
 * Commands land here as core grows. Every command throws UserError for a problem a person must
 * fix and lets anything else propagate with its stack, so a bug is never dressed up as advice.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  CORE_VERSION,
  diffScans,
  extensionVersion,
  findExtension,
  formatDiff,
  generate,
  prototypePaths,
  harvestAll,
  hostVerdict,
  inspect,
  install,
  installedExtensions,
  readBundles,
  restoreAll,
  scanOf,
  UserError,
  verdict,
} from "@prototype/core";
import { buildPlugin } from "./build.ts";

const USAGE = `prototype ${CORE_VERSION}

  prototype codegen [DIR] [--check] [--out FILE]
      Harvest the installed extension (or DIR) and write plugin-api's generated.ts.
      --check compares instead of writing and exits 1 when the file is out of date.

  prototype diff DIR_A DIR_B
      Compare the identifier layers of two extension directories.

  prototype build [DIR] [--source FILE]
      Bundle a plugin's src/index.ts (or --source) into the entry its prototype.json names.

  prototype install [--ext DIR] [--payload DIR]
      Inject the loader into every installed extension version (or DIR), harvesting each
      version's tables and baking the enabled plugins. Reload webviews afterwards.

  prototype status
      Per installed version: is each bundle vanilla or patched, judged against its backup.

  prototype restore
      Every installed version back to the extension's own bytes. Needs neither VS Code nor
      the extension to be working.
`;

/** The prebuilt pre.js and post.js, from the host package's build. */
function defaultPayloadDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "host", "dist");
}

/** The first-party plugins in this checkout. Plugins a person installs live under ~/.prototype. */
function repoPluginsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..", "plugins");
}

function installCommand(args: string[]): number {
  const { values } = parseArgs({
    args,
    options: { ext: { type: "string" }, payload: { type: "string" } },
    allowPositionals: false,
  });
  const targets = values.ext ? [values.ext] : installedExtensions();
  if (targets.length === 0) throw new UserError("no Claude Code extension is installed");
  const paths = prototypePaths();
  let hostChanged = false;
  for (const ext of targets) {
    const report = install(ext, {
      payloadDir: values.payload ?? defaultPayloadDir(),
      plugins: {
        roots: [repoPluginsDir(), paths.plugins],
        last: ["probe"],
        configPath: paths.config,
      },
      log: (line) => console.log(`  ${line}`),
    });
    hostChanged ||= report.hostChanged;
    console.log(
      `${report.version}: ${report.action}; plugins enabled: ${report.enabled.join(", ") || "none"}` +
        (report.disabled.length > 0 ? `; disabled: ${report.disabled.join(", ")}` : ""),
    );
  }
  console.log(
    hostChanged
      ? "\nA host patch changed: run Developer: Reload Window (this ends the window's sessions)."
      : "\nReload with Developer: Reload Webviews (current window only).",
  );
  return 0;
}

function statusCommand(): number {
  const targets = installedExtensions();
  if (targets.length === 0) throw new UserError("no Claude Code extension is installed");
  for (const ext of targets) {
    const state = inspect(ext);
    console.log(
      `${extensionVersion(ext)}: webview ${verdict(state)}${state.markerPresent ? " (marker present)" : ""}` +
        `${state.backupExists ? "" : ", no backup"}; host ${hostVerdict(state)}` +
        `${state.hostBackupExists ? " (backup present)" : ""}`,
    );
    console.log(`  ${ext}`);
  }
  return 0;
}

function restoreCommand(): number {
  const results = restoreAll(installedExtensions());
  let failed = 0;
  for (const result of results) {
    if (result.restored) console.log(`restored: ${result.ext}`);
    else {
      failed++;
      console.log(`NOT restored: ${result.ext} (${result.reason})`);
    }
  }
  if (failed > 0) {
    console.log(
      "\nA version without a backup is recovered by uninstalling and reinstalling Claude Code from the Extensions view.",
    );
  }
  console.log("Reload the window afterwards.");
  return failed > 0 ? 1 : 0;
}

/** The repo's committed baseline, resolved from this file's location so the command works from any cwd. */
function defaultGeneratedPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "plugin-api", "src", "generated.ts");
}

function codegen(args: string[]): number {
  const { values, positionals } = parseArgs({
    args,
    options: { check: { type: "boolean", default: false }, out: { type: "string" } },
    allowPositionals: true,
  });
  if (positionals.length > 1) throw new UserError(`expected at most one directory: ${positionals}`);
  const ext = positionals[0] ?? findExtension();
  const out = values.out ?? defaultGeneratedPath();

  const generated = generate(harvestAll(readBundles(ext)));
  const label = relative(process.cwd(), out) || out;
  if (values.check) {
    const current = existsSync(out) ? readFileSync(out, "utf8") : "";
    if (current === generated.source) {
      console.log(`${label} is up to date for ${generated.tables.version}: ${generated.counts}`);
      return 0;
    }
    console.log(`${label} is out of date for ${generated.tables.version}. Run: prototype codegen`);
    return 1;
  }
  writeFileSync(out, generated.source);
  console.log(`source: ${ext}`);
  console.log(`${generated.tables.version}: ${generated.counts}`);
  for (const module of generated.unreachableModules) {
    console.log(`  unreachable stylesheet module: ${module}`);
  }
  console.log(`wrote: ${label}`);
  return 0;
}

function diff(args: string[]): number {
  if (args.length !== 2) throw new UserError("diff needs exactly two extension directories");
  const [a, b] = args as [string, string];
  const from = scanOf(harvestAll(readBundles(a)));
  const to = scanOf(harvestAll(readBundles(b)));
  console.log(formatDiff(from, to, diffScans(from, to)));
  return 0;
}

async function build(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { source: { type: "string" } },
    allowPositionals: true,
  });
  if (positionals.length > 1) throw new UserError(`expected at most one directory: ${positionals}`);
  const built = await buildPlugin({ dir: positionals[0], source: values.source });
  console.log(`built ${built.input} -> ${built.output}`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "codegen":
      return codegen(rest);
    case "diff":
      return diff(rest);
    case "build":
      return build(rest);
    case "install":
      return installCommand(rest);
    case "status":
      return statusCommand();
    case "restore":
      return restoreCommand();
    case undefined:
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;
    default:
      throw new UserError(`unknown command "${command}"\n\n${USAGE}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UserError) {
      console.error(`prototype: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  },
);
