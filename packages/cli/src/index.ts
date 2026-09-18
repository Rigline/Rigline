#!/usr/bin/env node
/**
 * The rigline command: a thin surface over @rigline/core.
 *
 * Commands land here as core grows. Every command throws UserError for a problem a person must
 * fix and lets anything else propagate with its stack, so a bug is never dressed up as advice.
 */
import { existsSync, watch as fsWatch, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  addPlugin,
  CORE_VERSION,
  check,
  collect,
  diffScans,
  EXTENSIONS_DIR,
  extensionVersion,
  findExtension,
  formatDiff,
  formatDoctor,
  formatFlow,
  formatPlugins,
  type Generated,
  generate,
  harvestAll,
  hostVerdict,
  type InstallOptions,
  inspect,
  install,
  installedExtensions,
  listPlugins,
  readAnchorOverrides,
  readBundles,
  removePlugin,
  restoreAll,
  riglinePaths,
  scanOf,
  UserError,
  update,
  verdict,
  watch,
} from "@rigline/core";
import { buildPlugin } from "./build.ts";

const USAGE = `rigline ${CORE_VERSION}

  rigline codegen [DIR] [--check] [--out FILE]
      Harvest the installed extension (or DIR) and write ./generated.ts: the identifier
      augmentation your plugins compile against, and the baseline install diffs. Commit it.
      --check compares instead of writing and exits 1 when the file is out of date. Either
      way it exits 1 if a curated anchor claims to name one element and this version
      applies its class in more than one place. It reads the shipped anchor table, never
      ~/.rigline/anchors.json: its verdict is about this repository's table.

  rigline diff DIR_A DIR_B
      Compare the identifier layers of two extension directories.

  rigline build [DIR] [--source FILE]
      Bundle a plugin's src/index.ts (or --source) into the entry its rigline.json names.

  rigline install [--ext DIR] [--payload DIR]
      Inject the loader into every installed extension version (or DIR), baking the enabled
      plugins, and report what moved since the baseline and which plugins each version
      refuses. Any entry in ~/.rigline/anchors.json is applied and named, with what this
      version makes of it. Rewrites ./generated.ts when the directory has one and records
      the new baseline; never commits either. Run it after an extension update, and reload
      webviews afterwards. Exits 1 when a person is needed.

  rigline check [--ext DIR]
      Read-only. Per installed version (or DIR): what moved since the baseline, which
      plugins this version would refuse and by which identifier, which curated anchors it
      lacks, and what it makes of each entry in ~/.rigline/anchors.json. Exits 1 when a
      person is needed.

  rigline watch [--interval SECONDS]
      install, and again whenever the set of installed extension directories changes,
      which is what an extension update looks like from outside VS Code.

  rigline dev [DIR...]
      Build the named plugin directories (or every first-party one), re-inject, and rebuild
      on every source change. Reload webviews after each one.

  rigline add PATH
      Install the plugin in PATH into ~/.rigline/plugins, say what it can do, and re-inject.
      Nothing is fetched, nothing is resolved, and none of the plugin's own code is run.

  rigline remove NAME
      Delete a plugin rigline installed, and re-inject. A plugin you did not install this
      way is switched off in ~/.rigline/config.json instead; this will not delete it.

  rigline list
      Every plugin found, in the order they load: where it came from, whether it is
      switched off, and what its manifest says it can do.

  rigline status
      Per installed version: is each bundle vanilla or patched, judged against its backup.

  rigline restore
      Every installed version back to the extension's own bytes. Needs neither VS Code nor
      the extension to be working.

  rigline doctor [--out FILE] [--ext DIR]
      A markdown diagnostic to paste into a bug report: per installed version, whether it is
      patched, what the payload holds, which plugins are baked in and what any host patch
      did. For what the panel itself was doing, copy the probe's report from the RIG badge.
`;

/** The prebuilt pre.js and post.js, from the host package's build. */
function defaultPayloadDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "host", "dist");
}

/** The first-party plugins in this checkout. Plugins a person installs live under ~/.rigline. */
function repoPluginsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..", "plugins");
}

/** Where plugins are discovered from, and which of them a person has turned off. */
function pluginOptions(): NonNullable<InstallOptions["plugins"]> {
  const paths = riglinePaths();
  return { roots: [repoPluginsDir(), paths.plugins], last: ["probe"], configPath: paths.config };
}

interface ReinjectOptions {
  readonly exts?: readonly string[];
  readonly payloadDir?: string;
  /** Refuse rather than shrug when nothing is installed: what `install`, asked outright, should do. */
  readonly required?: boolean;
}

