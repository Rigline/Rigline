/**
 * The engine's command surface: every verb that reads or drives an installed extension.
 *
 * Argument parsing and printing; the work belongs to the modules this calls. It is reached two
 * ways, and the usage below is written for the first: as `rigline`, through the wrapper, which
 * forwards every verb it does not own; and as `rigline-engine`, the bin core carries, which is what
 * the wrapper spawns and is not a surface anybody is asked to type.
 *
 * So the usage documents the whole `rigline` command rather than this file's `switch`, `update`
 * included — a person reading it wants the verbs they can type, not the boundary between two
 * packages. `update` is the one verb here that refuses rather than runs: an engine cannot replace
 * the package it is running out of, which is the whole reason there is a wrapper (D69).
 *
 * Every command throws `UserError` for a problem a person must fix and lets anything else propagate
 * with its stack, so a bug is never dressed up as advice.
 */
import { spawn } from "node:child_process";
import { existsSync, watch as fsWatch, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { placementLabel, placeName } from "@rigline/plugin-api";
import {
  type AddResult,
  addPlugin,
  bundledDir,
  bundledPluginsDir,
  COMPANION_RELOAD,
  CORE_VERSION,
  check,
  checkoutEngineNote,
  checkoutPluginsDir,
  collect,
  companionVsix,
  diffScans,
  discoverPlugins,
  EXTENSIONS_DIR,
  editorSpawn,
  enabledPlugins,
  extensionVersion,
  findExtension,
  formatDiff,
  formatDoctor,
  formatFlow,
  formatLayout,
  formatPlugins,
  formatSetup,
  type Generated,
  generate,
  harvestAll,
  hostVerdict,
  type InstallOptions,
  inspect,
  install,
  installedExtensions,
  listPlugins,
  orderInLayout,
  parseSource,
  parseWhere,
  placeInLayout,
  readAnchorOverrides,
  readBundles,
  readConfig,
  removePlugin,
  resetLayout,
  restoreAll,
  riglinePaths,
  saveFromPanel,
  scanOf,
  setPluginEnabled,
  setupCompanion,
  splitLegacyConfig,
  UserError,
  update,
  verdict,
  viewLayout,
  watch,
} from "../index.ts";
import { buildPlugin } from "./build.ts";

/** Set by the wrapper's `update` on each `add`, so the plugins move first and inject once (D98). */
const DEFER_INJECT = "RIGLINE_DEFER_INJECT";

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

  rigline install [--ext DIR] [--payload DIR] [--verbose]
      Inject the loader into every installed extension version (or DIR), baking the enabled
      plugins, and report which plugins each version loads and which it refuses. Any entry
      in ~/.rigline/anchors.json is applied and named, with what this version makes of it.
      What moved since the baseline is listed in ~/.rigline/drift.txt. Rewrites
      ./generated.ts when the directory has one and records the new baseline; never commits
      either. The report ends with what to reload, then anything that needs you. --verbose
      adds paths, harvest counts, each host patch and the full drift. Run it after an
      extension update. Exits 1 when a person is needed.

  rigline check [--ext DIR] [--verbose]
      Read-only. Per installed version (or DIR): whether it is injected and by which
      engine, which plugins it would refuse and by which identifier, which curated anchors
      it lacks, and what it makes of each entry in ~/.rigline/anchors.json. --verbose
      lists what moved since the baseline. Exits 1 when a person is needed.

  rigline watch [--interval SECONDS] [--verbose]
      install, and again whenever the set of installed extension directories changes,
      which is what an extension update looks like from outside VS Code.

  rigline dev [DIR...]
      Build the named plugin directories (or every first-party one), re-inject, and rebuild
      on every source change. Reload webviews after each one.

  rigline add PATH|SPEC [--now]
      Install a plugin into ~/.rigline/plugins, say what it can do, and re-inject. PATH is a
      directory; SPEC is an npm package, optionally @version or @tag. A published version
      must be a day old before it is installed; --now takes it anyway. No package manager
      runs, nothing is resolved, and none of the plugin's own code is evaluated.

  rigline update [NAME...] [--now] [--tag TAG]
      Move the engine, and each plugin installed from npm, to whatever its tag resolves to
      now, and re-inject. A plugin pinned to a version, added from a directory, or placed by
      hand is reported and left alone, as is a newer version too young to install. --tag
      follows a preview line instead of latest, for the engine.

  rigline remove NAME
      Delete a plugin rigline installed, and re-inject. A plugin you did not install this
      way, including one bundled in the engine, is switched off with disable instead.

  rigline disable NAME
  rigline enable NAME
      Switch a plugin off in ~/.rigline/config.yaml, or back on, and re-inject. This is how
      you decline one of the plugins bundled in the engine: there is nothing to delete, and
      an engine update would put it back.

  rigline layout
  rigline layout place ELEMENT WHERE
  rigline layout order WHERE ELEMENT...
  rigline layout reset
      Where every enabled plugin's elements are, by place, marking those your layout put
      there and where else each may go. place moves one element, written plugin/element, to
      WHERE: a zone such as rigRow, before, after or inside an anchor such as before
      footerSpacer, off, or default to put it back where its plugin puts it. order sets
      which elements come first in a place, in that order. reset empties the layout. Each
      edits ~/.rigline/config.yaml, keeping your comments, and re-injects.

  rigline list [--json]
      Every plugin found, in the order they load: its version, where it came from, whether
      it is switched off, and what its manifest says it can do. --json emits the same as data.

  rigline vscode-setup [--profile NAME] [--remove]
      Optional. Install the companion extension into every VS Code found on PATH — including
      Insiders, VSCodium, Cursor and Windsurf — from the VSIX bundled in this engine, and
      inject. Nothing is downloaded, and the companion moves when the engine does. From then
      on it re-injects after every extension update without you running anything, so it is a
      step instead of install rather than after it. Declining it costs nothing: install is
      complete on its own. --remove takes the companion out and leaves the injection alone.
      Reload the window afterwards.
      Extensions belong to a VS Code profile and this installs into the default one. If your
      workspace uses another, pass --profile with the name from VS Code's profile switcher,
      or the companion is installed, listed, and invisible to the window you are in. Copy the
      name rather than typing it: an unknown one makes a new empty profile instead of failing.

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

/**
 * Every discovery root, in precedence and load order (D56, D71).
 *
 * This checkout's `plugins/` when there is one, then `~/.rigline/plugins`, then the set bundled
 * inside the engine. The user's directory outranks the bundled set deliberately: a fork installed
 * over a bundled name wins, which is the escape hatch that repairs a broken first-party plugin
 * without waiting for a release.
 */
function discoveryRoots(): string[] {
  const checkout = checkoutPluginsDir();
  return [...(checkout === null ? [] : [checkout]), riglinePaths().plugins, bundledPluginsDir()];
}

/** Where plugins are discovered from, and which of them a person has turned off. */
function pluginOptions(): NonNullable<InstallOptions["plugins"]> {
  const paths = riglinePaths();
  return {
    roots: discoveryRoots(),
    last: ["probe"],
    bundledRoot: bundledPluginsDir(),
    configPath: paths.config,
    tokenPath: paths.token,
  };
}

/**
 * The roots `add` and `remove` must not touch, and which of them is the bundled set.
 *
 * `~/.rigline/plugins` is deliberately absent: a name already there is the plugin being replaced,
 * which is what re-adding one you are working on means.
 */
function foreignRoots(): { otherRoots: string[]; bundledRoot: string } {
  const bundledRoot = bundledPluginsDir();
  const checkout = checkoutPluginsDir();
  return {
    otherRoots: [...(checkout === null ? [] : [checkout]), bundledRoot],
    bundledRoot,
  };
}

/**
 * Every first-party plugin's source directory, for the development loop's default.
 *
 * Empty outside this checkout, where `dev` then says there is nothing to develop — which is the
 * honest answer: a published install has the plugins' built output and none of their source, so
 * there is nothing there a rebuild could act on.
 */
function firstPartyPlugins(): string[] {
  const root = checkoutPluginsDir();
  if (root === null) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, "rigline.json")))
    .map((e) => join(root, e.name));
}

