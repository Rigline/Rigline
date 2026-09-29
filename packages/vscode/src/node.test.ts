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
import { findNode, NoNodeError, resolveNode, searchPath, UnusableNodeError } from "./node.ts";

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
      /Set `rigline\.nodePath`.*, then reload the window\.$/,
    );
  });
});

describe("resolveNode", () => {
  const dir = abs("usr", "local", "bin");
  const found = join(dir, "node");
  const base = { exists: only(found), env: { PATH: dir }, platform: "linux" as const };
  const answers = (execPath: string, version: string) => async () =>
    JSON.stringify([execPath, version]);

  it("takes the binary the Node found says it is, which is not the shim or symlink found", async () => {
    const real = abs("usr", "local", "Cellar", "node", "26.10.0_1", "bin", "node");
    const node = await resolveNode({ ...base, probe: answers(real, "26.10.0") });
    expect(node).toEqual({ path: real, version: "26.10.0", source: "path", found });
  });

  it("asks the Node it found, and only that one", async () => {
    const asked: string[] = [];
    await resolveNode({
      ...base,
      probe: async (path) => {
        asked.push(path);
        return JSON.stringify([path, "22.12.0"]);
      },
    });
    expect(asked).toEqual([found]);
  });

  it("refuses a Node below the floor, naming the floor, the Node and the setting", async () => {
    const real = abs("home", ".volta", "tools", "image", "node", "20.15.1", "bin", "node");
    const refusal = resolveNode({
      ...base,
      probe: answers(real, "20.15.1"),
      belowFloor: (version) => (version === "20.15.1" ? "22.12.0" : null),
    });
    await expect(refusal).rejects.toThrow(UnusableNodeError);
    await expect(refusal).rejects.toThrow(
      `Rigline needs Node 22.12.0 or newer, and ${found} (from PATH), which runs ${real}, is ` +
        "Node 20.15.1. Set `rigline.nodePath` to a Node executable, then reload the window.",
    );
    await expect(refusal).rejects.toMatchObject({ floor: "22.12.0" });
  });

  it("takes any Node that answers when there is no floor to hold it to", async () => {
    const node = await resolveNode({ ...base, probe: answers(found, "18.0.0") });
    expect(node.version).toBe("18.0.0");
  });

  it("says which Node it could not run, and why", async () => {
    const refusal = resolveNode({
      ...base,
      probe: async () => {
        throw new Error("no answer in 10 seconds");
      },
    });
    await expect(refusal).rejects.toThrow(
      `Rigline could not run ${found} (from PATH) to ask which Node it is: no answer in 10 seconds`,
    );
    await expect(refusal).rejects.toMatchObject({ floor: null });
  });

  it.each([
    ["nothing", ""],
    ["not JSON", "hello"],
    ["a relative path", JSON.stringify(["node", "22.12.0"])],
    ["no version", JSON.stringify([abs("usr", "bin", "node"), "v"])],
  ])("refuses an answer that is %s, since no Node would give it", async (_what, answer) => {
    await expect(resolveNode({ ...base, probe: async () => answer })).rejects.toThrow(
      /Rigline asked .* which Node it is, and it answered/,
    );
  });

  it("names the setting as where the Node came from, when it did", async () => {
    const chosen = abs("opt", "node", "bin", "node");
    const refusal = resolveNode({
      setting: chosen,
      exists: only(chosen),
      env: {},
      probe: answers(chosen, "20.0.0"),
      belowFloor: () => "22.12.0",
    });
    await expect(refusal).rejects.toThrow(`${chosen} (from \`rigline.nodePath\`) is Node 20.0.0`);
  });

  it("still refuses before asking anything when there is no Node at all", async () => {
    let asked = false;
    const refusal = resolveNode({
      exists: () => false,
      env: { PATH: dir },
      probe: async () => {
        asked = true;
        return "";
      },
    });
    await expect(refusal).rejects.toThrow(NoNodeError);
    expect(asked).toBe(false);
  });
});
