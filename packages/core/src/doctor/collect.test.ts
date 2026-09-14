/**
 * The collector, against a disposable log tree built to look like a real one.
 *
 * Never against this machine's own `%APPDATA%\Code\logs`, for the same reason D39 keeps tests off
 * the live extension directory: the contents would vary per machine and per day, and the one
 * assertion that matters here — that a per-extension output channel is never opened — would pass
 * vacuously on a profile that happened not to have one.
 *
 * The fixture therefore includes every trap the real directory has: a launch directory that is
 * empty because VS Code created it for a start that handed off to a window already open, a
 * per-extension channel log, an `output_logging_*` tree, and window-level logs that are out of
 * scope.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserError } from "../errors.ts";
import {
  collect,
  launchActivityMs,
  logRootCandidates,
  parseSince,
  SKIP_REASONS,
  selectLaunches,
} from "./collect.ts";
import { formatDoctor } from "./report.ts";

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(path: string, text: string, atMs?: number): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  if (atMs !== undefined) stamp(path, atMs);
}

/**
 * Sets a path's modification time. Directories have to be stamped after every file inside them has
 * been written, because writing a file moves its directory's mtime — which is the same reason
 * `launchActivityMs` cannot trust a directory's mtime to tell it when a log was last appended to.
 */
function stamp(path: string, atMs: number): void {
  utimesSync(path, atMs / 1000, atMs / 1000);
}

/** The one string that must never appear in a report, whatever else changes. */
const SECRET = "SECRET-PROMPT-CONTENT-THAT-MUST-NOT-LEAK";

const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);
const HOUR = 3_600_000;

/**
 * A log root with three launches: one current, one a week old with content, and one current but
 * empty — the handoff directory that makes "the newest directory" the wrong default.
 */
function logRoot(): string {
  const root = tempDir("rigline-doctor-logs-");

  const live = join(root, "20260914T110000");
  write(
    join(live, "main.log"),
    [
      "2026-09-14 11:41:45.990 [error] CodeWindow: detected unresponsive",
      "2026-09-14 11:42:22.238 [error] CodeWindow unresponsive samples:",
      "<3> ",
      "    at vscode-file://vscode-app/out/workbench.desktop.main.js:1141:10738",
      "Total Samples: 3",
      "2026-09-14 11:42:22.241 [error] CodeWindow: recovered from unresponsive",
      "2026-09-14 11:42:23.738 [info] Extension host with pid 61184 exited with code: 0, signal: unknown.",
    ].join("\n"),
    NOW - HOUR,
  );
  const window = join(live, "window1");
  write(
    join(window, "renderer.log"),
    [
      "2026-09-14 11:40:00.000 [info] Started local extension host with pid 61184.",
      "2026-09-14 11:41:00.000 [error] Ignoring jetbrains.kotlin.hints.parameters.compiled",
    ].join("\n"),
    NOW - HOUR,
  );
  write(join(window, "network.log"), "", NOW - HOUR);
  write(join(window, "output_20260914T110000", "tasks.log"), "tasks", NOW - HOUR);
  const exthost = join(window, "exthost");
  write(
    join(exthost, "exthost.log"),
    [
      "2026-09-14 11:41:30.000 [error] Error: Channel has been closed",
      "\tat Object.stderr (extension.js:988:10457)",
    ].join("\n"),
    NOW - HOUR,
  );
  write(join(exthost, "extHostTelemetry.log"), "", NOW - HOUR);
  write(join(exthost, "Anthropic.claude-code", "Claude VSCode.log"), SECRET, NOW - HOUR);
  write(join(exthost, "output_logging_20260914T110001", "1-Git Graph.log"), SECRET, NOW - HOUR);

  const old = join(root, "20260907T090000");
  write(join(old, "main.log"), "2026-09-07 09:00:00.000 [info] nothing happened", NOW - 168 * HOUR);

  // The trap: VS Code created this for a start that handed off to a window already open, so it has
  // the newest name on disk and nothing whatever inside it.
  const handoff = join(root, "20260914T115900");
  mkdirSync(handoff, { recursive: true });

  for (const dir of [
    join(exthost, "Anthropic.claude-code"),
    join(exthost, "output_logging_20260914T110001"),
    exthost,
    join(window, "output_20260914T110000"),
    window,
    live,
  ]) {
    stamp(dir, NOW - HOUR);
  }
  stamp(old, NOW - 168 * HOUR);
  stamp(handoff, NOW - 60_000);

  return root;
}