/**
 * Inject into every installed version and print the report.
 *
 * `install` is this and nothing else; `add` and `remove` run it too, because they change the plugin
 * set and leaving the payload stale behind them would mean a person who added a plugin has to know
 * about a second command before anything appears (D56).
 *
 * No extension installed is not a failure here. `add` has already put the plugin where it belongs,
 * and saying so and stopping is a better answer than an error about a directory the person may be
 * about to create by installing the extension.
 */
function reinject(options: ReinjectOptions = {}): number {
  const targets = options.exts ?? installedExtensions();
  if (targets.length === 0) {
    if (options.required) throw new UserError("no Claude Code extension is installed");
    console.log("No Claude Code extension is installed, so nothing was injected.");
    return 0;
  }
  const report = update({
    exts: targets,
    payloadDir: options.payloadDir ?? defaultPayloadDir(),
    plugins: pluginOptions(),
    // Only where the directory already has one; this never creates a harvest for somebody who has
    // not asked for one, and it never commits what it rewrites (D30).
    codegen: true,
  });
  console.log(formatFlow(report));
  console.log(
    report.versions.some((v) => v.hostChanged)
      ? `\nA host patch changed: run Developer: Reload Window (this ends the window's sessions).`
      : `\nReload with Developer: Reload Webviews (current window only).`,
  );
  return report.attention.length > 0 ? 1 : 0;
}

/**
 * Installs a plugin from a directory. No network and no package manager (D47): a plugin is a
 * manifest and a built module, and everything `add` does is around the copy rather than inside it.
 *
 * What it can do is printed because this is the moment it means something (D26): installing a
 * plugin is the act that says yes, and nothing after it asks again, so the sentences belong here
 * rather than in a prompt nobody can answer usefully.
 */
function addCommand(args: string[]): number {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true });
  if (positionals.length !== 1) throw new UserError("add needs exactly one plugin directory");

  const paths = riglinePaths();
  const result = addPlugin({
    from: positionals[0] as string,
    pluginsDir: paths.plugins,
    configPath: paths.config,
    otherRoots: [repoPluginsDir()],
  });

  console.log(`${result.replaced ? "replaced" : "added"} ${result.name} — ${result.dir}`);
  console.log(`  from ${result.from}`);
  if (result.manifest.description) console.log(`  ${result.manifest.description}`);
  for (const sentence of result.can) console.log(`  - ${sentence}`);
  for (const patch of result.manifest.patches) {
    // Named apart, and never folded in with the capability sentences: a host patch is the one
    // declaration that reaches outside the webview, into the extension's own bundle.
    console.log(`  - patches extension.js${patch.required ? " (required)" : ""}: ${patch.why}`);
  }
  if (result.disabled) {
    console.log(
      `  "${result.name}" is switched off in ${paths.config}, so it will not load until you remove it from "disabled"`,
    );
  }
  console.log("");
  return reinject();
}

function removeCommand(args: string[]): number {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true });
  if (positionals.length !== 1) throw new UserError("remove needs exactly one plugin name");

  const paths = riglinePaths();
  const result = removePlugin({
    name: positionals[0] as string,
    pluginsDir: paths.plugins,
    configPath: paths.config,
    otherRoots: [repoPluginsDir()],
  });
  console.log(`removed ${result.name} — ${result.dir}`);
  if (!result.hadSource) console.log("  it had no source record, so it was placed here by hand");
  if (result.wasDisabled) console.log(`  and dropped from "disabled" in ${paths.config}`);
  console.log("");
  return reinject();
}

/**
 * The one write command: inject into every installed version, say what moved since the baseline,
 * record the new one. `check` is its read-only half. `update` means plugins, in phase 4 (D55).
 */
function installCommand(args: string[]): number {
  const { values } = parseArgs({
    args,
    options: { ext: { type: "string" }, payload: { type: "string" } },
    allowPositionals: false,
  });
  return reinject({
    exts: values.ext ? [values.ext] : undefined,
    payloadDir: values.payload,
    required: true,
  });
}

