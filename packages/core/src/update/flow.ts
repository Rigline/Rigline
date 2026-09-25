/**
 * The update flow and the check that is its read-only half (decisions.md, D27 to D30, D43, D45).
 *
 * An extension update installs a new versioned directory and deletes the old one, which silently
 * reverts the injection. Nothing notices until a window reloads and the panel comes up without its
 * plugins, so the flow's job is to be the thing that notices: harvest every installed version, say
 * what moved since the harvest the plugins were built against, say which plugins this version will
 * refuse and by which identifier, and put the loader back.
 *
 * What it never does is block on a plugin's problem (D27). An update has already removed the
 * loader; refusing to inject because one plugin declared an identifier that has gone would cost
 * every working plugin and the probe badge that names the broken one. It reports the plugin, injects
 * around it, and the post hook refuses it at load. Only two things block: a harvest falling under
 * its own floor, which is a `HarvestError` from the layer and means our own regex has drifted
 * rather than that the extension has, and a failure in Rigline's own build.
 *
 * `check` and `update` differ in exactly one way: `check` writes nothing. Everything either of them
 * would say, `check` says, which is what makes it safe to run from a hook or from a watch loop.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type AnchorOverrideOutcome,
  type AnchorOverrides,
  anchorOverrideOutcomes,
  readAnchorOverrides,
} from "../anchors/overrides.ts";
import { type Generated, generate } from "../codegen/generate.ts";
import { readBundles } from "../extension/bundles.ts";
import { extensionVersion, installedExtensions } from "../extension/locate.ts";
import {
  verdict as bundleVerdict,
  hostPatchOutcomes,
  type InstallOptions,
  inspect,
  install,
  type PluginVerdict,
  pluginVerdicts,
} from "../inject/inject.ts";
import { diffScans, formatDiff, type Scan, scansDiffer, type ViewDiff } from "../layers/diff.ts";
import { type Harvest, harvestAll } from "../layers/index.ts";
import { riglinePaths } from "../paths.ts";
import { readConfig } from "../plugins/config.ts";
import {
  discoverPlugins,
  enabledPlugins,
  layoutNotes,
  registryEngine,
} from "../plugins/discover.ts";
import { readToken } from "../plugins/save.ts";
import { CORE_VERSION } from "../version.ts";
import { type BaselineSource, GENERATED_FILE, readBaseline, writeBaseline } from "./baseline.ts";

/** What one installed extension directory looks like after the flow has been over it. */
export interface VersionReport {
  readonly ext: string;
  readonly version: string;
  /** Every enabled plugin checked against this version's tables (D43). */
  readonly verdicts: readonly PluginVerdict[];
  /** Curated anchor names this version does not resolve: the repair path's own gaps (D44). */
  readonly anchorsMissing: readonly string[];
  /**
   * Anchors naming one element whose class this version applies in several places, with the count,
   * and anchors whose module was never counted. Reported apart from `anchorsMissing` because they
   * are repaired differently: a refinement in the table, written today, against a wait for the
   * extension or a new pair (D7).
   */
  readonly anchorsAmbiguous: readonly { readonly name: string; readonly sites: number }[];
  readonly anchorsUnverified: readonly string[];
  /**
   * Each entry of `~/.rigline/anchors.json`, and what this version makes of it (D44). Reported by
   * name because a table repaired on one machine and nowhere else is the one kind of difference
   * nothing else in a bug report would show.
   */
  readonly anchorOverrides: readonly AnchorOverrideOutcome[];
  /** What the install did here, or null from `check`, which installs nothing. */
  readonly action: "injected" | "refreshed" | null;
  /** Whether this run wrote anything a reload would pick up. Always false from `check`. */
  readonly wrote: boolean;
  /** Whether `extension.js` changed, which needs a window reload rather than a webview reload. */
  readonly hostChanged: boolean;
  /** Whether the bundle carried a patch this installer did not write, now rolled back. */
  readonly rolledBack: boolean;
  /** Whether the bundle carries the loader: true after `install`, read off disk by `check`. */
  readonly injected: boolean;
  /**
   * Plugins not switched off in `config.yaml`, and those that are. Both, because "enabled" alone
   * cannot say why a plugin a person expected is absent from the panel, and that is the one
   * question this output exists to answer.
   */
  readonly enabled: readonly string[];
  readonly disabled: readonly string[];
  /** Every line the installer logged, which only `--verbose` prints (D98). */
  readonly log: readonly string[];
  /**
   * The engine version stamped into this directory's payload (D75), or null when nothing is
   * injected here or the payload predates the stamp.
   *
   * From `check` it is the whole point: a read-only command is the only way to find out that a
   * version is running a payload three releases old, which nothing else on disk distinguishes from
   * a current one. From `install` it is what was just written, so it agrees with `CORE_VERSION` by
   * construction and is reported for the symmetry rather than for the news.
   */
  readonly payloadEngine: string | null;
}