interface ReinjectOptions {
  readonly exts?: readonly string[];
  readonly payloadDir?: string;
  /** Refuse rather than shrug when nothing is installed: what `install`, asked outright, should do. */
  readonly required?: boolean;
  readonly verbose?: boolean;
  /** The reload line, when the command has a reason of its own for one. */
  readonly reload?: string;
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
    if (options.reload !== undefined) console.log(`\n${options.reload}`);
    return 0;
  }
  const report = update({
    exts: targets,
    payloadDir: options.payloadDir ?? bundledDir(),
    plugins: pluginOptions(),
    // Only where the directory already has one; this never creates a harvest for somebody who has
    // not asked for one, and it never commits what it rewrites (D30).
    codegen: true,
  });
  console.log(
    formatFlow(report, {
      ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
      ...(options.reload === undefined ? {} : { reload: options.reload }),
    }),
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
  const { values, positionals } = parseArgs({
    args,
    options: { source: { type: "string" } },
    allowPositionals: true,
  });
  if (positionals.length !== 1) throw new UserError("add needs exactly one plugin directory");

  const from = positionals[0] as string;
  if (!isPathSpec(from)) {
    // Reached only by somebody running `rigline-engine` directly, because the wrapper turns a spec
    // into a path before it gets here (D70). Saying which command owns the other half beats
    // "no such directory" about a string that was never meant to be one.
    throw new UserError(
      `"${from}" is not a directory. The engine's \`add\` takes a path; \`rigline add ${from}\` ` +
        "is what fetches, checks and stages a published plugin before handing it over.",
    );
  }

  const paths = riglinePaths();
  const result: AddResult = addPlugin({
    from,
    pluginsDir: paths.plugins,
    configPath: paths.config,
    sourcesPath: paths.sources,
    ...foreignRoots(),
    // Where the bytes came from, when somebody other than this command established it (D74). The
    // wrapper passes what it resolved; a person pointing at a directory passes nothing and gets a
    // `path` source.
    ...(values.source === undefined ? {} : { source: parseSource(values.source) }),
  });

  console.log(`${result.replaced ? "replaced" : "added"} ${result.name} — ${result.dir}`);
  console.log(`  from ${result.from}`);
  // The moment it means something. `~/.rigline/plugins` outranks the bundled set, so this plugin
  // has just taken a first-party name and the copy inside the engine will not load while it is
  // here — which is the point of being allowed to do it, and worth saying out loud once (D71).
  if (result.overridesBundled) {
    console.log(`  it overrides the ${result.name} bundled in the engine, which will not load`);
  }
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
  // `add` is the one command that installs somebody's judgement rather than ours, including the
  // user's own on a plugin they wrote for themselves (D79).
  console.log(
    "  your call, not Rigline's: it runs with the trust listed above, and Anthropic's terms",
  );
  console.log(
    "  apply to what it does — https://github.com/Rigline/Rigline/blob/main/docs/plugin-policy.md",
  );
  // `rigline update` injects once, after every plugin has moved (D98).
  if (process.env[DEFER_INJECT] === "1") return 0;
  console.log("");
  return reinject();
}

