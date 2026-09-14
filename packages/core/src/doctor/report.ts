/**
 * Rendering a collected diagnostic as markdown somebody can paste into an issue (D53).
 *
 * Pure: it takes the report `collect` produced and returns text. Nothing is filtered here, and that
 * is deliberate — the collector already decided what may be read, and a formatter that also redacted
 * would put the rule in two places, which is how one of them comes to be forgotten.
 *
 * What it does do is abbreviate the user's home directory to `~` wherever it appears, in log lines
 * and stack frames as well as in paths. On Windows the home directory carries the account name and
 * appears in every frame of every stack, so a report pasted in public would otherwise announce it a
 * hundred times over. This is cosmetic, not the privacy mechanism, and the report says so: the
 * mechanism is the appendix, which names every file opened and every file refused.
 *
 * The document is ordered for the person reading the issue, not for the collector: install state
 * first because it says which build this is about, then the lockups, then per-window errors, then
 * the appendix. A reader who stops after the first screen should still know what they are looking
 * at.
 */

import {
  DEFAULT_SINCE_MS,
  type DoctorReport,
  type LaunchReport,
  type LogRootReport,
  type SkipRecord,
  type WindowReport,
} from "./collect.ts";
import type { InstallState } from "./install.ts";
import type { ErrorSummary, MainLog, UnresponsiveEpisode } from "./logs.ts";

/** Episodes rendered per launch, newest first. Beyond this a report stops being readable. */
const MAX_EPISODES = 20;
/** Lines of one sample block rendered before it is cut. Real blocks run to a dozen. */
const MAX_SAMPLE_LINES = 40;
/** Extension-host exits listed per launch, newest first. */
const MAX_EXITS = 20;

/**
 * The user's home directory as a pattern that matches every spelling the logs use for it.
 *
 * Three, on Windows, and all three appear within a few lines of each other in a real
 * `renderer.log`: `c:\Users\name` in a Node stack, `c:/Users/name` inside a `vscode-file://` URL,
 * and `c%3A/Users/name` inside a `file:///` URI where the drive colon is percent-encoded. Matching
 * only the first would leave the account name in the report while appearing to have removed it,
 * which is worse than not trying.
 */
function homePattern(home: string): RegExp | null {
  if (home.length === 0) return null;
  const source = home
    .replace(/[.*+?^${}()|[\]]/g, "\\$&")
    .replace(/[\\/]/g, "[\\\\/]")
    .replace(/:/g, "(?::|%3A)");
  return new RegExp(source, "gi");
}

function abbreviate(text: string, home: RegExp | null): string {
  return home === null ? text : text.replace(home, "~");
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Local time, to match the local timestamps VS Code writes into its logs (see `parseStamp`). */
export function formatTime(ms: number): string {
  const at = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * A time window as a person would say it. Separate from `formatDuration` because the two are
 * answering different questions: a lockup is interesting to a tenth of a second, and a search
 * window rendered the same way reads "1440m 0s".
 */
export function formatWindow(ms: number): string {
  if (ms % 86_400_000 === 0) return count(ms / 86_400_000, "day");
  if (ms % 3_600_000 === 0) return count(ms / 3_600_000, "hour");
  return count(Math.round(ms / 60_000), "minute");
}

/** "1 window", "3 windows". A report a person reads should not make them read "(s)". */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The last segment of a path, either separator. `node:path` is not imported here on purpose. */
function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.at(-1) ?? path;
}

/**
 * Collapses runs of blank lines, except inside a fenced block.
 *
 * The sections below each end with a blank line and each begin with one, which is what keeps them
 * composable; the join would otherwise leave doubles all through the document. Doing it with one
 * regex over the finished text would have been shorter and would also have rewritten the sample
 * stacks, which are the one part of this report that must come out exactly as VS Code wrote it.
 */
function tighten(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line === "```") inFence = !inFence;
    if (!inFence && line === "" && out.at(-1) === "") continue;
    out.push(line);
  }
  return out;
}