export interface FlowReport {
  /** Which command made it. `check` writes nothing, so it owes no reload. */
  readonly kind: "install" | "check";
  /** What the newest installed version was compared against, or null on a first run. */
  readonly baseline: BaselineSource | null;
  /** Discovery and `config.yaml` problems, which are the same for every version. */
  readonly configNotes: readonly string[];
  /** Where `install` listed what moved, or null: nothing moved, or this is `check` (D98). */
  readonly driftFile: string | null;
  /** The local anchor table override, as read: the file, and anything wrong with it (D44). */
  readonly overrides: AnchorOverrides;
  /** The newest installed version's harvest, which is what a written baseline records. */
  readonly scan: Scan;
  readonly diffs: readonly ViewDiff[];
  readonly versions: readonly VersionReport[];
  /** Files written. Empty from `check`. */
  readonly wrote: readonly string[];
  /**
   * Why a person is needed, one line each. Empty means nothing here wants a human, which is the
   * answer a watcher running unattended is looking for; anything else is a non-zero exit (D27).
   */
  readonly attention: readonly string[];
}

export interface FlowOptions {
  /** The directory the command was run from: where a `generated.ts` baseline is looked for. */
  readonly dir?: string;
  /** Installed extension directories, newest last. Defaults to every one on this machine. */
  readonly exts?: readonly string[];
  /** Plugin roots and config, as `install` takes them. Without it, no plugin is checked. */
  readonly plugins?: InstallOptions["plugins"];
  /** Where the recorded baseline lives. Defaults to `~/.rigline/baseline.json`. */
  readonly baselinePath?: string;
  /** Where `install` lists what moved. Defaults to `~/.rigline/drift.txt`. */
  readonly driftPath?: string;
  /** Where the anchor override lives. Defaults to `~/.rigline/anchors.json`. */
  readonly anchorsPath?: string;
  /** The stability sample's timings, as `install` takes them. Injected only by tests. */
  readonly wholeness?: InstallOptions["wholeness"];
}

export interface UpdateOptions extends FlowOptions {
  /** The prebuilt `pre.js` and `post.js` to inject. Required, because `update` installs. */
  readonly payloadDir: string;
  /**
   * Rewrite `generated.ts` in `dir` from the new harvest when one is there (D30). The flow writes
   * its artefacts and tells you to commit them; it never commits.
   */
  readonly codegen?: boolean;
}

/** One version, harvested once: every consumer below reads this rather than harvesting again. */
interface Harvested {
  readonly ext: string;
  readonly version: string;
  readonly harvest: Harvest;
  readonly generated: Generated;
}

function harvestOne(ext: string, overrides: AnchorOverrides): Harvested {
  const harvest = harvestAll(readBundles(ext));
  const generated = generate(harvest, overrides.table);
  return { ext, version: generated.tables.version, harvest, generated };
}

/**
 * The engine version stamped into one directory's injected payload, or null (D75).
 *
 * Read off disk rather than passed down, because the question is about what is installed there and
 * not about what this process is: `check` writes nothing and must still be able to say that a
 * version is carrying a payload an older engine left behind. The registry is parsed as text and
 * never imported, for the reason `parseRegistry` gives.
 */
