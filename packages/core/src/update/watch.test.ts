/**
 * The watcher, against a fake extensions directory only (D39). What is under test is the one thing
 * the watcher decides for itself — when an update has happened — because everything after that is
 * `update`, which has its own tests.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { harvestableHostReplies, harvestableWebview } from "../../test/fixtures.ts";
import { EXTENSION_NAME_PREFIX } from "../extension/locate.ts";
import type { FlowReport } from "./flow.ts";
import { watch } from "./watch.ts";

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.useRealTimers();
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
  const dir = tempDir("rigline-payload-");
  writeFileSync(join(dir, "pre.js"), "export default 1;\n");
  writeFileSync(join(dir, "post.js"), "export default 2;\n");
  return dir;
}

function options(extensionsDir: string, reports: FlowReport[], errors: unknown[] = []) {
  return {
    extensionsDir,
    payloadDir: payload(),
    dir: tempDir("rigline-cwd-"),
    baselinePath: join(tempDir("rigline-home-"), "baseline.json"),
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

  it("survives a directory it cannot harvest, because the next pass usually can", () => {
    vi.useFakeTimers();
    const extensionsDir = tempDir("rigline-exts-");
    installVersion(extensionsDir, "2.1.268");
    const reports: FlowReport[] = [];
    const errors: unknown[] = [];

    const watcher = watch(options(extensionsDir, reports, errors));
    try {
      expect(errors).toEqual([]);

      // Half-written, the way a directory looks while VS Code is still unpacking into it.
      const half = join(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.271-win32-x64`);
      mkdirSync(join(half, "webview"), { recursive: true });
      writeFileSync(join(half, "package.json"), JSON.stringify({ version: "2.1.271" }));
      vi.advanceTimersByTime(30);
      expect(errors).toHaveLength(1);

      // Finished. The watcher is still running and picks it up.
      cpSync(join(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.268-win32-x64`), half, {
        recursive: true,
      });
      writeFileSync(join(half, "package.json"), JSON.stringify({ version: "2.1.271" }));
      rmSync(join(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.268-win32-x64`), {
        recursive: true,
        force: true,
      });
      vi.advanceTimersByTime(30);
      expect(reports.at(-1)?.versions.map((v) => v.version)).toEqual(["2.1.271"]);
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