/** The time part of a log stamp when it shares a date with `other`, else the whole stamp. */
function shortStamp(at: string, other: string): string {
  return at.slice(0, 10) === other.slice(0, 10) ? at.slice(11) : at;
}

function fence(lines: readonly string[], home: RegExp | null, max = MAX_SAMPLE_LINES): string[] {
  const shown = lines.slice(0, max);
  const out = ["```", ...shown.map((line) => abbreviate(line, home))];
  if (lines.length > shown.length) out.push(`... ${lines.length - shown.length} more lines`);
  out.push("```");
  return out;
}

function installSection(install: InstallState, home: RegExp | null): string[] {
  const lines: string[] = [];
  lines.push(`### ${install.version ?? "version unknown"}`);
  lines.push("");
  lines.push(`- directory: \`${abbreviate(install.ext, home)}\``);
  lines.push(
    `- \`webview/index.js\`: ${install.webview}` +
      (install.markerPresent ? ", loader marker present" : ", no loader marker"),
  );
  lines.push(
    `- \`webview/index.js.orig\`: ${
      install.webviewBackup
        ? `${formatBytes(install.webviewBackup.size)}, ${formatTime(install.webviewBackup.modifiedMs)}`
        : "absent, so nothing can restore this version"
    }`,
  );
  lines.push(`- \`extension.js\`: ${install.host}`);
  lines.push(
    `- \`extension.js.orig\`: ${
      install.hostBackup
        ? `${formatBytes(install.hostBackup.size)}, ${formatTime(install.hostBackup.modifiedMs)}`
        : "absent, which is normal when no plugin patches the host"
    }`,
  );

  if (install.payload.length === 0) {
    lines.push("- payload: not installed");
  } else {
    lines.push("- payload:");
    for (const file of install.payload) {
      const name = file.path.slice(install.payloadDir.length + 1);
      lines.push(`  - \`${name}\`: ${formatBytes(file.size)}, ${formatTime(file.modifiedMs)}`);
    }
  }

  const { plugins, patches, problem } = install.registry;
  if (problem !== null) {
    lines.push(`- plugins: registry not read (${problem})`);
  } else if (plugins.length === 0) {
    lines.push("- plugins: none baked in");
  } else {
    lines.push(`- plugins baked in: ${plugins.map((p) => p.name).join(", ")}`);
    for (const plugin of plugins) {
      if (plugin.patchRefusal !== null) {
        lines.push(`  - ${plugin.name}: host patch refused — ${plugin.patchRefusal}`);
      }
    }
  }
  for (const patch of patches) {
    lines.push(
      patch.applied
        ? `- host patch applied (${patch.plugin}): ${patch.why}`
        : `- host patch NOT applied (${patch.plugin}, ${patch.reason ?? "no reason recorded"}): ${patch.why}`,
    );
  }
  for (const line of install.problems) lines.push(`- problem: ${abbreviate(line, home)}`);
  lines.push("");
  return lines;
}

