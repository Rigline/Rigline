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
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMPANION_SIDECAR, companionFingerprint } from "../companion/fingerprint.ts";
import { COMPANION_VSIX } from "../companion/setup.ts";
import { RIGLINE_HOME_VARIABLE } from "../paths.ts";
import { collect } from "./collect.ts";
import { formatDoctor } from "./report.ts";

const NOW = new Date(2026, 8, 14, 12, 0, 0).getTime();
const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/**
 * Every default path this collector reads points into a temporary home, so that a run on a machine
 * with a real `~/.rigline` reads that machine's state instead of the fixture's. D39 in miniature:
 * the live directory is never the thing under test.
 */
let home = "";
beforeEach(() => {
  home = tempDir("rigline-doctor-home-");
  process.env[RIGLINE_HOME_VARIABLE] = home;
});

afterEach(() => {
  delete process.env[RIGLINE_HOME_VARIABLE];
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

  it("carries the local anchor override, which nothing else in a bug report would show", () => {
    const none = collect({ exts: [], now: NOW, home: "/nowhere" });
    expect(none.anchorOverrides.present).toBe(false);
    expect(formatDoctor(none)).toContain("None: the anchor table is the one Rigline ships.");

    writeFileSync(
      join(home, "anchors.json"),
      JSON.stringify({
        anchors: { composer: { refine: "[data-composer]", why: "two controls wear it now" } },
      }),
    );
    const report = collect({ exts: [], now: NOW, home: "/nowhere" });
    expect(report.anchorOverrides.names).toEqual(["composer"]);
    expect(formatDoctor(report)).toContain("`composer`");
  });

  it("says whether each companion beside the extensions is the one this engine carries (D99)", () => {
    const claude = ext("2.1.270");
    const code = "exports.activate = () => {};\n";
    const manifest = { name: "rigline", version: "1.0.0-alpha.11" };
    const bundled = tempDir("rigline-doctor-bundled-");
    writeFileSync(join(bundled, COMPANION_VSIX), "a vsix");
    writeFileSync(
      join(bundled, COMPANION_SIDECAR),
      JSON.stringify({
        version: "1.0.0-alpha.11",
        fingerprint: companionFingerprint(code, manifest),
      }),
    );
    for (const [name, body] of [
      ["rigline.rigline-1.0.0-alpha.11", code],
      ["rigline.rigline-1.0.0-alpha.9", `${code};`],
    ] as const) {
      const dir = join(dirname(claude), name);
      mkdirSync(dir);
      writeFileSync(join(dir, "extension.cjs"), body);
      writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    }

    const report = collect({ exts: [claude], now: NOW, home: "/nowhere", bundled });
    expect(report.companion.carried?.version).toBe("1.0.0-alpha.11");
    const verdicts = report.companion.installed.map((c) => [basename(c.dir), c.current]).sort();
    expect(verdicts).toEqual([
      ["rigline.rigline-1.0.0-alpha.11", true],
      ["rigline.rigline-1.0.0-alpha.9", false],
    ]);
    expect(formatDoctor(report)).toContain("not the one carried");
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
