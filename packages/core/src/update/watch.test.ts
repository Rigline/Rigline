/**
 * The watcher, against a fake extensions directory only (D39). What is under test is the one thing
 * the watcher decides for itself — when an update has happened — because everything after that is
 * `update`, which has its own tests.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harvestableHostReplies, harvestableWebview, writePayload } from "../../test/fixtures.ts";
import { EXTENSION_NAME_PREFIX } from "../extension/locate.ts";
import { RIGLINE_HOME_VARIABLE } from "../paths.ts";
import type { FlowReport } from "./flow.ts";
import { watch } from "./watch.ts";

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** The flow's defaults, the injection lock among them, point into a temporary home (D39). */
beforeEach(() => {
  process.env[RIGLINE_HOME_VARIABLE] = tempDir("rigline-home-env-");
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env[RIGLINE_HOME_VARIABLE];
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An extension directory inside a fake extensions root, named the way VS Code names one. */
function installVersion(extensionsDir: string, version: string): string {
  const ext = join(extensionsDir, `${EXTENSION_NAME_PREFIX}${version}-win32-x64`);
  const { js, css } = harvestableWebview();
  mkdirSync(join(ext, "webview"), { recursive: true });
  writeFileSync(join(ext, "webview", "index.js"), js);
  writeFileSync(join(ext, "webview", "index.css"), css);
  writeFileSync(join(ext, "extension.js"), harvestableHostReplies());
  writeFileSync(join(ext, "package.json"), JSON.stringify({ version }));
  return ext;
}

function payload(): string {
  return writePayload(tempDir("rigline-payload-"));
}

function options(extensionsDir: string, reports: FlowReport[], errors: unknown[] = []) {
  return {
    extensionsDir,
    payloadDir: payload(),
    dir: tempDir("rigline-cwd-"),
    baselinePath: join(tempDir("rigline-home-"), "baseline.json"),
    // No quarter-second sample per version per run: nothing here is written while it is read.
    wholeness: { sleep: () => {} },
    intervalMs: 10,
    onReport: (report: FlowReport) => reports.push(report),
    onError: (error: unknown) => errors.push(error),
  };
}

describe("watch", () => {
  it("runs once at once, because the update may already have removed the loader", () => {
    vi.useFakeTimers();
    const extensionsDir = tempDir("rigline-exts-");
    installVersion(extensionsDir, "2.1.268");
    const reports: FlowReport[] = [];

    const watcher = watch(options(extensionsDir, reports));
    try {
      expect(reports).toHaveLength(1);
      expect(reports[0]?.versions.map((v) => v.version)).toEqual(["2.1.268"]);
    } finally {
      watcher.stop();
    }
  });

  it("runs again when a new version appears beside the old one, and reports both (D4)", () => {
    vi.useFakeTimers();
    const extensionsDir = tempDir("rigline-exts-");
    installVersion(extensionsDir, "2.1.268");
    const reports: FlowReport[] = [];

    const watcher = watch(options(extensionsDir, reports));
    try {
      vi.advanceTimersByTime(30);
      expect(reports).toHaveLength(1);

      installVersion(extensionsDir, "2.1.270");
      vi.advanceTimersByTime(30);

      expect(reports).toHaveLength(2);
      expect(reports[1]?.versions.map((v) => v.version)).toEqual(["2.1.268", "2.1.270"]);
    } finally {
      watcher.stop();
    }
  });

  it("runs again when the old directory is deleted, which is the other half of an update", () => {
    vi.useFakeTimers();
    const extensionsDir = tempDir("rigline-exts-");
    const old = installVersion(extensionsDir, "2.1.268");
    installVersion(extensionsDir, "2.1.270");
    const reports: FlowReport[] = [];

    const watcher = watch(options(extensionsDir, reports));
    try {
      rmSync(old, { recursive: true, force: true });
      vi.advanceTimersByTime(30);
      expect(reports).toHaveLength(2);
      expect(reports[1]?.versions.map((v) => v.version)).toEqual(["2.1.270"]);
    } finally {
      watcher.stop();
    }
  });

  it("stays quiet while nothing changes, however often it looks", () => {
    vi.useFakeTimers();
    const extensionsDir = tempDir("rigline-exts-");
    installVersion(extensionsDir, "2.1.270");
    const reports: FlowReport[] = [];

    const watcher = watch(options(extensionsDir, reports));
    try {
      vi.advanceTimersByTime(1000);
      expect(reports).toHaveLength(1);
    } finally {
      watcher.stop();
    }
  });

  it("keeps a directory still being written outstanding, and takes it once finished (D81)", () => {
    vi.useFakeTimers();
    const extensionsDir = tempDir("rigline-exts-");
    const old = installVersion(extensionsDir, "2.1.268");
    const reports: FlowReport[] = [];
    const errors: unknown[] = [];

    const watcher = watch(options(extensionsDir, reports, errors));
    try {
      // Half-written, the way a directory looks while VS Code is still unpacking into it.
      const half = join(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.271-win32-x64`);
      mkdirSync(join(half, "webview"), { recursive: true });
      writeFileSync(join(half, "package.json"), JSON.stringify({ version: "2.1.271" }));
      vi.advanceTimersByTime(10);
      const seen = reports.at(-1)?.versions;
      expect(seen?.find((v) => v.version === "2.1.271")?.refused?.kind).toBe("unfinished");
      // The version beside it was not held up by it (D104).
      expect(seen?.find((v) => v.version === "2.1.268")?.action).not.toBeNull();

      // Finished in place, so the listing never changes again, and the watcher still takes it.
      cpSync(old, half, { recursive: true });
      writeFileSync(join(half, "package.json"), JSON.stringify({ version: "2.1.271" }));
      vi.advanceTimersByTime(10);
      expect(reports.at(-1)?.versions.map((v) => v.refused)).toEqual([null, null]);

      // Dealt with, so it stops there.
      const settled = reports.length;
      vi.advanceTimersByTime(100);
      expect(reports).toHaveLength(settled);
      expect(errors).toEqual([]);
    } finally {
      watcher.stop();
    }
  });

  it("does not keep retrying a version Rigline cannot read, since only a release changes that", () => {
    vi.useFakeTimers();
    const extensionsDir = tempDir("rigline-exts-");
    installVersion(extensionsDir, "2.1.268");
    const reports: FlowReport[] = [];

    const watcher = watch(options(extensionsDir, reports));
    try {
      const unreadable = installVersion(extensionsDir, "2.1.272");
      writeFileSync(join(unreadable, "webview", "index.js"), "var nothing=1;");
      vi.advanceTimersByTime(10);
      const settled = reports.length;
      expect(reports.at(-1)?.versions.at(-1)?.refused?.kind).toBe("unreadable");

      vi.advanceTimersByTime(100);
      expect(reports).toHaveLength(settled);
    } finally {
      watcher.stop();
    }
  });

  it("stops looking once stopped", () => {
    vi.useFakeTimers();
    const extensionsDir = tempDir("rigline-exts-");
    installVersion(extensionsDir, "2.1.268");
    const reports: FlowReport[] = [];

    const watcher = watch(options(extensionsDir, reports));
    watcher.stop();
    installVersion(extensionsDir, "2.1.270");
    vi.advanceTimersByTime(1000);
    expect(reports).toHaveLength(1);
  });
});
