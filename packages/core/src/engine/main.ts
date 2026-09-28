/**
 * The engine's command surface: every verb that reads or drives an installed extension.
 *
 * Argument parsing and printing; the work belongs to the modules this calls. It is reached two
 * ways, and the usage below is written for the first: as `rigline`, through the wrapper, which
 * forwards every verb it does not own; and as `rigline-engine`, the bin core carries, which is what
 * the wrapper spawns and is not a surface anybody is asked to type.
 *
 * So the usage documents the whole `rigline` command rather than this file's `switch` — a person
 * reading it wants the verbs they can type, not the boundary between two packages. `update` is
 * documented whole though this file does only its second half: an engine cannot replace the package
 * it is running out of, so the wrapper moves the engine first and then runs this one (D69, D106).
 *
 * Every command throws `UserError` for a problem a person must fix and lets anything else propagate
 * with its stack, so a bug is never dressed up as advice.
 */
import { spawn } from "node:child_process";
import { existsSync, watch as fsWatch, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { placementLabel, placeName } from "@rigline/plugin-api/internal";
import {
  type Additions,
  type AddResult,
  addFromNpm,
  addPlugin,
  addToList,
  addWhereMissing,
  bundledDir,
  bundledPluginsDir,
  COMPANION_RELOAD,
  CORE_VERSION,
  carriedCompanion,
  check,
  checkoutEngineNote,
  checkoutPluginsDir,
  clearLeftovers,
  clearRestored,
  collect,
  companionStatus,
  companionVsix,
  describeSource,
  diffScans,
  discoverPlugins,
  type EditorCli,
  type EditorContext,
  EXTENSIONS_DIR,
  editConfig,
  editorDirs,
  editorSpawn,
  enabledPlugins,
  extensionVersion,
  findEditors,
  findExtension,
  formatDiff,
  formatDoctor,
  formatFlow,
  formatLayout,
  formatPlugins,
  formatSetup,
  formatUpdates,
  type Generated,
  generate,
  harvestAll,
  hostVerdict,
  type InjectionLockOptions,
  type InstallOptions,
  inspect,
  install,
  installedExtensions,
  listJson,
  listPlugins,
  markRestored,
  orderInLayout,
  type Placement,
  type PluginListing,
  parseWhere,
  placeInLayout,
  type RiglinePaths,
  readAnchorOverrides,
  readBundles,
  readCompanionSettings,
  readConfig,
  removeFromList,
  removePlugin,
  resetLayout,
  restoreAll,
  riglinePaths,
  SKIP_PROFILES,
  saveFromPanel,
  scanOf,
  setPluginEnabled,
  setupCompanion,
  splitLegacyConfig,
  UserError,
  update,
  updatePlugins,
  verdict,
  viewLayout,
  watch,
  withInjectionLock,
} from "../index.ts";
import { buildPlugin } from "./build.ts";

/** A wait on the injection lock goes to stderr, so stdout stays the report (D105). */
const lockWait: InjectionLockOptions = {
  onWait: (line) => console.error(`rigline: ${line}`),
};

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

  rigline install [--ext DIR] [--verbose]
      Inject the loader into every installed extension version (or DIR), baking the enabled
      plugins, and report which plugins each version loads and which it refuses. Any entry
      in ~/.rigline/anchors.json is applied and named, with what this version makes of it.
      What moved since the baseline is listed in ~/.rigline/drift.txt. Rewrites the
      ./generated.ts rigline codegen wrote, when the directory has one, and records the new
      baseline; never commits either. The report ends with what to reload, then anything that needs you. --verbose
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

  rigline dev DIR...
      Build each plugin directory, install it as add does, and re-inject; then again on
      every source change. Reload webviews after each one. The last build stays installed
      when it stops.

  rigline add PATH|SPEC [--now]
      Install a plugin into ~/.rigline/plugins, say what it can do, and re-inject. PATH is a
      directory; SPEC is an npm package, optionally @version or @tag. A published version
      must be a day old before it is installed; --now takes it anyway. No package manager
      runs, nothing is resolved, and none of the plugin's own code is evaluated.

  rigline update [NAME...] [--now] [--tag TAG]
      Move the engine, and each plugin installed from npm, to whatever its tag resolves to
      now, and re-inject. A plugin pinned to a version, added from a directory, or placed by
      hand is reported and left alone, as is a newer version too young to install. --tag
      follows a preview line instead of latest, for the engine. Where the companion is
      installed, it is added to any VS Code profile that has Claude Code without it.

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
      Optional. Install the companion extension into VS Code, found on PATH, from the VSIX
      bundled in this engine, and inject. Nothing is downloaded, and the companion moves when
      the engine does. From then on it re-injects after every extension update without you
      running anything, so it is a step instead of install rather than after it, and it asks
      npm's registry for a newer engine each time a window starts. Declining it costs
      nothing: install is complete on its own. --remove takes the companion out and leaves
      the injection alone. Reload the window afterwards.
      It goes into every VS Code profile that has Claude Code, and is added to any profile
      that gets Claude Code later. --profile NAME installs into that profile alone; with
      --remove it takes the companion out of that one and keeps it out. The companion block
      in ~/.rigline/config.yaml says the same by hand: skipProfiles, and everyProfile: false
      for the default profile only.

  rigline status
      Per installed version: is each bundle vanilla or patched, judged against its backup.

  rigline restore
      Every installed version back to the extension's own bytes. Needs neither VS Code nor
      the extension to be working. Rigline then stays out, and the companion does not put it
      back, until you run install or another command that injects.

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
  /** Refuse rather than shrug when nothing is installed: what `install`, asked outright, should do. */
  readonly required?: boolean;
  readonly verbose?: boolean;
  /** The reload line, when the command has a reason of its own for one. */
  readonly reload?: string;
  /** Run by the companion, which a `restore` keeps out until a person injects (D111). */
  readonly companion?: boolean;
}