function episodeSection(
  episode: UnresponsiveEpisode,
  index: number,
  home: RegExp | null,
): string[] {
  const lines: string[] = [];
  const span =
    episode.recoveredAt === null
      ? `${episode.detectedAt}, never recorded as recovering`
      : `${episode.detectedAt} to ${shortStamp(episode.recoveredAt, episode.detectedAt)}` +
        (episode.durationMs === null ? "" : `, ${formatDuration(episode.durationMs)}`);
  lines.push(`**${index}. ${span}**`);
  lines.push("");

  if (episode.recoveredAt === null) {
    lines.push(
      "No `recovered from unresponsive` line was paired with this detect, so nothing in the log " +
        "records the window coming back. Either it recovered silently or the launch ended while it " +
        "was still locked up.",
    );
  } else if (episode.closedBy !== null) {
    const detected = episode.detectedAt;
    lines.push(
      `This recovery is almost certainly the window being **closed**, not recovering: the ` +
        `extension host with pid ${episode.closedBy.pid} exited at ` +
        `${shortStamp(episode.closedBy.at, detected)}, moments after the recovery line. Read the ` +
        `duration as a lower bound on how long the window was unusable.`,
    );
  } else {
    lines.push(
      "No extension host exit followed this recovery, so the window does appear to have recovered.",
    );
  }
  lines.push("");

  for (const block of episode.samples) {
    lines.push(
      `Samples at ${shortStamp(block.at, episode.detectedAt)}` +
        (block.totalSamples === null ? ":" : ` (${count(block.totalSamples, "sample")}):`),
    );
    lines.push("");
    lines.push(...fence(block.lines, home));
    lines.push("");
  }

  for (const uncaught of episode.uncaught) {
    const where = [
      uncaught.windowId === null ? null : `window id ${uncaught.windowId}`,
      uncaught.pid === null ? null : `pid ${uncaught.pid}`,
    ]
      .filter((part) => part !== null)
      .join(", ");
    lines.push(
      `Uncaught in the main process at ${shortStamp(uncaught.at, episode.detectedAt)}` +
        (where.length > 0 ? ` (${where})` : "") +
        ":",
    );
    lines.push("");
    lines.push(...fence([uncaught.message, ...uncaught.frames], home));
    lines.push("");
  }

  return lines;
}

function mainSection(main: MainLog, launch: LaunchReport, home: RegExp | null): string[] {
  const lines: string[] = ["##### `main.log`", ""];
  if (main.episodes.length === 0 && main.exits.length === 0) {
    lines.push("Nothing unresponsive and no extension host exits were recorded.");
    lines.push("");
    return lines;
  }

  lines.push(
    `${count(main.episodes.length, "unresponsive episode")}, ` +
      `${count(main.exits.length, "extension host exit")}. The \`CodeWindow\` lines do not name ` +
      "the window they belong to, so a detect and a recovery are paired by order alone.",
  );
  lines.push("");

  const shown = main.episodes.slice(-MAX_EPISODES);
  if (shown.length < main.episodes.length) {
    lines.push(`Showing the last ${shown.length} of ${main.episodes.length}.`);
    lines.push("");
  }
  shown.forEach((episode, i) => {
    lines.push(...episodeSection(episode, main.episodes.length - shown.length + i + 1, home));
  });

  if (main.duplicateRecoveries > 0) {
    lines.push(
      `${count(main.duplicateRecoveries, "recovery line")} repeated the line before within a ` +
        `quarter of a second and ${main.duplicateRecoveries === 1 ? "was" : "were"} read as the ` +
        "same event, not as another window recovering.",
    );
    lines.push("");
  }

  if (main.orphanRecoveries.length > 0) {
    lines.push(
      `${count(main.orphanRecoveries.length, "recovery line")} arrived with no detect left open ` +
        `(${main.orphanRecoveries.join(", ")}). That happens when a log begins mid-lockup, and it ` +
        "is also the tell that this pairing has lost track of which window is which.",
    );
    lines.push("");
  }

  if (main.exits.length > 0) {
    const byPid = new Map<number, string>();
    for (const window of launch.windows) {
      for (const start of window.hostStarts) byPid.set(start.pid, window.name);
    }
    const exits = main.exits.slice(-MAX_EXITS);
    lines.push("Extension host exits:");
    lines.push("");
    for (const exit of exits) {
      const window = byPid.get(exit.pid);
      lines.push(
        `- ${exit.at} — pid ${exit.pid}, ${exit.detail}` +
          (window ? ` (started in ${window})` : ""),
      );
    }
    if (exits.length < main.exits.length) {
      lines.push(`- ... ${main.exits.length - exits.length} earlier exits not listed`);
    }
    lines.push("");
  }

  return lines;
}