/**
 * Whether this is a directory rather than an npm package.
 *
 * The same rule every package manager uses, said out loud: a leading dot or a path separator, or a
 * directory that is simply there. An npm name cannot hold a separator except the one in a scope,
 * and a scope starts with `@`, so the two vocabularies do not overlap.
 */
function isPathSpec(spec: string): boolean {
  if (spec.startsWith("@")) return false;
  if (spec.startsWith(".") || spec.includes("/") || spec.includes("\\")) return true;
  return existsSync(join(resolve(spec), "rigline.json"));
}

/**
 * Refuses, and says which command owns it (D69).
 *
 * A process cannot replace the package it is running out of, so `update` belongs to the wrapper
 * above this one. Reachable only by running `rigline-engine` directly.
 */
function updateCommand(): number {
  throw new UserError(
    "`update` belongs to the rigline command, not the engine: it replaces this engine, and a " +
      "process cannot replace what it is running out of. Run `rigline update`.",
  );
}

/**
 * `disable NAME` and `enable NAME`: the only way to decline a bundled plugin (D71, D72).
 *
 * Both re-inject, for the reason `add` and `remove` do (D56): the registry is baked at install
 * time, so nothing changes until the payload is rewritten, and a person who switched a plugin off
 * should not have to know about a second command before it goes.
 */
