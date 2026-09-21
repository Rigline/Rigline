/**
 * Finding a Node from inside the extension host.
 *
 * Nothing here touches the filesystem: `exists` is injected, which is the same shape `findNpmCli`
 * already takes, so these assert the search rather than this machine's layout.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findNode, NoNodeError, searchPath } from "./node.ts";

const only =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p);

describe("searchPath", () => {
  it("drops the empty entry, which on Windows means the working directory", () => {
    const env = { PATH: [join("C:", "tools"), "", join("C:", "other")].join(";") };
    expect(searchPath(env)).toEqual([join("C:", "tools"), join("C:", "other")]);
  });

  it("drops a relative entry, which resolves against wherever VS Code started", () => {
    const env = { PATH: ["node_modules/.bin", join("C:", "tools")].join(";") };
    expect(searchPath(env)).toEqual([join("C:", "tools")]);
  });

  it("unwraps a quoted entry, because the quotes are not part of the path", () => {
    const env = { PATH: `"${join("C:", "Program Files", "nodejs")}"` };
    expect(searchPath(env)).toEqual([join("C:", "Program Files", "nodejs")]);
  });

  it("keeps the first of a repeated entry and searches it once", () => {
    const env = { PATH: [join("C:", "tools"), join("C:", "tools")].join(";") };
    expect(searchPath(env)).toEqual([join("C:", "tools")]);
  });

  it("answers with nothing rather than throwing when PATH is unset", () => {
    expect(searchPath({})).toEqual([]);
  });
});

describe("findNode", () => {
  it("takes the setting without searching", () => {
    const chosen = join("C:", "volta", "shims", "node.exe");
    const found = findNode({
      setting: chosen,
      exists: only(chosen),
      env: { PATH: join("C:", "tools") },
      platform: "win32",
    });
    expect(found).toEqual({ path: chosen, source: "setting" });
  });

  it("refuses a setting that points at nothing, and says so", () => {
    expect(() =>
      findNode({ setting: join("C:", "gone", "node.exe"), exists: () => false, env: {} }),
    ).toThrow(/rigline\.nodePath/);
  });

  it("ignores a blank setting rather than treating it as a path", () => {
    const onPath = join("/usr", "local", "bin", "node");
    const found = findNode({
      setting: "   ",
      exists: only(onPath),
      env: { PATH: join("/usr", "local", "bin") },
      platform: "linux",
    });
    expect(found).toEqual({ path: onPath, source: "path" });
  });

  it("walks PATH in order and takes the first Node", () => {
    const first = join("C:", "a", "node.exe");
    const second = join("C:", "b", "node.exe");
    const found = findNode({
      exists: only(first, second),
      env: { PATH: [join("C:", "a"), join("C:", "b")].join(";") },
      platform: "win32",
    });
    expect(found.path).toBe(first);
  });

  it("finds node.exe before the extensionless name on Windows", () => {
    const dir = join("C:", "Program Files", "nodejs");
    const found = findNode({
      exists: only(join(dir, "node"), join(dir, "node.exe")),
      env: { PATH: dir },
      platform: "win32",
    });
    expect(found.path).toBe(join(dir, "node.exe"));
  });

  it("does not look for node.exe on POSIX", () => {
    const dir = join("/usr", "bin");
    expect(() =>
      findNode({ exists: only(join(dir, "node.exe")), env: { PATH: dir }, platform: "linux" }),
    ).toThrow(NoNodeError);
  });

  it("names the setting when there is nothing on PATH, because that is the repair", () => {
    // The macOS case this exists for: a GUI-launched VS Code inherits a login shell's PATH only
    // sometimes, so "no Node" usually means "not visible from here" rather than "not installed".
    expect(() => findNode({ exists: () => false, env: { PATH: join("/usr", "bin") } })).toThrow(
      /Set `rigline\.nodePath`/,
    );
  });
});