function errorLines(label: string, summary: ErrorSummary, home: RegExp | null): string[] {
  const older = summary.older === 0 ? "" : `; ${summary.older} older than the window, not shown`;
  if (summary.total === 0) return [`- \`${label}\`: no errors in the window${older}`];
  const lines: string[] = [
    `- \`${label}\`: ${count(summary.total, "error")}, ${summary.distinct} distinct` +
      (summary.groups.length < summary.distinct
        ? `, the ${summary.groups.length} most recent shown`
        : "") +
      older,
  ];
  for (const group of summary.groups) {
    const when =
      group.first === group.last
        ? group.first
        : `${group.first} to ${shortStamp(group.last, group.first)}`;
    lines.push(
      `  - ${group.count > 1 ? `x${group.count} ` : ""}${when} — ${abbreviate(group.message, home)}`,
    );
    for (const detail of group.detail) {
      lines.push(`    ${abbreviate(detail.trim(), home)}`);
    }
    if (group.detailDropped > 0) {
      lines.push(`    ... ${group.detailDropped} more lines`);
    }
  }
  return lines;
}

function windowSection(window: WindowReport, home: RegExp | null): string[] {
  const errors =
    (window.renderer?.total ?? 0) + (window.exthost?.total ?? 0) + window.unopened.length;
  if (errors === 0) return [];

  const lines: string[] = [`##### ${window.name}`, ""];
  if (window.renderer) lines.push(...errorLines("renderer.log", window.renderer, home));
  else lines.push("- `renderer.log`: not present");
  if (window.exthost) lines.push(...errorLines("exthost/exthost.log", window.exthost, home));
  else lines.push("- `exthost/exthost.log`: not present");

  for (const record of window.unopened) {
    lines.push(
      `- not opened: \`exthost/${lastSegment(record.path)}\` — ` +
        `${count(record.files ?? 0, "file")}, ${formatBytes(record.size)}, last written ` +
        `${formatTime(record.modifiedMs)}`,
    );
  }
  lines.push("");
  return lines;
}

function launchSection(launch: LaunchReport, home: RegExp | null): string[] {
  const lines: string[] = [`#### ${launch.name} — last written ${formatTime(launch.activeMs)}`, ""];
  if (launch.main) lines.push(...mainSection(launch.main, launch, home));
  else lines.push("`main.log` is not present in this launch directory.", "");
  for (const window of launch.windows) lines.push(...windowSection(window, home));
  return lines;
}

function rootSection(root: LogRootReport, home: RegExp | null): string[] {
  const lines: string[] = [`### ${root.label} — \`${abbreviate(root.path, home)}\``, ""];
  if (!root.exists) {
    lines.push("Not present on this machine.", "");
    return lines;
  }
  if (root.launches.length === 0) {
    lines.push(
      root.excluded > 0
        ? `${count(root.excluded, "launch directory", "launch directories")} present, all of them empty or outside the time window.`
        : "No launch directories.",
      "",
    );
    return lines;
  }
  lines.push(
    `${count(root.launches.length, "launch directory", "launch directories")} read` +
      (root.excluded > 0 ? `, ${root.excluded} skipped as empty or outside the time window.` : "."),
    "",
  );
  for (const launch of root.launches) lines.push(...launchSection(launch, home));
  return lines;
}

/** Individually listed while a reason covers few enough files to stay readable. */
const SKIP_DETAIL_LIMIT = 6;

/**
 * Skips grouped by reason, so the appendix argues a rule once rather than per file.
 *
 * Within a reason, collapsed by file name once there are more than a handful — a machine with a
 * dozen windows refuses the same six uninteresting logs in each, and listing all seventy buries the
 * section that matters under the section that does not. Nothing is dropped: every file is still
 * accounted for by name and count, which is what the appendix owes a reader who cannot audit the
 * machine themselves. The group that carries the privacy argument is named per extension and is
 * small by nature, so it stays itemised on any ordinary machine.
 */