function switchCommand(args: string[], enabled: boolean): number {
  const verb = enabled ? "enable" : "disable";
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true });
  if (positionals.length !== 1) throw new UserError(`${verb} needs exactly one plugin name`);

  const paths = riglinePaths();
  const result = setPluginEnabled(
    { name: positionals[0] as string, configPath: paths.config, roots: discoveryRoots() },
    enabled,
  );
  console.log(
    result.changed
      ? `${enabled ? "enabled" : "disabled"} ${result.name} in ${result.configPath}`
      : `${result.name} was already ${enabled ? "enabled" : "switched off"} in ${result.configPath}`,
  );
  console.log("");
  return reinject();
}

/**
 * `layout`, which prints, and `layout place`, `order` and `reset`, which edit `config.yaml` and
 * re-inject for the reason `enable` does (D56, D92).
 */
function layoutCommand(args: string[]): number {
  const [verb, ...rest] = args;
  const paths = riglinePaths();
  const discovered = discoverPlugins(discoveryRoots(), {
    last: ["probe"],
    bundledRoot: bundledPluginsDir(),
  });
  if (verb === undefined) {
    const config = readConfig(paths.config);
    console.log(formatLayout(viewLayout(enabledPlugins(discovered, config), config)));
    return 0;
  }

  if (verb === "place") {
    const [name, ...where] = rest;
    if (name === undefined) throw new UserError("layout place needs an element and a place");
    const result = placeInLayout(paths.config, discovered, name, parseWhere(where));
    const at = result.placement === null ? "off" : placementLabel(result.placement);
    console.log(
      !result.changed
        ? `${paths.config} already says that`
        : result.isDefault
          ? `${name} goes where its plugin puts it: ${at}`
          : result.placement === null
            ? `${name} is switched off`
            : `${name} goes ${at}`,
    );
  } else if (verb === "order") {
    // A place may be two words and an element always has a slash, so the first slash ends it.
    const split = rest.findIndex((arg) => arg.includes("/"));
    const where = parseWhere(split === -1 ? rest : rest.slice(0, split));
    if (where === "default") {
      throw new UserError(
        "order fills a place, and default is not one: `layout place ELEMENT default` puts one back",
      );
    }
    const names = split === -1 ? [] : rest.slice(split);
    const changed = orderInLayout(paths.config, discovered, where, names);
    console.log(
      changed ? `${placeName(where)}: ${names.join(", ")}` : `${paths.config} already says that`,
    );
  } else if (verb === "reset") {
    if (rest.length > 0) {
      throw new UserError(
        "reset empties the whole layout; `layout place ELEMENT default` puts one back",
      );
    }
    console.log(
      resetLayout(paths.config)
        ? `emptied the layout in ${paths.config}`
        : `${paths.config} has no layout`,
    );
  } else if (verb === "save") {
    // The companion's, with a panel's Save link (D93), so the help leaves it out. The first line is
    // the outcome the companion shows.
    if (rest.length !== 1)
      throw new UserError("layout save takes the payload of a panel's Save link");
    const saved = saveFromPanel(paths.config, paths.token, rest[0] as string);
    console.log(
      !saved.changed
        ? `${paths.config} already held the panel's layout`
        : saved.overChange
          ? `saved the panel's layout to ${paths.config}, over a change made since the panel loaded`
          : `saved the panel's layout to ${paths.config}`,
    );
  } else {
    throw new UserError(`unknown layout command "${verb}": place, order or reset`);
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
    sourcesPath: paths.sources,
    ...foreignRoots(),
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
    options: {
      ext: { type: "string" },
      payload: { type: "string" },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  return reinject({
    exts: values.ext ? [values.ext] : undefined,
    payloadDir: values.payload,
    required: true,
    verbose: values.verbose,
  });
}

/** The same roots `pluginOptions` discovers from, named for a report rather than for a loader. */
function listCommand(args: string[]): number {
  const { values } = parseArgs({ args, options: { json: { type: "boolean", default: false } } });
  const paths = riglinePaths();
  const checkout = checkoutPluginsDir();
  const listings = listPlugins({
    roots: [
      ...(checkout === null ? [] : [{ label: "this checkout", path: checkout }]),
      { label: paths.plugins, path: paths.plugins, managed: true },
      { label: "bundled", path: bundledPluginsDir(), bundled: true },
    ],
    last: ["probe"],
    configPath: paths.config,
    sourcesPath: paths.sources,
  });
  // `--json` is how the wrapper learns what `update` can move: `sources.json` is the engine's, so
  // the wrapper asks rather than reads (D74).
  console.log(values.json ? JSON.stringify(listings) : formatPlugins(listings));
  return 0;
}

/**
 * `vscode-setup`: put the companion into every editor on PATH, from the VSIX we already carry.
 *
 * The engine's rather than the wrapper's, on two counts. It is the half that carries
 * `dist/bundled`, and the wrapper holds no verb list (D69), so this reaches a user through an
 * engine update with no wrapper release.
 */
async function vscodeSetupCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      remove: { type: "boolean", default: false },
      profile: { type: "string" },
    },
    allowPositionals: false,
  });
  if (values.profile !== undefined && values.profile.trim() === "") {
    // An empty name would reach the CLI as one, and VS Code makes a profile out of whatever it is
    // given rather than refusing — so the silent outcome is a junk profile nobody asked for.
    throw new UserError("--profile needs a profile name");
  }

  const outcomes = await setupCompanion({
    remove: values.remove,
    ...(values.profile === undefined ? {} : { profile: values.profile }),
    run: async (command, argv) => {
      const child = spawn(...editorSpawn(command, argv));
      let output = "";
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        output += chunk;
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        output += chunk;
      });
      return await new Promise((done, fail) => {
        child.on("error", fail);
        child.on("close", (code) => done({ code: code ?? 1, output }));
      });
    },
  });

  console.log(
    formatSetup(
      outcomes,
      values.remove,
      values.remove ? undefined : companionVsix(),
      values.profile,
    ),
  );
  if (!values.remove && outcomes.some((o) => o.code === 0) && checkoutPluginsDir() !== null) {
    console.log(checkoutEngineNote(fileURLToPath(new URL("bin.js", import.meta.url))));
  }
  const failed = outcomes.some((o) => o.code !== 0) ? 1 : 0;

  // And inject, on `add`'s rule (D55, D56): a command that changes what is installed re-injects, so
  // the user is one reload away rather than one reload and a command they have to know about.
  //
  // It matters more here than anywhere else. The companion injects on activation, but it activates
  // only after the reload, by which time the panel may already have rendered from an unpatched
  // bundle — so without this the first reload is the one that does not work, on the one path that
  // exists so nobody has to think about reloading. `install` stays the verb; this is the same work
  // done at the moment somebody would otherwise have to be told about it.
  if (values.remove) return failed;
  console.log("");
  const installed = outcomes.some((o) => o.code === 0);
  return reinject(installed ? { reload: COMPANION_RELOAD } : {}) === 0 ? failed : 1;
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
  let noBackup = 0;
  let hostFailed = 0;
  for (const result of results) {
    if (result.restored) console.log(`restored: ${result.ext}`);
    else {
      noBackup++;
      console.log(`NOT restored: ${result.ext} (${result.reason})`);
    }
    // Reported whichever way the webview side went: an extension host still carrying a
    // substitution is the failure a person must know about, and it is invisible from the panel.
    if (result.hostReason) {
      hostFailed++;
      console.log(`  extension.js NOT restored: ${result.hostReason}`);
    }
  }
  if (noBackup > 0) {
    console.log(
      "\nA version without a backup is recovered by uninstalling and reinstalling Claude Code from the Extensions view.",
    );
  }
  if (hostFailed > 0) {
    console.log(
      "\nAn extension.js left patched still runs the substitution a plugin declared. Reinstalling Claude Code from the Extensions view replaces it.",
    );
  }
  console.log("Reload the window afterwards.");
  return noBackup + hostFailed > 0 ? 1 : 0;
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