function payloadEngineOf(ext: string): string | null {
  const path = join(ext, "webview", "rigline", "registry.js");
  if (!existsSync(path)) return null;
  try {
    return registryEngine(readFileSync(path, "utf8"));
  } catch {
    // A payload directory somebody's editor is holding open, or one a half-finished install left
    // unreadable. Neither is a reason for `check` to fail; the absence reads as "nothing to say".
    return null;
  }
}

/** How one version answered the anchor table, as a `VersionReport` carries it. */
function anchorReport(
  generated: Generated,
): Pick<VersionReport, "anchorsMissing" | "anchorsAmbiguous" | "anchorsUnverified"> {
  // Read off what `generate` already resolved rather than asked again: asking twice invites two
  // answers, and this is the table the loader will be given.
  return {
    anchorsMissing: generated.anchors.missing,
    anchorsAmbiguous: generated.anchors.ambiguous,
    anchorsUnverified: generated.anchors.unverified,
  };
}

/**
 * What every installed version says about itself and about the plugins, writing nothing.
 *
 * The two questions D28 names, asked of the installed bundle alone and never differentially: does
 * every declared identifier still exist, and does the harvest still hold together. A differential
 * gate would pass on its second run, satisfied by its own side effect, because the flow advances
 * the very baseline it would be reading.
 */
export function check(options: FlowOptions = {}): FlowReport {
  const exts = options.exts ?? installedExtensions();
  const overrides = readAnchorOverrides(options.anchorsPath ?? riglinePaths().anchors);
  const configNotes: string[] = [];
  const note = (line: string): void => {
    configNotes.push(line);
  };
  const discovered = options.plugins
    ? discoverPlugins(options.plugins.roots, {
        last: options.plugins.last,
        bundledRoot: options.plugins.bundledRoot,
        log: note,
      })
    : [];
  const config = options.plugins ? readConfig(options.plugins.configPath) : null;
  const plugins = config ? enabledPlugins(discovered, config, note) : [];
  if (config) configNotes.push(...layoutNotes(config, plugins));
  const enabled = plugins.map((p) => p.name);
  const disabled = discovered.filter((p) => !enabled.includes(p.name)).map((p) => p.name);

  const harvested = exts.map((ext) => harvestOne(ext, overrides));
  const versions: VersionReport[] = harvested.map((h) => ({
    ext: h.ext,
    version: h.version,
    verdicts: pluginVerdicts(plugins, h.generated.tables, hostPatchOutcomes(h.ext, plugins)),
    ...anchorReport(h.generated),
    anchorOverrides: anchorOverrideOutcomes(h.harvest.classes, overrides),
    action: null,
    wrote: false,
    hostChanged: false,
    rolledBack: false,
    injected: bundleVerdict(inspect(h.ext)) === "patched",
    enabled,
    disabled,
    log: [],
    payloadEngine: payloadEngineOf(h.ext),
  }));

  // Only a file that is there and unusable: a missing one is made by the next `install`.
  const tokenPath = options.plugins?.tokenPath;
  const token = tokenPath !== undefined && existsSync(tokenPath) ? readToken(tokenPath) : null;
  const tokenProblem =
    token !== null && "problem" in token
      ? `Save in the panel copies commands instead: ${token.problem}`
      : null;

  return settle(options, overrides, harvested, versions, null, {
    kind: "check",
    configNotes,
    tokenProblem,
  });
}

/**
 * Harvest, report, and put the loader back in every installed version.
 *
 * Installing happens per version and never stops at the first failure, for the reason D4 gives: a
 * window that was already open goes on being served the old directory, so the version most worth
 * repairing is often not the newest one.
 */
