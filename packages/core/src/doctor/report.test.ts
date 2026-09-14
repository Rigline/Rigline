/**
 * The markdown formatter, against a hand-built report rather than a collected one.
 *
 * Building the `DoctorReport` by hand is the point: the formatter's job is to render whatever the
 * collector produced, including the awkward cases a real walk rarely produces on demand — an
 * episode that never recovered, a recovery that is really a window close, a registry that could not
 * be read. Driving it through `collect` would make those cases fixtures on disk instead.
 */
import { describe, expect, it } from "vitest";
import type { DoctorReport } from "./collect.ts";
import type { UnresponsiveEpisode } from "./logs.ts";
import { formatBytes, formatDoctor, formatDuration, formatTime, formatWindow } from "./report.ts";

const AT = new Date(2026, 8, 14, 11, 42, 0).getTime();

function reportWith(overrides: Partial<DoctorReport> = {}): DoctorReport {
  return {
    generatedAtMs: AT,
    platform: "win32",
    home: "C:\\Users\\tester",
    nodeVersion: "v26.5.0",
    riglineVersion: "1.0.0-alpha.0",
    sinceMs: 24 * 3_600_000,
    installs: [],
    problems: [],
    roots: [],
    reads: [],
    skips: [],
    ...overrides,
  };
}

const EPISODE: UnresponsiveEpisode = {
  detectedAt: "2026-09-14 11:41:45.990",
  recoveredAt: "2026-09-14 11:42:22.241",
  durationMs: 36_251,
  closedBy: { at: "2026-09-14 11:42:23.738", pid: 61184, detail: "code: 0, signal: unknown." },
  samples: [
    {
      at: "2026-09-14 11:42:22.238",
      lines: [
        "<3> ",
        "    at vscode-file://vscode-app/c:/Users/tester/out/workbench.desktop.main.js:1141:10738",
        "Total Samples: 3",
      ],
      totalSamples: 3,
    },
  ],
  uncaught: [],
};

function withLaunch(episode: UnresponsiveEpisode): DoctorReport {
  return reportWith({
    roots: [
      {
        label: "Code",
        path: "C:\\Users\\tester\\AppData\\Roaming\\Code\\logs",
        exists: true,
        excluded: 2,
        launches: [
          {
            name: "20260914T110000",
            path: "C:\\Users\\tester\\AppData\\Roaming\\Code\\logs\\20260914T110000",
            activeMs: AT,
            main: {
              episodes: [episode],
              exits: [],
              orphanRecoveries: [],
              straySamples: [],
              duplicateRecoveries: 0,
            },
            windows: [],
          },
        ],
      },
    ],
  });
}

describe("formatDoctor", () => {
  it("leads with what the report is and how it was bounded", () => {
    const text = formatDoctor(reportWith());
    expect(text.startsWith("# rigline doctor\n")).toBe(true);
    expect(text).toContain("rigline 1.0.0-alpha.0 on win32, node v26.5.0");
    expect(text).toContain("the last 1 day (the default)");
    expect(text).toContain("No Claude Code extension directory was found.");
  });

  it("shortens the home directory in both spellings, and says the shortening is cosmetic", () => {
    const text = formatDoctor(withLaunch(EPISODE));
    expect(text).not.toContain("Users\\tester");
    expect(text).not.toContain("Users/tester");
    expect(text).toContain("`~\\AppData\\Roaming\\Code\\logs`");
    // The forward-slash spelling inside a stack frame is reached by the same pattern.
    expect(text).toContain("at vscode-file://vscode-app/~/out/workbench.desktop.main.js");
    expect(text).toContain("cosmetic, not the redaction");
  });

  it("says plainly when a recovery is really the window closing", () => {
    const text = formatDoctor(withLaunch(EPISODE));
    expect(text).toContain("**1. 2026-09-14 11:41:45.990 to 11:42:22.241, 36.3s**");
    expect(text).toContain("being **closed**, not recovering");
    expect(text).toContain("pid 61184");
    expect(text).toContain("lower bound");
  });

  it("keeps a sample block verbatim inside a fence, trailing space and all", () => {
    const text = formatDoctor(withLaunch(EPISODE));
    expect(text).toContain("Samples at 11:42:22.238 (3 samples):");
    expect(text).toContain("```\n<3> \n");
    expect(text).toContain("Total Samples: 3\n```");
  });

  it("reports an episode that never recovered as exactly that", () => {
    const text = formatDoctor(
      withLaunch({ ...EPISODE, recoveredAt: null, closedBy: null, durationMs: null }),
    );
    expect(text).toContain("never recorded as recovering");
    expect(text).toContain("still locked up");
  });

  it("names every file it read and every file it refused", () => {
    const text = formatDoctor(
      reportWith({
        reads: [
          {
            path: "C:\\Users\\tester\\AppData\\Roaming\\Code\\logs\\20260914T110000\\main.log",
            size: 17_655,
            modifiedMs: AT,
            what: "main process log",
          },
        ],
        skips: [
          {
            path: "C:\\Users\\tester\\AppData\\Roaming\\Code\\logs\\20260914T110000\\window1\\exthost\\Anthropic.claude-code",
            size: 4_344_385,
            modifiedMs: AT,
            files: 1,
            why: "per-extension output channel: prompts, tool commands, file paths and session ids (D53)",
          },
        ],
      }),
    );
    expect(text).toContain("## What this report read");
    expect(text).toContain("main process log, 17.2 KB");
    expect(text).toContain("## What this report deliberately did not read");
    expect(text).toContain("**per-extension output channel");
    expect(text).toContain("Anthropic.claude-code` — 1 file, 4.1 MB");
  });

  it("renders an install with no backup as the recovery problem it is", () => {
    const text = formatDoctor(
      reportWith({
        installs: [
          {
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
          },
        ],
      }),
    );
    expect(text).toContain("### 2.1.270");
    expect(text).toContain("loader marker present");
    expect(text).toContain("absent, so nothing can restore this version");
    expect(text).toContain("- payload: not installed");
    expect(text).toContain("- problem: the payload is missing pre.js");
  });

  it("leaves no run of blank lines outside a fence", () => {
    expect(formatDoctor(withLaunch(EPISODE))).not.toMatch(/\n\n\n/);
  });
});

describe("display helpers", () => {
  it("scales bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(17_655)).toBe("17.2 KB");
    expect(formatBytes(4_344_385)).toBe("4.1 MB");
  });

  it("renders a lockup to a tenth of a second and a search window in plain words", () => {
    expect(formatDuration(900)).toBe("900ms");
    expect(formatDuration(36_251)).toBe("36.3s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatWindow(24 * 3_600_000)).toBe("1 day");
    expect(formatWindow(7 * 24 * 3_600_000)).toBe("7 days");
    expect(formatWindow(90 * 60_000)).toBe("90 minutes");
  });

  it("renders a timestamp the way VS Code writes one", () => {
    expect(formatTime(new Date(2026, 8, 14, 9, 5, 3).getTime())).toBe("2026-09-14 09:05:03");
  });
});
