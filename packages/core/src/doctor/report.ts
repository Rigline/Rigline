/**
 * Rendering a collected diagnostic as markdown somebody can paste into an issue (D53).
 *
 * Pure: it takes the report `collect` produced and returns text.
 *
 * It abbreviates the user's home directory to `~` wherever it appears, because on Windows that
 * carries the account name and a report pasted in public would otherwise announce it a dozen times.
 * Cosmetic rather than load-bearing: this report only contains files Rigline itself wrote.
 *
 * The document is ordered for the person reading the issue — what Rigline is, then one section per
 * installed extension version, so a reader who stops after the first screen still knows which build
 * this is about.
 */

import type { AnchorOverrides } from "../anchors/overrides.ts";
import { CORE_VERSION } from "../version.ts";
import type { DoctorReport } from "./collect.ts";
import type { InstallState } from "./install.ts";

/**
 * The user's home directory as a pattern that matches every spelling a path can take.
 *
 * Three, on Windows: `c:\Users\name`, `c:/Users/name`, and `c%3A/Users/name` where a drive colon is
 * percent-encoded inside a URI. Matching only the first would leave the account name in the report
 * while appearing to have removed it, which is worse than not trying.
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

/** Local time, to match the local timestamps everything else on this machine writes. */
export function formatTime(ms: number): string {
  const at = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}

/**
 * Collapses runs of blank lines.
 *
 * Each section below ends with a blank line and begins with one, which is what keeps them
 * composable; the join would otherwise leave doubles all through the document.
 */
function tighten(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line === "" && out.at(-1) === "") continue;
    out.push(line);
  }
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

  const { engine, plugins, patches, problem } = install.registry;
  // Against `CORE_VERSION` rather than on its own, because the number alone answers nothing: what
  // a reader needs to know is whether this payload is the one the engine in front of them would
  // write, and a payload that predates the stamp is the oldest answer there is (D75).
  if (install.payload.length > 0) {
    lines.push(
      engine === null
        ? `- written by: an engine older than ${CORE_VERSION}, which stamped nothing`
        : engine === CORE_VERSION
          ? `- written by: ${engine}, which is this engine`
          : `- written by: ${engine}, and this engine is ${CORE_VERSION} — re-run \`rigline install\``,
    );
  }
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

/**
 * The local anchor table, where it is not the shipped one (D44).
 *
 * A section rather than a line, and present even when the file is absent, because "no overrides"
 * is the answer a reader of the issue needs as much as a list of them: an anchor resolving
 * differently here than anywhere else is otherwise invisible by the time anybody looks, the
 * tables having been baked into the payload at install.
 */
function overrideSection(overrides: AnchorOverrides, home: RegExp | null): string[] {
  const lines: string[] = ["## Anchor overrides", ""];
  if (!overrides.present) {
    lines.push("None: the anchor table is the one Rigline ships.", "");
    return lines;
  }
  lines.push(`From \`${abbreviate(overrides.path, home)}\`:`, "");
  if (overrides.names.length === 0) {
    lines.push("- the file is there, and no entry in it applied", "");
  }
  for (const name of overrides.names) {
    lines.push(
      `- \`${name}\`${overrides.added.includes(name) ? " (added, not a curated name)" : ""}`,
    );
  }
  for (const problem of overrides.problems) lines.push(`- problem: ${abbreviate(problem, home)}`);
  lines.push("");
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
  lines.push("- home paths are shortened to `~`");
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

  lines.push(...overrideSection(report.anchorOverrides, home));

  lines.push(
    "## What is not here",
    "",
    "This report covers only files Rigline wrote or patched. For what the panel itself was doing, " +
      "copy the probe's report from the `RIG` badge in the composer footer.",
    "",
  );

  return `${tighten(lines).join("\n").trimEnd()}\n`;
}