function report(sinceMs: number | null = 24 * HOUR) {
  return collect({
    exts: [],
    logRoots: [{ label: "Code", path: logRoot() }],
    sinceMs,
    now: NOW,
    home: "/nowhere",
  });
}

describe("collect", () => {
  it("reads main.log, renderer.log and exthost.log, and nothing else", () => {
    const read = report().reads.map((r) => r.path.split(/[\\/]/).slice(-2).join("/"));
    expect(read).toEqual([
      "20260914T110000/main.log",
      "window1/renderer.log",
      "exthost/exthost.log",
    ]);
  });

  it("never opens the extension's own output channel, and says why", () => {
    const skipped = report().skips;
    const channel = skipped.find((s) => s.path.endsWith("Anthropic.claude-code"));
    expect(channel?.why).toBe(SKIP_REASONS.extensionChannel);
    expect(channel?.files).toBe(1);
    expect(channel?.size).toBe(SECRET.length);
  });

  it("refuses captured output channels, telemetry and out-of-scope window logs by name", () => {
    const byWhy = (why: string) =>
      report()
        .skips.filter((s) => s.why === why)
        .map((s) => s.path.split(/[\\/]/).at(-1))
        .sort();
    expect(byWhy(SKIP_REASONS.outputLogging)).toEqual([
      "output_20260914T110000",
      "output_logging_20260914T110001",
    ]);
    expect(byWhy(SKIP_REASONS.telemetry)).toEqual(["extHostTelemetry.log"]);
    expect(byWhy(SKIP_REASONS.outOfScope)).toEqual(["network.log"]);
  });

  it("cannot leak what it did not read, all the way through to the rendered report", () => {
    // The load-bearing test. Redaction here is a property of what was opened (D53), so the proof
    // is that the secret is absent from the document even though the collector walked its directory
    // and reported its size.
    const markdown = formatDoctor(report());
    expect(markdown).not.toContain(SECRET);
    expect(markdown).toContain("Anthropic.claude-code");
    expect(markdown).toContain("deliberately did not read");
  });

  it("parses what it did read", () => {
    const launch = report().roots[0]?.launches[0];
    expect(launch?.name).toBe("20260914T110000");
    expect(launch?.main?.episodes).toHaveLength(1);
    // The recovery is 1.5s before an extension host exit, so it is the window closing.
    expect(launch?.main?.episodes[0]?.closedBy?.pid).toBe(61184);
    expect(launch?.windows[0]?.hostStarts).toEqual([{ at: "2026-09-14 11:40:00.000", pid: 61184 }]);
    expect(launch?.windows[0]?.exthost?.total).toBe(1);
  });

  it("excludes launches outside the window but counts them", () => {
    const root = report().roots[0];
    expect(root?.launches.map((l) => l.name)).toEqual(["20260914T110000"]);
    expect(root?.excluded).toBe(2);
  });

  it("reads every launch with content when the window is off, newest first", () => {
    const root = report(null).roots[0];
    expect(root?.launches.map((l) => l.name)).toEqual(["20260914T110000", "20260907T090000"]);
    // The empty handoff directory is still not read: it has nothing to say.
    expect(root?.excluded).toBe(1);
  });

  it("falls back to the newest launch with content, never to the empty handoff directory", () => {
    // Nothing is inside a one-minute window, so the fallback decides — and the directory with the
    // newest name is the empty one VS Code created for a start that handed off.
    const root = collect({
      exts: [],
      logRoots: [{ label: "Code", path: logRoot() }],
      sinceMs: 60_000,
      now: NOW,
      home: "/nowhere",
    }).roots[0];
    expect(root?.launches.map((l) => l.name)).toEqual(["20260914T110000"]);
  });

  it("reports a missing log root as an absence, and still describes the install", () => {
    const result = collect({
      exts: [],
      logRoots: [{ label: "Code", path: join(tempDir("rigline-doctor-none-"), "gone") }],
      now: NOW,
    });
    expect(result.roots[0]?.exists).toBe(false);
    expect(result.problems).toContain("no Claude Code extension directory was found");
    expect(() => formatDoctor(result)).not.toThrow();
  });
});