/** `--ext DIR` rehearses against a copy rather than against what is installed (D39). */
function checkCommand(args: string[]): number {
  const { values } = parseArgs({
    args,
    options: { ext: { type: "string" }, verbose: { type: "boolean", default: false } },
  });
  const report = check({
    exts: values.ext ? [resolve(values.ext)] : undefined,
    plugins: pluginOptions(),
  });
  console.log(formatFlow(report, { verbose: values.verbose }));
  return report.attention.length > 0 ? 1 : 0;
}

/**
 * Runs until interrupted. Its exit code is the last report's, so a watcher stopped after an update
 * that needs a person still says so, and `rigline watch; echo $?` from a script is meaningful.
 */
function watchCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { interval: { type: "string" }, verbose: { type: "boolean", default: false } },
    allowPositionals: false,
  });
  const seconds = values.interval === undefined ? 30 : Number(values.interval);
  if (!Number.isFinite(seconds) || seconds < 1) {
    throw new UserError(`--interval needs a number of seconds, got ${values.interval}`);
  }

  return new Promise((resolveWith) => {
    let code = 0;
    const watcher = watch({
      payloadDir: bundledDir(),
      plugins: pluginOptions(),
      codegen: true,
      intervalMs: seconds * 1000,
      onReport(report) {
        console.log(`
[${new Date().toISOString()}]`);
        console.log(formatFlow(report, { verbose: values.verbose }));
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
  const dirs = positionals.length > 0 ? positionals.map((d) => resolve(d)) : firstPartyPlugins();
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
        payloadDir: bundledDir(),
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

/**
 * The verbs that read `config.yaml` or `sources.json`, each of which splits a `config.json` first.
 * Not every verb: `pnpm build` runs `rigline-engine build` in each first-party plugin at once, against
 * the developer's own `~/.rigline`.
 */
const SETTINGS_VERBS = new Set([
  "install",
  "check",
  "watch",
  "dev",
  "add",
  "remove",
  "disable",
  "enable",
  "list",
  "layout",
  "vscode-setup",
]);

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== undefined && SETTINGS_VERBS.has(command)) {
    const paths = riglinePaths();
    // On stderr, so `list --json` and `doctor` still print only what they are for.
    const split = splitLegacyConfig({
      config: paths.config,
      sources: paths.sources,
      legacy: paths.legacyConfig,
    });
    if (split !== null) console.error(`rigline: ${split}`);
  }
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
    case "update":
      return updateCommand();
    case "remove":
      return removeCommand(rest);
    case "disable":
      return switchCommand(rest, false);
    case "enable":
      return switchCommand(rest, true);
    case "list":
      return listCommand(rest);
    case "layout":
      return layoutCommand(rest);
    case "vscode-setup":
      return vscodeSetupCommand(rest);
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

/**
 * Run one command and answer with its exit code, never by exiting the process.
 *
 * The entry point both bins call, and the one a consumer that is not a terminal would call too —
 * the companion extension in plan.md phase 5 drives this surface without being able to exit.
 * A `UserError` is a problem a person must fix, so it is printed and becomes a 1; anything else is
 * a bug and keeps its stack.
 */
export async function runEngine(argv: readonly string[]): Promise<number> {
  try {
    return await main([...argv]);
  } catch (error) {
    if (error instanceof UserError) {
      console.error(`rigline: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