/** A person's injection puts Rigline back after a `restore`, and says so (D111). */
function putBack(): void {
  if (clearRestored(riglinePaths().restored)) {
    console.log("Rigline was out since `rigline restore`; this puts it back.");
  }
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
  if (!options.companion) putBack();
  const targets = options.exts ?? installedExtensions();
  if (targets.length === 0) {
    if (options.required) throw new UserError("no Claude Code extension is installed");
    console.log("No Claude Code extension is installed, so nothing was injected.");
    if (options.reload !== undefined) console.log(`\n${options.reload}`);
    return 0;
  }
  const report = update({
    // Listed again under the lock, since a wait is time for the listing to change (D105).
    exts: options.exts,
    payloadDir: bundledDir(),
    plugins: pluginOptions(),
    // Only where the directory already has one; this never creates a harvest for somebody who has
    // not asked for one, and it never commits what it rewrites (D30).
    codegen: true,
    lock: lockWait,
    ...(options.companion ? { restoredMark: riglinePaths().restored } : {}),
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
 * Installs a plugin from a directory or from npm. No package manager runs (D47): a plugin is a
 * manifest and a built module, and everything `add` does is around the copy rather than inside it.
 */
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
  const paths = riglinePaths();
  const add = placement(paths);
  const result = isPathSpec(spec)
    ? addPlugin({ from: spec, ...add })
    : await addFromNpm(spec, { add, registry: { ignoreReleaseAge: values.now } });
  reportAdded(result, paths.config);
  console.log("");
  return reinject();
}

/** Where `add` puts a plugin, and the roots it must not take a name from (D56). */
function placement(paths: RiglinePaths): Placement {
  return {
    pluginsDir: paths.plugins,
    configPath: paths.config,
    sourcesPath: paths.sources,
    ...foreignRoots(),
  };
}

/**
 * What a plugin just added can do, printed because this is the moment it means something (D26):
 * installing a plugin is the act that says yes, and nothing after it asks again.
 */
function reportAdded(result: AddResult, configPath: string): void {
  console.log(`${result.replaced ? "replaced" : "added"} ${result.name} — ${result.dir}`);
  console.log(`  from ${describeSource(result.source)}`);
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
      `  "${result.name}" is switched off in ${configPath}, so it will not load until you remove it from "disabled"`,
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
 * Everything `update` does after the wrapper has moved the engine (D106): each plugin from npm to
 * what its tag resolves to, the companion wherever it is missing (D100), then one install (D98).
 *
 * The install runs whether or not anything moved here, since the wrapper may just have moved this
 * engine, and an install that changes nothing writes nothing (D75).
 */
async function updateCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { now: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  const paths = riglinePaths();
  const updates = await updatePlugins({
    listed: listing(paths),
    add: placement(paths),
    registry: { ignoreReleaseAge: values.now },
    ...(positionals.length > 0 ? { names: positionals } : {}),
    onAdded: (result) => {
      reportAdded(result, paths.config);
      console.log("");
    },
  });
  console.log(formatUpdates(updates));
  for (const line of (await companionAdditions({})).lines) console.log(line);

  console.log("");
  const injected = reinject();
  return updates.some((u) => u.outcome === "failed") || injected !== 0 ? 1 : 0;
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
  return reinject({ companion: verb === "save" });
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
      verbose: { type: "boolean", default: false },
      // The companion's, so the usage leaves it out (D111).
      companion: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  return reinject({
    exts: values.ext ? [values.ext] : undefined,
    required: true,
    verbose: values.verbose,
    companion: values.companion,
  });
}

/** The same roots `pluginOptions` discovers from, named for a report rather than for a loader. */
function listing(paths: RiglinePaths, refuse?: (line: string) => void): PluginListing[] {
  const checkout = checkoutPluginsDir();
  return listPlugins({
    roots: [
      ...(checkout === null ? [] : [{ role: "checkout" as const, path: checkout }]),
      { role: "home", path: paths.plugins },
      { role: "bundled", path: bundledPluginsDir() },
    ],
    last: ["probe"],
    configPath: paths.config,
    sourcesPath: paths.sources,
    ...(refuse === undefined ? {} : { refuse }),
  });
}

function listCommand(args: string[]): number {
  const { values } = parseArgs({ args, options: { json: { type: "boolean", default: false } } });
  const unloaded: string[] = [];
  const listings = listing(riglinePaths(), (line) => unloaded.push(line));
  console.log(values.json ? JSON.stringify(listJson(listings)) : formatPlugins(listings));
  // On stderr, so `--json` stays data. `check` is what exits 1 for it.
  for (const line of unloaded) console.error(line);
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
  const profile = values.profile;
  if (profile !== undefined && profile.trim() === "") {
    // The CLI reads an empty name as none, so this would quietly act on the default profile.
    throw new UserError("--profile needs a profile name");
  }

  const paths = riglinePaths();
  const outcomes = await setupCompanion({
    remove: values.remove,
    ...(profile === undefined ? {} : { profile }),
    settings: readCompanionSettings(paths.config),
    run: (command, argv) => runEditor({ command, prefix: [] }, argv),
  });

  // A profile removed by name stays out of every later look, and one installed by name comes back in
  // (D100).
  const skipChanged =
    profile !== undefined &&
    editConfig(paths.config, (doc) =>
      values.remove
        ? addToList(doc, SKIP_PROFILES, profile)
        : removeFromList(doc, SKIP_PROFILES, profile),
    );
  const note = !skipChanged
    ? undefined
    : values.remove
      ? `added "${profile}" to companion.skipProfiles in ${paths.config}, so it is not added back`
      : `took "${profile}" off companion.skipProfiles in ${paths.config}`;
  console.log(
    formatSetup(outcomes, values.remove, values.remove ? undefined : companionVsix(), note),
  );
  const results = outcomes.flatMap((o) => o.results);
  const installed = results.some((r) => r.code === 0);
  if (!values.remove && installed && checkoutPluginsDir() !== null) {
    console.log(checkoutEngineNote(fileURLToPath(new URL("bin.js", import.meta.url))));
  }
  const failed = results.some((r) => r.code !== 0) ? 1 : 0;

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
  return reinject(installed ? { reload: COMPANION_RELOAD } : {}) === 0 ? failed : 1;
}

/** Runs one editor's CLI and collects everything it said. */
async function runEditor(
  cli: EditorCli,
  argv: readonly string[],
): Promise<{ code: number; output: string }> {
  const [command, args, options] = editorSpawn(cli.command, [...cli.prefix, ...argv]);
  const child = spawn(command, args, {
    ...options,
    ...(cli.env === undefined ? {} : { env: { ...process.env, ...cli.env } }),
  });
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
}

/**
 * `companion-profiles`: adds the companion wherever it is missing, as JSON on stdout (D100). Hidden,
 * like `companion-status`. The companion names its own editor exactly.
 */
async function companionProfilesCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      "user-data-dir": { type: "string" },
      "extensions-dir": { type: "string" },
      "cli-node": { type: "string" },
      "cli-script": { type: "string" },
    },
    allowPositionals: false,
  });
  console.log(JSON.stringify(await companionAdditions(values)));
  return 0;
}