describe("launchActivityMs", () => {
  it("takes the newest write among the files the collector would read", () => {
    const dir = tempDir("rigline-doctor-activity-");
    write(join(dir, "main.log"), "x", NOW - 10 * HOUR);
    write(join(dir, "window1", "exthost", "exthost.log"), "x", NOW - HOUR);
    // Every directory `launchActivityMs` reads has to be stamped too, and stamped last, or this
    // asserts against the wall clock: a temp directory made now carries now, and `launchActivityMs`
    // seeds from the launch directory's own mtime so that a launch whose logs cannot be read still
    // has an activity time. Left unstamped this passed only while real time was behind `NOW`, which
    // it stopped being a few hours after the test was written.
    stamp(join(dir, "window1", "exthost"), NOW - HOUR);
    stamp(join(dir, "window1"), NOW - HOUR);
    stamp(dir, NOW - 10 * HOUR);
    // The directory's own mtime does not move when a log inside it is appended to, which is why
    // "newest launch directory" cannot be answered from the directory alone.
    expect(launchActivityMs(dir)).toBe(NOW - HOUR);
  });
});

describe("selectLaunches", () => {
  const launches = [
    { name: "20260101T000000", path: "/a", activeMs: 100, hasContent: true },
    { name: "20260102T000000", path: "/b", activeMs: 300, hasContent: true },
    { name: "20260103T000000", path: "/c", activeMs: 400, hasContent: false },
  ];

  it("keeps everything inside the window, newest first, and never an empty directory", () => {
    expect(selectLaunches(launches, 250, 400).map((l) => l.name)).toEqual(["20260102T000000"]);
    expect(selectLaunches(launches, 1000, 400).map((l) => l.name)).toEqual([
      "20260102T000000",
      "20260101T000000",
    ]);
  });

  it("falls back to the newest launch with content when nothing is inside the window", () => {
    expect(selectLaunches(launches, 10, 10_000).map((l) => l.name)).toEqual(["20260102T000000"]);
  });

  it("keeps every launch with content when the window is null", () => {
    expect(selectLaunches(launches, null, 400)).toHaveLength(2);
  });
});

describe("parseSince", () => {
  it("reads minutes, hours and days", () => {
    expect(parseSince("90m")).toBe(90 * 60_000);
    expect(parseSince("24h")).toBe(24 * HOUR);
    expect(parseSince("7d")).toBe(7 * 24 * HOUR);
    expect(parseSince("all")).toBeNull();
  });

  it("refuses anything else with a message that names the forms it takes", () => {
    expect(() => parseSince("yesterday")).toThrow(UserError);
    expect(() => parseSince("24")).toThrow(/24h, 7d, 90m/);
  });
});

describe("logRootCandidates", () => {
  it("finds stable and Insiders logs on each platform", () => {
    expect(logRootCandidates("win32", "/home/t", { APPDATA: "/roaming" })).toEqual([
      { label: "Code", path: join("/roaming", "Code", "logs") },
      { label: "Code - Insiders", path: join("/roaming", "Code - Insiders", "logs") },
    ]);
    expect(logRootCandidates("darwin", "/Users/t", {})[0]?.path).toBe(
      join("/Users/t", "Library", "Application Support", "Code", "logs"),
    );
    expect(logRootCandidates("linux", "/home/t", {})[0]?.path).toBe(
      join("/home/t", ".config", "Code", "logs"),
    );
  });

  it("builds a Windows path from the home directory when APPDATA is not set", () => {
    expect(logRootCandidates("win32", "/home/t", {})[0]?.path).toBe(
      join("/home/t", "AppData", "Roaming", "Code", "logs"),
    );
  });
});