/** The same roots `pluginOptions` discovers from, named for a report rather than for a loader. */
function listCommand(): number {
  const paths = riglinePaths();
  console.log(
    formatPlugins(
      listPlugins({
        roots: [
          { label: "this checkout", path: repoPluginsDir() },
          { label: paths.plugins, path: paths.plugins, managed: true },
        ],
        last: ["probe"],
        configPath: paths.config,
      }),
    ),
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

/**
 * The diagnostic collector (D53). Always exits 0: a machine with no VS Code logs, or none inside
 * the window, still gets an install-state report, and a person whose panel has just frozen should
 * not also have to work out why the tool that was meant to explain it failed.
 *
 * `--ext` and `--logs` point it at copies rather than at what is installed, which is how this gets
 * rehearsed against somebody else's log bundle without a test ever touching a live directory (D39).
 */
function doctorCommand(args: string[]): number {
  const { values } = parseArgs({
    args,
    options: { out: { type: "string" }, ext: { type: "string" } },
    allowPositionals: false,
  });

  const report = collect({ exts: values.ext ? [resolve(values.ext)] : undefined });
  const markdown = formatDoctor(report);

  if (values.out === undefined) {
    // Straight to stdout, unadorned, so `rigline doctor | clip` and `> doctor.md` both produce the
    // document and nothing else. Every other word this command has to say goes to stderr.
    process.stdout.write(markdown);
    return 0;
  }
  const out = resolve(values.out);
  writeFileSync(out, markdown);
  const versions = report.installs.length;
  console.log(`wrote ${out}: ${versions} extension ${versions === 1 ? "version" : "versions"}`);
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

/**
 * Where a harvest is committed: `generated.ts` in the directory the command was run from.
 *
 * The same rule for this repository and for an author's, which is the point — nothing here knows
 * it is being run inside Rigline's own checkout. It is the working directory rather than a path
 * derived from this file's location because the published CLI lives in `node_modules`, where a
 * relative walk upwards means nothing.
 */
function defaultGeneratedPath(): string {
  return resolve(process.cwd(), "generated.ts");
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

  // Asked before the `--check` branch and again after the write, because it is a verdict about the
  // anchor table and not about the file. Asking it only on the writing path let the one invocation
  // that runs unattended go green over it: codegen writes `generated.ts` and *then* fails, so a
  // maintainer who commits the file it just wrote leaves `--check` comparing equal and saying so.
  const ambiguous = reportAmbiguousAnchors(generated);

  if (values.check) {
    const current = existsSync(out) ? readFileSync(out, "utf8") : "";
    if (current !== generated.source) {
      console.log(`${label} is out of date for ${generated.tables.version}. Run: rigline codegen`);
      return 1;
    }
    console.log(`${label} is up to date for ${generated.tables.version}: ${generated.counts}`);
    return ambiguous ? 1 : 0;
  }

  writeFileSync(out, generated.source);
  console.log(`source: ${ext}`);
  console.log(`${generated.tables.version}: ${generated.counts}`);
  for (const module of generated.unreachableModules) {
    console.log(`  unreachable stylesheet module: ${module}`);
  }
  for (const name of generated.anchors.unverified) {
    console.log(`  unverified anchor: ${name} (its module's class map was never counted)`);
  }
  console.log(`wrote: ${label}`);
  return ambiguous ? 1 : 0;
}

/**
 * Name every anchor that claims to be one element and is not, and say whether there were any.
 *
 * The one thing codegen fails over that is not a broken harvest, and it fails *here* rather than at
 * install for a reason (D7): an ambiguous singleton means this repo's anchor table is wrong, the
 * repair is a refinement somebody can write today, and a maintainer is standing here reading this.
 * On a user's machine the same verdict is an attention line and a refusal of the plugins that
 * declared the anchor, because an upstream release that starts reusing a class is not a reason to
 * leave every other plugin uninjected.
 */
function reportAmbiguousAnchors(generated: Generated): boolean {
  if (generated.anchors.ambiguous.length === 0) return false;
  for (const { name, sites } of generated.anchors.ambiguous) {
    console.error(
      `  ambiguous anchor: ${name} names one element, and ${generated.tables.version} applies its class at ${sites} places`,
    );
  }
  console.error(
    "Refine each in packages/plugin-api/src/anchors.ts, or change its kind to collection if it was never one element.",
  );
  return true;
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

/** `--ext DIR`, for rehearsing against a copy rather than against what is installed (D39). */
function extOption(args: string[]): readonly string[] | undefined {
  const { values } = parseArgs({ args, options: { ext: { type: "string" } } });
  return values.ext ? [resolve(values.ext)] : undefined;
}

function checkCommand(args: string[]): number {
  const report = check({ exts: extOption(args), plugins: pluginOptions() });
  console.log(formatFlow(report));
  return report.attention.length > 0 ? 1 : 0;
}

/**
 * Runs until interrupted. Its exit code is the last report's, so a watcher stopped after an update
 * that needs a person still says so, and `rigline watch; echo $?` from a script is meaningful.
 */
function watchCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { interval: { type: "string" } },
    allowPositionals: false,
  });
  const seconds = values.interval === undefined ? 30 : Number(values.interval);
  if (!Number.isFinite(seconds) || seconds < 1) {
    throw new UserError(`--interval needs a number of seconds, got ${values.interval}`);
  }

  return new Promise((resolveWith) => {
    let code = 0;
    const watcher = watch({
      payloadDir: defaultPayloadDir(),
      plugins: pluginOptions(),
      codegen: true,
      intervalMs: seconds * 1000,
      onReport(report) {
        console.log(`
[${new Date().toISOString()}]`);
        console.log(formatFlow(report));
        code = report.attention.length > 0 ? 1 : 0;
      },
      onError(error) {
        // Reported and survived, never fatal: a harvest run against a directory VS Code is still
        // writing fails once and succeeds on the next pass, and a watcher that exits then is a
        // watcher that is never running when it is needed.
        console.error(`rigline watch: ${error instanceof Error ? error.message : String(error)}`);
        code = 1;
      },
    });
    console.log(`watching ${EXTENSIONS_DIR} every ${seconds}s; Ctrl-C to stop`);
    const stop = (): void => {
      watcher.stop();
      resolveWith(code);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

/**
 * The development loop: build, inject, and do it again on every source change.
 *
 * It rebuilds and re-injects rather than watching the injected copy, because a plugin's shipped
 * form is a directory the installer copies; there is nothing on the other side to watch. Re-running
 * the install refreshes the payload in place without rewriting the bundle, so the cost of a change
 * is a rebuild and a webview reload.
 */
async function dev(args: string[]): Promise<number> {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true });
  const dirs =
    positionals.length > 0
      ? positionals.map((d) => resolve(d))
      : readdirSync(repoPluginsDir(), { withFileTypes: true })
          .filter(
            (e) => e.isDirectory() && existsSync(join(repoPluginsDir(), e.name, "rigline.json")),
          )
          .map((e) => join(repoPluginsDir(), e.name));
  if (dirs.length === 0) throw new UserError("no plugin directories to develop");

  const exts = installedExtensions();
  if (exts.length === 0) throw new UserError("no Claude Code extension is installed");

  // `install`, `check` and `watch` read `~/.rigline/anchors.json` through the flow, which owns user
  // state. `dev` drives the installer directly, so it reads the file here: a development loop
  // resolving anchors differently from the install it stands in for is a difference nobody would
  // think to look for (D44).
  const overrides = readAnchorOverrides();
  for (const problem of overrides.problems) console.error(`rigline dev: ${problem}`);

  async function once(): Promise<void> {
    for (const dir of dirs) {
      const built = await buildPlugin({ dir });
      console.log(`built ${basename(dir)}: ${built.input} -> ${built.output}`);
    }
    let hostChanged = false;
    for (const ext of exts) {
      const report = install(ext, {
        payloadDir: defaultPayloadDir(),
        plugins: pluginOptions(),
        anchors: overrides,
      });
      hostChanged ||= report.hostChanged;
      for (const override of report.anchorOverrides) {
        console.log(`  anchor override ${override.name}: ${overrides.path}`);
      }
      for (const verdict of report.verdicts) {
        if (verdict.refusal) console.log(`  REFUSED ${verdict.plugin}: ${verdict.refusal}`);
      }
    }
    console.log(
      hostChanged
        ? "Developer: Reload Window (a host patch changed; this ends the window's sessions)"
        : "Developer: Reload Webviews",
    );
  }

  await once();

  // Debounced, because one editor save can be several filesystem events, and a rebuild racing its
  // own re-install would leave the payload half from each.
  let pending: NodeJS.Timeout | null = null;
  let building = false;
  const schedule = (): void => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      if (building) return;
      building = true;
      once()
        .catch((error: unknown) => {
          console.error(`rigline dev: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          building = false;
        });
    }, 150);
  };

  for (const dir of dirs) {
    const src = join(dir, "src");
    if (!existsSync(src)) continue;
    fsWatch(src, { recursive: true }, schedule);
  }
  console.log(
    `watching ${dirs.length} plugin source director${dirs.length === 1 ? "y" : "ies"}; Ctrl-C to stop`,
  );

  return new Promise((resolveWith) => {
    process.once("SIGINT", () => resolveWith(0));
    process.once("SIGTERM", () => resolveWith(0));
  });
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
    case "check":
      return checkCommand(rest);
    case "watch":
      return watchCommand(rest);
    case "dev":
      return dev(rest);
    case "add":
      return addCommand(rest);
    case "remove":
      return removeCommand(rest);
    case "list":
      return listCommand();
    case "status":
      return statusCommand();
    case "restore":
      return restoreCommand();
    case "doctor":
      return doctorCommand(rest);
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
      console.error(`rigline: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  },
);
