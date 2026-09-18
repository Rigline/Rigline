/**
 * The collector, against disposable extension directories.
 *
 * Never against this machine's live install, for the reason D39 gives: an assertion that fails
 * mid-test would leave a real one half-read, and the contents would vary per machine and per day.
 *
 * What is worth pinning here is that nothing throws. `doctor` is run by somebody whose panel has
 * just misbehaved, so an unreadable directory has to become a line in the report rather than an
 * exception that leaves them with nothing to paste.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collect } from "./collect.ts";
import { formatDoctor } from "./report.ts";

const NOW = new Date(2026, 8, 14, 12, 0, 0).getTime();
const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A disposable extension directory. With a backup matching the live bundle it reads `vanilla` — a
 * version Rigline installed into and then restored. Without one it reads `unknown`, which is an
 * extension nothing has ever touched: D38 makes the backup the authority, not the marker.
 */
function ext(version: string, options: { readonly backup?: boolean } = {}): string {
  const root = tempDir("rigline-doctor-ext-");
  const dir = join(root, `anthropic.claude-code-${version}`);
  mkdirSync(join(dir, "webview"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version }));
  writeFileSync(join(dir, "webview", "index.js"), "BUNDLE");
  if (options.backup) writeFileSync(join(dir, "webview", "index.js.orig"), "BUNDLE");
  writeFileSync(join(dir, "extension.js"), "HOST");
  return dir;
}

describe("collect", () => {
  it("reports a restored install as vanilla, with no payload and no plugins", () => {
    const report = collect({
      exts: [ext("2.1.270", { backup: true })],
      now: NOW,
      home: "/nowhere",
    });
    const install = report.installs[0];
    expect(install?.version).toBe("2.1.270");
    expect(install?.webview).toBe("vanilla");
    expect(install?.markerPresent).toBe(false);
    expect(install?.payload).toEqual([]);
    expect(install?.registry.problem).toBe("not installed");
    expect(report.problems).toEqual([]);
  });

  it("carries the environment a bug report needs before anything else", () => {
    const report = collect({ exts: [], now: NOW, platform: "win32", home: "/nowhere" });
    expect(report.generatedAtMs).toBe(NOW);
    expect(report.platform).toBe("win32");
    expect(report.riglineVersion).toMatch(/^\d/);
    expect(report.nodeVersion).toBe(process.version);
  });

  it("says so when there is no extension directory, rather than failing", () => {
    const report = collect({ exts: [], now: NOW, home: "/nowhere" });
    expect(report.problems).toContain("no Claude Code extension directory was found");
    expect(() => formatDoctor(report)).not.toThrow();
  });

  it("turns an unreadable directory into a problem line and carries on", () => {
    const gone = join(tempDir("rigline-doctor-gone-"), "anthropic.claude-code-2.1.270");
    const report = collect({ exts: [gone, ext("2.1.271")], now: NOW, home: "/nowhere" });
    expect(report.installs).toHaveLength(2);
    expect(report.installs[0]?.problems.length).toBeGreaterThan(0);
    expect(report.installs[1]?.version).toBe("2.1.271");
    expect(() => formatDoctor(report)).not.toThrow();
  });
});