export function update(options: UpdateOptions): FlowReport {
  const exts = options.exts ?? installedExtensions();
  const overrides = readAnchorOverrides(options.anchorsPath ?? riglinePaths().anchors);
  const harvested: Harvested[] = [];
  const versions: VersionReport[] = [];
  let configNotes: readonly string[] = [];
  let tokenProblem: string | null = null;

  for (const ext of exts) {
    const log: string[] = [];
    // `install` harvests this directory itself, because what it writes beside the loader has to be
    // the tables from the bundle it is patching. The harvest here is the report's, and the two are
    // the same work done twice on purpose: sharing it would make the installer's correctness depend
    // on a caller having harvested the right directory.
    const report = install(ext, {
      payloadDir: options.payloadDir,
      plugins: options.plugins,
      anchors: overrides,
      ...(options.wholeness === undefined ? {} : { wholeness: options.wholeness }),
      log: (line) => log.push(line),
    });
    const h = harvestOne(ext, overrides);
    harvested.push(h);
    versions.push({
      ext,
      version: extensionVersion(ext),
      verdicts: report.verdicts,
      ...anchorReport(h.generated),
      anchorOverrides: report.anchorOverrides,
      action: report.action,
      wrote: report.wrote,
      hostChanged: report.hostChanged,
      rolledBack: report.rolledBack,
      injected: true,
      enabled: report.enabled,
      disabled: report.disabled,
      log,
      payloadEngine: payloadEngineOf(ext),
    });
    // The same for every version, since they come from discovery and the config.
    configNotes = report.configNotes;
    tokenProblem = report.tokenProblem;
  }

  return settle(options, overrides, harvested, versions, options, {
    kind: "install",
    configNotes,
    tokenProblem,
  });
}

/** What `check` and `update` each know that the shared half does not. */
interface Settling {
  readonly kind: FlowReport["kind"];
  readonly configNotes: readonly string[];
  readonly tokenProblem: string | null;
}

/** The half both commands share: diff against the baseline, decide who needs a person, write. */
function settle(
  options: FlowOptions,
  overrides: AnchorOverrides,
  harvested: readonly Harvested[],
  versions: readonly VersionReport[],
  writeOptions: UpdateOptions | null,
  settling: Settling,
): FlowReport {
  const dir = options.dir ?? process.cwd();
  const baselinePath = options.baselinePath ?? riglinePaths().baseline;
  const { kind, configNotes, tokenProblem } = settling;
  const newest = harvested.at(-1);
  if (!newest) {
    return {
      kind,
      baseline: null,
      configNotes,
      driftFile: null,
      overrides,
      scan: { version: "none", views: {} },
      diffs: [],
      versions,
      wrote: [],
      attention: ["no Claude Code extension is installed", ...overrides.problems],
    };
  }

  const scan = newest.generated.scan;
  const baseline = readBaseline(dir, baselinePath);
  const diffs = baseline ? diffScans(baseline.scan, scan) : [];
  const wrote: string[] = [];
  let driftFile: string | null = null;
  // A malformed override is a person's mistake in a file only they can fix, and it never blocks:
  // the entries that parsed have already been applied and the rest are simply not there (D44).
  const attention: string[] = [...overrides.problems];
  if (tokenProblem !== null) attention.push(tokenProblem);

  for (const version of versions) {
    for (const verdict of version.verdicts) {
      if (verdict.refusal) {
        attention.push(`${version.version} refuses "${verdict.plugin}": ${verdict.refusal}`);
      }
      for (const gap of verdict.missingOptional) {
        // The gap is already a sentence, so it is joined with a dash rather than folded into one:
        // "loads without anchor X is not in this extension" is what folding gets you.
        attention.push(
          `${version.version}: "${verdict.plugin}" loads without one of its optional dependencies — ${gap}`,
        );
      }
    }
    if (version.anchorsMissing.length > 0) {
      // Against the table, never against a plugin (D44): one curated pair, fixed once, repairs
      // every plugin that used the name, and nothing else in the system can repair a plugin whose
      // author has not touched it.
      attention.push(
        `${version.version}: the anchor table does not resolve ${version.anchorsMissing.join(", ")}`,
      );
    }
    if (version.anchorsAmbiguous.length > 0) {
      // The repair is a refinement in the anchor table — `[role="combobox"]` and the like — not a
      // new pair, so the line says which anchor and how many places its class is applied, which is
      // where somebody has to go and look (D7).
      const named = version.anchorsAmbiguous
        .map((a) => `${a.name} (${a.sites} application sites)`)
        .join(", ");
      attention.push(
        `${version.version}: ${named} name one element each, and this version applies their classes in more than one place; the anchor table needs a refinement for each`,
      );
    }
    if (version.anchorsUnverified.length > 0) {
      attention.push(
        `${version.version}: the application-site count could not be taken for ${version.anchorsUnverified.join(", ")}, so nothing checked that each names one element`,
      );
    }
    for (const override of version.anchorOverrides) {
      if (override.resolves || !override.resolvedWithout) continue;
      // The one override outcome nobody would otherwise see: this version resolved the anchor
      // until a local file said otherwise, and the plugins refused for it would read as the
      // extension's doing.
      attention.push(
        `${version.version}: ${overrides.path} overrides "${override.name}", and this version resolves it without the override but not with it`,
      );
    }
    // `hostChanged` is deliberately *not* here. `check` reports it false by construction, so it is
    // only ever true from `install` and only ever names work this run just did — the same reason
    // the payload-engine line below is gated to `check` (D55). Every other entry names something a
    // person must repair; a reload to see the result is the report's job, not the exit code's, and
    // a bundled plugin that patches the host made every weekly update exit 1 having succeeded.
    //
    // Only from `check`, which writes nothing: after `install` the payload is this engine's by
    // construction, and an attention line about work just done is output nobody has trimmed (D55).
    if (
      writeOptions === null &&
      version.payloadEngine !== null &&
      version.payloadEngine !== CORE_VERSION
    ) {
      attention.push(
        `${version.version}: its payload was written by engine ${version.payloadEngine}, and this engine is ${CORE_VERSION}; run \`rigline install\``,
      );
    }
  }

  if (writeOptions) {
    if (writeOptions.codegen) {
      const path = join(dir, GENERATED_FILE);
      // Rendered from the shipped anchor table, never the merged one (D44). What goes in here is
      // committed, and the version's answer to `~/.rigline/anchors.json` is one machine's local
      // repair: baking it into a repository's record would make the next person's checkout disagree
      // with their own harvest for a reason nothing in the file could explain.
      const source = generate(newest.harvest).source;
      if (existsSync(path) && readFileSync(path, "utf8") !== source) {
        writeFileSync(path, source);
        wrote.push(path);
        attention.push(
          `${path} was rewritten from ${newest.version}; read the diff, typecheck, and commit it`,
        );
      }
    }
    // Written before the baseline moves, because after it nothing can say what moved (D98).
    const driftPath = options.driftPath ?? riglinePaths().drift;
    if (baseline && scansDiffer(diffs)) {
      mkdirSync(dirname(driftPath), { recursive: true });
      writeFileSync(driftPath, `${formatDiff(baseline.scan, scan, diffs, Infinity)}\n`);
      wrote.push(driftPath);
      driftFile = driftPath;
    } else {
      rmSync(driftPath, { force: true });
    }
    writeBaseline(baselinePath, scan);
    wrote.push(baselinePath);
  }

  return {
    kind,
    baseline,
    configNotes,
    driftFile,
    overrides,
    scan,
    diffs,
    versions,
    wrote,
    attention,
  };
}

