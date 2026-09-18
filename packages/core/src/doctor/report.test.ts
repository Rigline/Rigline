/**
 * The markdown formatter, against a hand-built report rather than a collected one.
 *
 * Building the `DoctorReport` by hand is the point: the formatter's job is to render whatever the
 * collector produced, including the cases a real machine rarely produces on demand — a patched
 * bundle with no backup, a registry that could not be read. Driving it through `collect` would make
 * those fixtures on disk instead.
 */
import { describe, expect, it } from "vitest";
import type { DoctorReport } from "./collect.ts";
import { formatBytes, formatDoctor, formatTime } from "./report.ts";

const AT = new Date(2026, 8, 14, 11, 42, 0).getTime();

function reportWith(overrides: Partial<DoctorReport> = {}): DoctorReport {
  return {
    generatedAtMs: AT,
    platform: "win32",
    home: "C:\\Users\\tester",
    nodeVersion: "v26.5.0",
    riglineVersion: "1.0.0-alpha.0",
    installs: [],
    problems: [],
    ...overrides,
  };
}

const INSTALL: DoctorReport["installs"][number] = {
  ext: "C:\\Users\\tester\\.vscode\\extensions\\anthropic.claude-code-2.1.270",
  version: "2.1.270",
  webview: "patched",
  host: "vanilla",
  markerPresent: true,
  webviewBackup: null,
  hostBackup: null,
  payloadDir:
    "C:\\Users\\tester\\.vscode\\extensions\\anthropic.claude-code-2.1.270\\webview\\rigline",
  payload: [],
  registry: { plugins: [], patches: [], problem: "not installed" },
  problems: ["the payload is missing pre.js"],
};

describe("formatDoctor", () => {
  it("leads with what the report is", () => {
    const text = formatDoctor(reportWith());
    expect(text.startsWith("# rigline doctor\n")).toBe(true);
    expect(text).toContain("rigline 1.0.0-alpha.0 on win32, node v26.5.0");
    expect(text).toContain("No Claude Code extension directory was found.");
  });

  it("shortens the home directory in every spelling a path takes", () => {
    const text = formatDoctor(reportWith({ installs: [INSTALL] }));
    expect(text).not.toContain("Users\\tester");
    expect(text).not.toContain("Users/tester");
    expect(text).toContain("`~\\.vscode\\extensions\\anthropic.claude-code-2.1.270`");
  });

  it("renders an install with no backup as the recovery problem it is", () => {
    const text = formatDoctor(reportWith({ installs: [INSTALL] }));
    expect(text).toContain("### 2.1.270");
    expect(text).toContain("loader marker present");
    expect(text).toContain("absent, so nothing can restore this version");
    expect(text).toContain("- payload: not installed");
    expect(text).toContain("- plugins: registry not read (not installed)");
    expect(text).toContain("- problem: the payload is missing pre.js");
  });

  it("names the plugins baked in, and any host patch applied for one", () => {
    const text = formatDoctor(
      reportWith({
        installs: [
          {
            ...INSTALL,
            host: "patched",
            registry: {
              plugins: [
                { name: "session-id", surfaces: [], patchRefusal: null },
                { name: "worktree-prefix", surfaces: [], patchRefusal: null },
              ],
              patches: [
                {
                  plugin: "worktree-prefix",
                  applied: true,
                  required: false,
                  why: "worktree list",
                },
              ],
              problem: null,
            },
          },
        ],
      }),
    );
    expect(text).toContain("- plugins baked in: session-id, worktree-prefix");
    expect(text).toContain("- host patch applied (worktree-prefix): worktree list");
  });

  it("points at the probe for what the panel itself was doing", () => {
    expect(formatDoctor(reportWith())).toContain("copy the probe's report");
  });

  it("leaves no run of blank lines", () => {
    expect(formatDoctor(reportWith({ installs: [INSTALL] }))).not.toMatch(/\n\n\n/);
  });
});

describe("display helpers", () => {
  it("scales bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(17_655)).toBe("17.2 KB");
    expect(formatBytes(4_344_385)).toBe("4.1 MB");
  });

  it("renders a timestamp in local time", () => {
    expect(formatTime(new Date(2026, 8, 14, 9, 5, 3).getTime())).toBe("2026-09-14 09:05:03");
  });
});
