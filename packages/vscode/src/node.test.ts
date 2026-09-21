/**
 * Finding a Node from inside the extension host.
 *
 * Nothing here touches the filesystem: `exists` is injected, which is the same shape `findNpmCli`
 * already takes, so these assert the search rather than this machine's layout.
 *
 * **Paths and separators come from the running platform, never from Windows.** `join("C:", "bin")`
 * is absolute on Windows and a relative directory called `C:` everywhere else, and `searchPath`
 * drops a relative entry on purpose — so a test written in Windows paths passes here and asserts
 * nothing on Linux, which is what CI runs. The `platform` argument stays explicit only where it
 * decides something real, which is the executable's name.
 */
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { findNode, NoNodeError, searchPath } from "./node.ts";

/** An absolute path wherever this is running. */
const abs = (...parts: string[]) => join(process.platform === "win32" ? "C:\\" : "/", ...parts);

/** A PATH string with this platform's separator. */
const pathOf = (...dirs: string[]) => dirs.join(delimiter);

const HERE = process.platform;

const only =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p);

describe("searchPath", () => {
  it("drops the empty entry, which on Windows means the working directory", () => {
    const env = { PATH: pathOf(abs("tools"), "", abs("other")) };
    expect(searchPath(env)).toEqual([abs("tools"), abs("other")]);
  });

  it("drops a relative entry, which resolves against wherever VS Code started", () => {
    const env = { PATH: pathOf("node_modules/.bin", abs("tools")) };
    expect(searchPath(env)).toEqual([abs("tools")]);
  });

  it("unwraps a quoted entry, because the quotes are not part of the path", () => {
    const env = { PATH: `"${abs("Program Files", "nodejs")}"` };
    expect(searchPath(env)).toEqual([abs("Program Files", "nodejs")]);
  });

  it("keeps the first of a repeated entry and searches it once", () => {
    const env = { PATH: pathOf(abs("tools"), abs("tools")) };
    expect(searchPath(env)).toEqual([abs("tools")]);
  });

  it("answers with nothing rather than throwing when PATH is unset", () => {
    expect(searchPath({})).toEqual([]);
  });
});

describe("findNode", () => {
  it("takes the setting without searching", () => {
    const chosen = abs("volta", "shims", "node");
    const found = findNode({
      setting: chosen,
      exists: only(chosen),
      env: { PATH: abs("tools") },
      platform: HERE,
    });
    expect(found).toEqual({ path: chosen, source: "setting" });
  });

  it("refuses a setting that points at nothing, and says so", () => {
    expect(() => findNode({ setting: abs("gone", "node"), exists: () => false, env: {} })).toThrow(
      /rigline\.nodePath/,
    );
  });

  it("ignores a blank setting rather than treating it as a path", () => {
    const onPath = abs("usr", "local", "bin", "node");
    const found = findNode({
      setting: "   ",
      exists: only(onPath),
      env: { PATH: abs("usr", "local", "bin") },
      platform: "linux",
    });
    expect(found).toEqual({ path: onPath, source: "path" });
  });

  it("walks PATH in order and takes the first Node", () => {
    const first = abs("a", "node");
    const second = abs("b", "node");
    const found = findNode({
      exists: only(first, second),
      env: { PATH: pathOf(abs("a"), abs("b")) },
      platform: "linux",
    });
    expect(found.path).toBe(first);
  });

  it("finds node.exe before the extensionless name on Windows", () => {
    // `platform` is the one thing that legitimately differs from where this runs: it decides the
    // executable's name and nothing else, so the assertion holds on any host.
    const dir = abs("Program Files", "nodejs");
    const found = findNode({
      exists: only(join(dir, "node"), join(dir, "node.exe")),
      env: { PATH: dir },
      platform: "win32",
    });
    expect(found.path).toBe(join(dir, "node.exe"));
  });

  it("does not look for node.exe on POSIX", () => {
    const dir = abs("usr", "bin");
    expect(() =>
      findNode({ exists: only(join(dir, "node.exe")), env: { PATH: dir }, platform: "linux" }),
    ).toThrow(NoNodeError);
  });

  it("names the setting when there is nothing on PATH, because that is the repair", () => {
    // The macOS case this exists for: a GUI-launched VS Code inherits a login shell's PATH only
    // sometimes, so "no Node" usually means "not visible from here" rather than "not installed".
    expect(() => findNode({ exists: () => false, env: { PATH: abs("usr", "bin") } })).toThrow(
      /Set `rigline\.nodePath`/,
    );
  });
});