interface EditorNamed {
  "user-data-dir"?: string | undefined;
  "extensions-dir"?: string | undefined;
  "cli-node"?: string | undefined;
  "cli-script"?: string | undefined;
}

/** The companion added wherever it is missing, in the editor named, or with none every one on PATH. */
async function companionAdditions(values: EditorNamed): Promise<Additions> {
  try {
    return await addWhereMissing({
      contexts: additionContexts(values),
      settings: readCompanionSettings(riglinePaths().config),
      carried: carriedCompanion(),
      run: runEditor,
    });
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    return { v: 1, lines: [`added the companion to no profile: ${error.message}`], failed: true };
  }
}

function additionContexts(values: EditorNamed): EditorContext[] {
  const {
    "user-data-dir": userData,
    "extensions-dir": extensionsDir,
    "cli-node": node,
    "cli-script": script,
  } = values;
  const none = [userData, extensionsDir, node, script].every((value) => value === undefined);
  if (none) {
    return findEditors().map((editor) => ({
      label: editor.label,
      ...editorDirs(editor),
      cli: { command: editor.path, prefix: [] },
    }));
  }
  if (
    userData === undefined ||
    extensionsDir === undefined ||
    node === undefined ||
    script === undefined
  ) {
    throw new UserError(
      "companion-profiles takes all of --user-data-dir, --extensions-dir, --cli-node and " +
        "--cli-script, or none",
    );
  }
  // What the `code` shim runs, pointed at the instance the companion is running in.
  return [
    {
      label: "",
      userData,
      extensionsDir,
      cli: {
        command: node,
        prefix: [script, "--user-data-dir", userData, "--extensions-dir", extensionsDir],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      },
    },
  ];
}

