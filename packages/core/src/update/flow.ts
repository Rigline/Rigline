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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  type InstallOptions,
  install,
  type PluginVerdict,
  pluginVerdicts,
} from "../inject/inject.ts";
import { diffScans, formatDiff, type Scan, scansDiffer, type ViewDiff } from "../layers/diff.ts";
import { type Harvest, harvestAll } from "../layers/index.ts";
import { riglinePaths } from "../paths.ts";
import { discoverPlugins, enabledPlugins, readConfig } from "../plugins/discover.ts";
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
  /** Whether `extension.js` changed, which needs a window reload rather than a webview reload. */
  readonly hostChanged: boolean;
  /**
   * Plugins not switched off in `config.json`, and those that are. Both, because "enabled" alone
   * cannot say why a plugin a person expected is absent from the panel, and that is the one
   * question this output exists to answer.
   */
  readonly enabled: readonly string[];
  readonly disabled: readonly string[];
  /** Every line the installer logged, so a caller can print them under this version's heading. */
  readonly log: readonly string[];
}

export interface FlowReport {
  /** What the newest installed version was compared against, or null on a first run. */
  readonly baseline: BaselineSource | null;
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
  /** Where the anchor override lives. Defaults to `~/.rigline/anchors.json`. */
  readonly anchorsPath?: string;
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
  // Discovery says nothing version-specific, but its lines are read under a version heading in
  // `update` because that is where the installer logs them. Repeating them per version here is what
  // keeps `check` saying everything `update` says, in the same place.
  const discovery: string[] = [];
  const discovered = options.plugins
    ? discoverPlugins(options.plugins.roots, {
        last: options.plugins.last,
        log: (line) => discovery.push(line),
      })
    : [];
  const plugins = options.plugins
    ? enabledPlugins(discovered, readConfig(options.plugins.configPath))
    : [];
  const enabled = plugins.map((p) => p.name);
  const disabled = discovered.filter((p) => !enabled.includes(p.name)).map((p) => p.name);

  const harvested = exts.map((ext) => harvestOne(ext, overrides));
  const versions: VersionReport[] = harvested.map((h) => ({
    ext: h.ext,
    version: h.version,
    verdicts: pluginVerdicts(plugins, h.generated.tables),
    ...anchorReport(h.generated),
    anchorOverrides: anchorOverrideOutcomes(h.harvest.classes, overrides),
    action: null,
    hostChanged: false,
    enabled,
    disabled,
    log: discovery,
  }));

  return settle(options, overrides, harvested, versions, null);
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
      hostChanged: report.hostChanged,
      enabled: report.enabled,
      disabled: report.disabled,
      log,
    });
  }

  return settle(options, overrides, harvested, versions, options);
}

/** The half both commands share: diff against the baseline, decide who needs a person, write. */
function settle(
  options: FlowOptions,
  overrides: AnchorOverrides,
  harvested: readonly Harvested[],
  versions: readonly VersionReport[],
  writeOptions: UpdateOptions | null,
): FlowReport {
  const dir = options.dir ?? process.cwd();
  const baselinePath = options.baselinePath ?? riglinePaths().baseline;
  const newest = harvested.at(-1);
  if (!newest) {
    return {
      baseline: null,
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
  // A malformed override is a person's mistake in a file only they can fix, and it never blocks:
  // the entries that parsed have already been applied and the rest are simply not there (D44).
  const attention: string[] = [...overrides.problems];

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
    if (version.hostChanged) {
      attention.push(
        `${version.version}: extension.js changed, so run "Developer: Reload Window" (this ends the window's sessions)`,
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
    writeBaseline(baselinePath, scan);
    wrote.push(baselinePath);
  }

  return { baseline, overrides, scan, diffs, versions, wrote, attention };
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

/** "1 plugin", "3 plugins". A report a person reads should not make them read "(s)". */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A plain-text report of one flow, for the CLI and for a watcher's log. */
export function formatFlow(report: FlowReport): string {
  const lines: string[] = [];
  if (report.baseline) {
    lines.push(`baseline: ${report.baseline.path} (${report.baseline.scan.version})`);
    lines.push(
      scansDiffer(report.diffs)
        ? formatDiff(report.baseline.scan, report.scan, report.diffs)
        : `nothing moved between ${report.baseline.scan.version} and ${report.scan.version}`,
    );
  } else {
    lines.push(`no baseline yet; ${report.scan.version} is the first one recorded`);
  }

  for (const version of report.versions) {
    lines.push(`\n${version.version}${version.action ? `: ${version.action}` : ""}`);
    for (const line of version.log) lines.push(`  ${line}`);
    if (version.anchorOverrides.length > 0) {
      lines.push(`  anchor overrides, from ${report.overrides.path}:`);
      for (const override of version.anchorOverrides) {
        lines.push(`    ${override.name}: ${overrideEffect(override)}`);
      }
    }
    for (const verdict of version.verdicts) {
      if (verdict.refusal) lines.push(`  REFUSED ${verdict.plugin}: ${verdict.refusal}`);
      else if (verdict.missingOptional.length > 0) {
        lines.push(
          `  ${verdict.plugin}: loads, without ${count(verdict.missingOptional.length, "optional dependency", "optional dependencies")}`,
        );
      }
    }
    // Said even when nothing is wrong. "Silence means fine" is something a person has to be taught
    // to read; a count is something anyone can read.
    const refusedNames = version.verdicts.filter((v) => v.refusal !== null).map((v) => v.plugin);
    lines.push(
      `  ${count(version.verdicts.length, "plugin", "plugins")} checked` +
        (refusedNames.length === 0
          ? ", every declaration holds"
          : `, ${refusedNames.length} refused`) +
        (version.anchorsMissing.length === 0
          ? ""
          : `; ${count(version.anchorsMissing.length, "curated anchor", "curated anchors")} unresolved`) +
        (version.anchorsAmbiguous.length === 0
          ? ""
          : `; ${count(version.anchorsAmbiguous.length, "curated anchor", "curated anchors")} ambiguous`),
    );
    // Three states, not two. `enabled` means "not switched off in config", so folding it together
    // with the verdict listed a plugin this version refuses as loading, two lines under its own
    // REFUSED line — on the one output a person reads when a plugin vanishes from their panel.
    const loading = version.enabled.filter((name) => !refusedNames.includes(name));
    lines.push(`  loading: ${loading.join(", ") || "none"}`);
    if (version.disabled.length > 0) {
      lines.push(`  switched off in config: ${version.disabled.join(", ")}`);
    }
  }

  for (const path of report.wrote) lines.push(`\nwrote: ${path}`);
  if (report.attention.length > 0) {
    lines.push("\nNeeds you:");
    for (const line of report.attention) lines.push(`  - ${line}`);
  }
  return lines.join("\n");
}