function skipSection(skips: readonly SkipRecord[], home: RegExp | null): string[] {
  if (skips.length === 0) return ["Nothing was found that had to be refused.", ""];
  const byReason = new Map<string, SkipRecord[]>();
  for (const skip of skips) {
    const existing = byReason.get(skip.why);
    if (existing) existing.push(skip);
    else byReason.set(skip.why, [skip]);
  }
  const lines: string[] = [];
  for (const [why, records] of byReason) {
    lines.push(`**${why}**`, "");
    if (records.length <= SKIP_DETAIL_LIMIT) {
      for (const record of records) {
        lines.push(
          `- \`${abbreviate(record.path, home)}\` — ` +
            (record.files === null
              ? `${formatBytes(record.size)}, ${formatTime(record.modifiedMs)}`
              : `${count(record.files, "file")}, ${formatBytes(record.size)}, last written ${formatTime(record.modifiedMs)}`),
        );
      }
      lines.push("");
      continue;
    }
    const byLeaf = new Map<string, { n: number; size: number; newest: number }>();
    for (const record of records) {
      const key = lastSegment(record.path);
      const seen = byLeaf.get(key) ?? { n: 0, size: 0, newest: 0 };
      seen.n += record.files ?? 1;
      seen.size += record.size;
      seen.newest = Math.max(seen.newest, record.modifiedMs);
      byLeaf.set(key, seen);
    }
    for (const [name, seen] of [...byLeaf].sort((a, b) => b[1].size - a[1].size)) {
      lines.push(
        `- \`${name}\` — ${count(seen.n, "file")}, ${formatBytes(seen.size)}, ` +
          `newest ${formatTime(seen.newest)}`,
      );
    }
    lines.push("");
  }
  return lines;
}

/** The whole diagnostic as markdown. */
export function formatDoctor(report: DoctorReport): string {
  const home = homePattern(report.home);
  const lines: string[] = ["# rigline doctor", ""];

  lines.push(`- generated: ${formatTime(report.generatedAtMs)} (local time)`);
  lines.push(
    `- rigline ${report.riglineVersion} on ${report.platform}, node ${report.nodeVersion}`,
  );
  lines.push(
    `- log window: ${
      report.sinceMs === null
        ? "every launch directory"
        : `the last ${formatWindow(report.sinceMs)}${report.sinceMs === DEFAULT_SINCE_MS ? " (the default)" : ""}, plus the most recent launch with any content`
    }`,
  );
  lines.push("- home paths are shortened to `~`; this is cosmetic, not the redaction");
  lines.push("");
  for (const problem of report.problems) lines.push(`> ${abbreviate(problem, home)}`, "");

  lines.push("## Installed extensions", "");
  if (report.installs.length === 0) {
    lines.push(
      "No Claude Code extension directory was found. If the panel is open, VS Code is serving it " +
        "from a directory this did not see — which is itself worth reporting.",
      "",
    );
  } else {
    for (const install of report.installs) lines.push(...installSection(install, home));
  }

  lines.push("## VS Code logs", "");
  for (const root of report.roots) lines.push(...rootSection(root, home));

  lines.push("## What this report read", "");
  if (report.reads.length === 0) {
    lines.push("No log file was opened.", "");
  } else {
    for (const read of report.reads) {
      lines.push(
        `- \`${abbreviate(read.path, home)}\` — ${read.what}, ${formatBytes(read.size)}, ` +
          `${formatTime(read.modifiedMs)}`,
      );
    }
    lines.push("");
  }

  lines.push("## What this report deliberately did not read", "");
  lines.push(
    "These were found and left unopened. The collector never reads them, so no filter has to " +
      "remember to remove them afterwards.",
    "",
  );
  lines.push(...skipSection(report.skips, home));

  return `${tighten(lines).join("\n").trimEnd()}\n`;
}