/**
 * What one override entry did to this version, as the line a person reads (D44).
 *
 * The comparison is the whole point of saying anything: an override applied is invisible, and the
 * question somebody asks after writing one is whether it worked. "Changes nothing" is the answer
 * worth having too, since an override that the shipped table has caught up with is one to delete.
 */
function overrideEffect(override: AnchorOverrideOutcome): string {
  if (override.added) {
    return override.resolves
      ? "adds an anchor the table has not got, and it resolves here"
      : "adds an anchor the table has not got, and it does not resolve here";
  }
  if (override.resolves) {
    return override.resolvedWithout
      ? "changes nothing; this version resolves the anchor without it"
      : "repairs an anchor this version does not otherwise resolve";
  }
  return override.resolvedWithout
    ? "STOPS an anchor resolving that this version resolves without it"
    : "does not resolve the anchor, which this version does not resolve either";
}

export interface FormatOptions {
  /** Everything a maintainer or plugin author reads as well (D98). */
  readonly verbose?: boolean;
  /** A reload line to use instead of the one the writes call for. */
  readonly reload?: string;
}

/** What one version is, as a person reads it: what the run did, or what `check` found on disk. */
function stateOf(version: VersionReport): string {
  if (version.action === null) {
    if (!version.injected) return "not injected";
    return version.payloadEngine === null
      ? "patched, unstamped"
      : `patched by engine ${version.payloadEngine}`;
  }
  if (version.action === "injected") return "injected";
  return version.wrote ? "refreshed" : "already current";
}