/**
 * `companion-status PATH`: the companion's, as `layout save` is, so the usage leaves it out. Whether
 * the companion in `PATH` is the one this engine carries, as JSON on stdout (D99).
 */
function companionStatusCommand(args: string[]): number {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true });
  if (positionals.length !== 1) {
    throw new UserError("companion-status takes the companion's own directory");
  }
  console.log(JSON.stringify(companionStatus(resolve(positionals[0] as string))));
  return 0;
}

function statusCommand(args: string[]): number {
  parseArgs({ args, options: {}, allowPositionals: false });
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

function restoreCommand(args: string[]): number {
  // Strict, so a flag a later 1.x gives `restore` is refused here rather than restoring everything.
  parseArgs({ args, options: {}, allowPositionals: false });
  const { results, cleared } = withInjectionLock({ ...lockWait, what: "rigline restore" }, () => {
    // Under the lock, so a companion install waiting on it finds the mark (D111).
    markRestored(riglinePaths().restored);
    return { results: restoreAll(installedExtensions()), cleared: clearLeftovers() };
  });
  for (const dir of cleared) {
    console.log(`removed: ${dir} (left by an install after VS Code deleted that version)`);
  }
  let notRestored = 0;
  let hostFailed = 0;
  for (const result of results) {
    if (result.restored) {
      console.log(`restored: ${result.ext}${result.note === undefined ? "" : ` (${result.note})`}`);
    } else {
      notRestored++;
      console.log(`NOT restored: ${result.ext} (${result.reason})`);
    }
    // Reported whichever way the webview side went: an extension host still carrying a
    // substitution is the failure a person must know about, and it is invisible from the panel.
    if (result.hostReason) {
      hostFailed++;
      console.log(`  extension.js NOT restored: ${result.hostReason}`);
    }
  }
  if (notRestored > 0) {
    console.log(
      "\nA version not restored is recovered by uninstalling and reinstalling Claude Code from the Extensions view.",
    );
  }
  if (hostFailed > 0) {
    console.log(
      "\nAn extension.js left patched still runs the substitution a plugin declared. Reinstalling Claude Code from the Extensions view replaces it.",
    );
  }
  console.log("Rigline stays out, whatever reloads or updates, until you run `rigline install`.");
  console.log("Reload the window afterwards.");
  return notRestored + hostFailed > 0 ? 1 : 0;
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
    lock: lockWait,
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
  putBack();

  return new Promise((resolveWith) => {
    let code = 0;
    const watcher = watch({
      payloadDir: bundledDir(),
      plugins: pluginOptions(),
      codegen: true,
      lock: lockWait,
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
  putBack();

  // `install`, `check` and `watch` read `~/.rigline/anchors.json` through the flow, which owns user
  // state. `dev` drives the installer directly, so it reads the file here: a development loop
  // resolving anchors differently from the install it stands in for is a difference nobody would
  // think to look for (D44).
  const overrides = readAnchorOverrides();
  for (const problem of overrides.problems) console.error(`rigline dev: ${problem}`);

  // One already in a discovery root loads from where it is; any other is added after each build, so
  // stopping leaves the latest build installed (D56).
  const paths = riglinePaths();
  const roots = discoveryRoots();
  const added = dirs.filter((dir) => !roots.some((root) => samePath(dirname(dir), root)));
  let reported = false;

  async function once(): Promise<void> {
    for (const dir of dirs) {
      const built = await buildPlugin({ dir });
      console.log(`built ${basename(dir)}: ${built.input} -> ${built.output}`);
    }
    const hostChanged = withInjectionLock({ ...lockWait, what: "rigline dev" }, () => {
      for (const dir of added) {
        const result = addPlugin({ from: dir, ...placement(paths) });
        if (reported) console.log(`refreshed ${result.name} in ${result.dir}`);
        else reportAdded(result, paths.config);
      }
      reported = true;
      let changed = false;
      for (const ext of exts) {
        const report = install(ext, {
          payloadDir: bundledDir(),
          plugins: pluginOptions(),
          anchors: overrides,
        });
        changed ||= report.hostChanged;
        for (const override of report.anchorOverrides) {
          console.log(`  anchor override ${override.name}: ${overrides.path}`);
        }
        for (const verdict of report.verdicts) {
          if (verdict.refusal) console.log(`  REFUSED ${verdict.plugin}: ${verdict.refusal}`);
        }
      }
      return changed;
    });
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

  const watchers = dirs
    .map((dir) => join(dir, "src"))
    .filter((src) => existsSync(src))
    .map((src) => fsWatch(src, { recursive: true }, schedule));
  console.log(
    `watching ${dirs.length} plugin source director${dirs.length === 1 ? "y" : "ies"}; Ctrl-C to stop`,
  );

  // The watchers are closed, since an open one keeps the process alive past the first Ctrl-C.
  return new Promise((resolveWith) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      for (const watcher of watchers) watcher.close();
      if (pending) clearTimeout(pending);
      resolveWith(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

/** Whether two paths name the same directory, case-blind where the default filesystem is. */
function samePath(a: string, b: string): boolean {
  const [x, y] = [resolve(a), resolve(b)];
  return process.platform === "win32" || process.platform === "darwin"
    ? x.toLowerCase() === y.toLowerCase()
    : x === y;
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
  "update",
  "remove",
  "disable",
  "enable",
  "list",
  "layout",
  "vscode-setup",
  "companion-profiles",
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
      return updateCommand(rest);
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
    case "companion-status":
      return companionStatusCommand(rest);
    case "companion-profiles":
      return companionProfilesCommand(rest);
    case "status":
      return statusCommand(rest);
    case "restore":
      return restoreCommand(rest);
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
 * A `UserError` is a problem a person must fix, so it is printed and becomes a 1, as is an argument
 * `parseArgs` refused; anything else is a bug and keeps its stack.
 */
export async function runEngine(argv: readonly string[]): Promise<number> {
  try {
    return await main([...argv]);
  } catch (error) {
    if (error instanceof UserError) {
      console.error(`rigline: ${error.message}`);
      return 1;
    }
    if (isArgumentError(error)) {
      console.error(`rigline: ${error.message}`);
      console.error("`rigline --help` lists what each command takes.");
      return 1;
    }
    throw error;
  }
}

function isArgumentError(error: unknown): error is Error {
  const code = (error as { code?: unknown } | null)?.code;
  return error instanceof Error && typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_");
}
