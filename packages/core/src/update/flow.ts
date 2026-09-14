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
import { harvestAll } from "../layers/index.ts";
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
  /** What the install did here, or null from `check`, which installs nothing. */
  readonly action: "injected" | "refreshed" | null;
  /** Whether `extension.js` changed, which needs a window reload rather than a webview reload. */
  readonly hostChanged: boolean;
  /** Every line the installer logged, so a caller can print them under this version's heading. */
  readonly log: readonly string[];
}

export interface FlowReport {
  /** What the newest installed version was compared against, or null on a first run. */
  readonly baseline: BaselineSource | null;
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
  readonly generated: Generated;
  readonly anchorsMissing: readonly string[];
}

function harvestOne(ext: string): Harvested {
  const generated = generate(harvestAll(readBundles(ext)));
  return {
    ext,
    version: generated.tables.version,
    generated,
    // The anchors the table promises and this version does not honour. Read off the resolved table
    // rather than recomputed: `generate` has already asked, and asking twice invites two answers.
    anchorsMissing: Object.entries(generated.tables.anchors)
      .filter(([, resolved]) => resolved === null)
      .map(([name]) => name),
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
  const plugins = options.plugins
    ? enabledPlugins(
        discoverPlugins(options.plugins.roots, { last: options.plugins.last }),
        readConfig(options.plugins.configPath),
      )
    : [];

  const harvested = exts.map(harvestOne);
  const versions: VersionReport[] = harvested.map((h) => ({
    ext: h.ext,
    version: h.version,
    verdicts: pluginVerdicts(plugins, h.generated.tables),
    anchorsMissing: h.anchorsMissing,
    action: null,
    hostChanged: false,
    log: [],
  }));

  return settle(options, harvested, versions, null);
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
      log: (line) => log.push(line),
    });
    const h = harvestOne(ext);
    harvested.push(h);
    versions.push({
      ext,
      version: extensionVersion(ext),
      verdicts: report.verdicts,
      anchorsMissing: h.anchorsMissing,
      action: report.action,
      hostChanged: report.hostChanged,
      log,
    });
  }

  return settle(options, harvested, versions, options);
}

/** The half both commands share: diff against the baseline, decide who needs a person, write. */
function settle(
  options: FlowOptions,
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
      scan: { version: "none", views: {} },
      diffs: [],
      versions,
      wrote: [],
      attention: ["no Claude Code extension is installed"],
    };
  }

  const scan = newest.generated.scan;
  const baseline = readBaseline(dir, baselinePath);
  const diffs = baseline ? diffScans(baseline.scan, scan) : [];
  const wrote: string[] = [];
  const attention: string[] = [];

  for (const version of versions) {
    for (const verdict of version.verdicts) {
      if (verdict.refusal) {
        attention.push(`${version.version} refuses "${verdict.plugin}": ${verdict.refusal}`);
      }
      for (const gap of verdict.missingOptional) {
        attention.push(`${version.version}: "${verdict.plugin}" loads without ${gap}`);
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
    if (version.hostChanged) {
      attention.push(
        `${version.version}: extension.js changed, so run "Developer: Reload Window" (this ends the window's sessions)`,
      );
    }
  }

  if (writeOptions) {
    if (writeOptions.codegen) {
      const path = join(dir, GENERATED_FILE);
      if (existsSync(path) && readFileSync(path, "utf8") !== newest.generated.source) {
        writeFileSync(path, newest.generated.source);
        wrote.push(path);
        attention.push(
          `${path} was rewritten from ${newest.version}; read the diff, typecheck, and commit it`,
        );
      }
    }
    writeBaseline(baselinePath, scan);
    wrote.push(baselinePath);
  }

  return { baseline, scan, diffs, versions, wrote, attention };
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
    for (const verdict of version.verdicts) {
      if (verdict.refusal) lines.push(`  REFUSED ${verdict.plugin}: ${verdict.refusal}`);
      else if (verdict.missingOptional.length > 0) {
        lines.push(
          `  ${verdict.plugin}: loads, without ${verdict.missingOptional.length} optional dependency(ies)`,
        );
      }
    }
    // Said even when nothing is wrong. "Silence means fine" is something a person has to be taught
    // to read; a count is something anyone can read.
    const refused = version.verdicts.filter((v) => v.refusal !== null).length;
    lines.push(
      `  ${version.verdicts.length} plugin(s) checked` +
        (refused === 0 ? ", every declaration holds" : `, ${refused} refused`) +
        (version.anchorsMissing.length === 0
          ? ""
          : `; ${version.anchorsMissing.length} curated anchor(s) unresolved`),
    );
  }

  for (const path of report.wrote) lines.push(`\nwrote: ${path}`);
  if (report.attention.length > 0) {
    lines.push("\nNeeds you:");
    for (const line of report.attention) lines.push(`  - ${line}`);
  }
  return lines.join("\n");
}