/**
 * Enabled and not refused. Three states, not two: `enabled` means "not switched off in config", and
 * folding it with the verdict listed a refused plugin as loading.
 */
function loadingOf(version: VersionReport): string {
  const refused = new Set(version.verdicts.filter((v) => v.refusal !== null).map((v) => v.plugin));
  return version.enabled.filter((name) => !refused.has(name)).join(", ") || "none";
}

/** Decided from what this run wrote, never from what a window has loaded, which nothing here sees. */
function reloadLine(report: FlowReport): string {
  if (report.versions.some((v) => v.hostChanged)) {
    return "extension.js changed: run Developer: Reload Window (this ends the window's sessions).";
  }
  if (report.versions.some((v) => v.wrote)) {
    return "Reload with Developer: Reload Webviews (current window only).";
  }
  return "Nothing to reload: this run changed nothing in Claude Code.";
}

/** A plain-text report of one flow, ending with what to reload and then what needs a person (D98). */
export function formatFlow(report: FlowReport, options: FormatOptions = {}): string {
  const verbose = options.verbose ?? false;
  const lines: string[] = [];
  if (verbose) {
    lines.push(
      report.baseline
        ? `baseline: ${report.baseline.path} (${report.baseline.scan.version})`
        : `no baseline yet; ${report.scan.version} is the first one recorded`,
    );
  }

  // Newest first, and versions in the same state on one line unless one has more to say.
  const newestFirst = [...report.versions].reverse();
  const rows: { names: string[]; state: string; detail: readonly string[] }[] = [];
  for (const version of newestFirst) {
    const state = stateOf(version);
    const detail = [
      ...(version.rolledBack
        ? ["  its bundle carried a patch Rigline did not write, rolled back from the backup"]
        : []),
      ...(version.anchorOverrides.length > 0
        ? [
            `  anchor overrides, from ${report.overrides.path}:`,
            ...version.anchorOverrides.map((o) => `    ${o.name}: ${overrideEffect(o)}`),
          ]
        : []),
      ...(verbose ? [`  ${version.ext}`, ...version.log.map((line) => `  ${line}`)] : []),
    ];
    const same =
      detail.length === 0
        ? rows.find((row) => row.detail.length === 0 && row.state === state)
        : undefined;
    if (same) same.names.push(version.version);
    else rows.push({ names: [version.version], state, detail });
  }
  for (const row of rows) lines.push(`${row.names.join(", ")}: ${row.state}`, ...row.detail);

  if (newestFirst.length > 0) {
    const loading = newestFirst.map(loadingOf);
    if (loading.every((set) => set === loading[0])) lines.push(`loading: ${loading[0]}`);
    else lines.push(...newestFirst.map((v, i) => `loading on ${v.version}: ${loading[i]}`));
    const disabled = newestFirst[0]?.disabled ?? [];
    if (disabled.length > 0) lines.push(`switched off: ${disabled.join(", ")}`);
  }
  lines.push(...report.configNotes);

  if (report.baseline) {
    const from = report.baseline.scan.version;
    if (scansDiffer(report.diffs)) {
      const where =
        report.driftFile !== null
          ? `the list is in ${report.driftFile}`
          : verbose
            ? "listed below"
            : "check --verbose lists them";
      lines.push(`since ${from}: identifiers moved; ${where}`);
      if (verbose) lines.push(formatDiff(report.baseline.scan, report.scan, report.diffs));
    } else if (from !== report.scan.version) {
      lines.push(`nothing moved since ${from}`);
    }
  }
  if (verbose) for (const path of report.wrote) lines.push(`wrote: ${path}`);

  const sections = [lines.join("\n")];
  if (report.kind === "install") sections.push(options.reload ?? reloadLine(report));
  if (report.attention.length > 0) {
    sections.push(["Needs you:", ...report.attention.map((line) => `  - ${line}`)].join("\n"));
  }
  return sections.filter((section) => section !== "").join("\n\n");
}
