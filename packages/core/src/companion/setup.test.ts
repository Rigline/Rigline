/**
 * Finding VS Code's CLI, running it, and taking the companion out of every profile, with no editor
 * on the machine and no process spawned.
 *
 * The search, the choice of profiles and the report are the parts worth holding: everything else is
 * one `spawn` whose behaviour belongs to VS Code.
 */
import { delimiter, join, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { type Profile, type ProfilesRead, uninstallArgv } from "./profiles.ts";
import {
  checkoutEngineNote,
  EDITOR_CLIS,
  editorSpawn,
  type FoundEditor,
  findEditors,
  formatRemoval,
  removeCompanion,
} from "./setup.ts";

// Absolute wherever this runs, and PATH joined with this platform's separator. A Windows path is
// relative on Linux and `findEditors` drops a relative entry, so hardcoding one asserts nothing in
// CI — which is exactly how 1.0.0-alpha.7 was spent.
const abs = (...parts: string[]) => join(process.platform === "win32" ? "C:\\" : "/", ...parts);
const pathOf = (...dirs: string[]) => dirs.join(delimiter);

const only =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p);

function editor(cli: string, label: string, path: string): FoundEditor {
  return { cli, label, path, product: label, dataFolder: `.${cli}` };
}

const CODE = editor("code", "VS Code", join(abs("bin"), "code.cmd"));
const CURSOR = editor("cursor", "Cursor", join(abs("bin"), "cursor.cmd"));

const HELD = { version: "1.0.0", dir: null };

function profile(name: string, over: Partial<Profile> = {}): Profile {
  return {
    name,
    location: name === "Default" ? null : name.toLowerCase(),
    sharesDefault: false,
    claudeCode: false,
    companion: null,
    ...over,
  };
}

const read = (...profiles: Profile[]): ProfilesRead => ({ kind: "read", profiles });

/** A CLI that records what it was asked, and fails for the paths `failing` names. */
function recorder(...failing: string[]) {
  const calls: { command: string; argv: readonly string[] }[] = [];
  return {
    calls,
    run: async (command: string, argv: readonly string[]) => {
      calls.push({ command, argv });
      return failing.includes(command) ? { code: 1, output: "no" } : { code: 0, output: "" };
    },
  };
}

describe("findEditors", () => {
  it("finds VS Code and passes over an editor whose extensions the engine does not inject", () => {
    const bin = abs("bin");
    const found = findEditors({
      env: { PATH: bin },
      platform: "win32",
      exists: only(join(bin, "cursor.cmd"), join(bin, "code.cmd")),
    });
    expect(found.map((e) => e.cli)).toEqual(["code"]);
  });

  it("carries the names each editor's directories are derived from", () => {
    const bin = abs("bin");
    const found = findEditors({
      env: { PATH: bin },
      platform: "win32",
      exists: only(join(bin, "code.cmd")),
    });
    expect(found[0]).toMatchObject({ product: "Code", dataFolder: ".vscode" });
  });

  it("takes the shim on Windows, which is how the CLI ships", () => {
    const bin = abs("bin");
    const found = findEditors({
      env: { PATH: bin },
      platform: "win32",
      exists: only(join(bin, "code.cmd")),
    });
    expect(found[0]?.path).toBe(join(bin, "code.cmd"));
  });

  it("looks for the bare name on POSIX", () => {
    const bin = join("/usr", "local", "bin");
    const found = findEditors({
      env: { PATH: bin },
      platform: "linux",
      exists: only(join(bin, "code")),
    });
    expect(found[0]?.path).toBe(join(bin, "code"));
  });

  it("takes one path per editor, not one per PATH entry", () => {
    const first = abs("one");
    const second = abs("two");
    const found = findEditors({
      env: { PATH: pathOf(first, second) },
      platform: "win32",
      exists: only(join(first, "code.cmd"), join(second, "code.cmd")),
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe(join(first, "code.cmd"));
  });

  it("skips a relative or empty PATH entry", () => {
    const found = findEditors({
      env: { PATH: pathOf("", "node_modules/.bin") },
      platform: "win32",
      exists: () => true,
    });
    expect(found).toEqual([]);
  });

  it("lists VS Code alone, the one editor whose extensions directory the engine injects", () => {
    expect(EDITOR_CLIS.map((e) => e.cli)).toEqual(["code"]);
  });
});

describe("removeCompanion", () => {
  it("takes the companion out of every profile that lists it, in each editor", async () => {
    const { calls, run } = recorder();
    const outcomes = await removeCompanion({
      editors: [CODE, CURSOR],
      profilesOf: (e) =>
        e === CODE
          ? read(
              profile("Default", { companion: HELD }),
              profile("B"),
              profile("C", { companion: HELD }),
              profile("S", { companion: HELD, sharesDefault: true }),
            )
          : read(profile("Default")),
      run,
    });
    expect(calls).toEqual([
      { command: CODE.path, argv: uninstallArgv(null) },
      { command: CODE.path, argv: uninstallArgv("C") },
    ]);
    expect(outcomes[1]?.results).toEqual([]);
  });

  it("tries the default profile where the profiles cannot be read, and says why", async () => {
    const { calls, run } = recorder();
    const outcomes = await removeCompanion({
      editors: [CODE],
      profilesOf: () => ({ kind: "unreadable", why: "storage.json is not JSON" }),
      run,
    });
    expect(calls.map((c) => c.argv)).toEqual([uninstallArgv(null)]);
    expect(outcomes[0]?.unread).toBe("storage.json is not JSON");
  });
});

describe("formatRemoval", () => {
  // Leo's laptop: `code --list-extensions` listed it, the Extensions view never showed it, and
  // nothing on screen said which editor had been asked.
  it("names the binary it used, each profile, and what a failure said", () => {
    const report = formatRemoval([
      {
        editor: CODE,
        results: [
          { profile: "Default", code: 0, output: "" },
          { profile: "B", code: 1, output: "Profile 'B' broke." },
        ],
      },
      { editor: CURSOR, results: [], unread: "no storage.json" },
    ]);
    expect(report.split("\n")).toEqual([
      `VS Code, via ${CODE.path}:`,
      "  Default: removed",
      "  B: failed (code exited 1)",
      "    Profile 'B' broke.",
      `Cursor, via ${CURSOR.path}:`,
      "  its profiles could not be read, so this tried the default profile: no storage.json",
      "  the companion is in none of its profiles",
    ]);
  });
});

describe("checkoutEngineNote", () => {
  // Pasted into settings.json, a Windows path with bare backslashes is not JSON.
  it("prints a settings line that parses back to the entry it names (D94)", () => {
    const entry = join(abs("dev", "rigline"), "packages", "core", "dist", "engine", "bin.js");
    const line = checkoutEngineNote(entry)
      .split("\n")
      .find((l) => l.includes("rigline.enginePath"));
    expect(JSON.parse(`{${line}}`)).toEqual({ "rigline.enginePath": entry });
  });
});

describe("editorSpawn", () => {
  it("runs a Windows .cmd through cmd.exe, because Node will not spawn one", () => {
    // Node throws EINVAL on a .cmd since the BatBadBut fix (CVE-2024-27980): a batch file can only
    // be run by an interpreter, and `spawn` will not pick one for you.
    const cmd = win32.join("C:/", "VS Code", "bin", "code.cmd");
    const vsix = win32.join("C:/", "a b", "r.vsix");
    const [file, argv, opts] = editorSpawn(cmd, ["--install-extension", vsix], "win32", "cmd.exe");
    expect(file).toBe("cmd.exe");
    expect(argv.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(argv[3]).toBe(`""${cmd}" "--install-extension" "${vsix}""`);
    expect(opts.windowsVerbatimArguments).toBe(true);
    expect(opts.windowsHide).toBe(true);
  });

  it("spawns a real executable directly, even on Windows", () => {
    const exe = win32.join("C:/", "bin", "code.exe");
    const [file, argv, opts] = editorSpawn(exe, ["--version"], "win32");
    expect(file).toBe(exe);
    expect(argv).toEqual(["--version"]);
    expect(opts.windowsVerbatimArguments).toBeUndefined();
    expect(opts.windowsHide).toBe(true);
  });

  it("leaves POSIX alone, where code is an ordinary script", () => {
    const [file, argv] = editorSpawn("/usr/bin/code", ["--version"], "linux");
    expect(file).toBe("/usr/bin/code");
    expect(argv).toEqual(["--version"]);
  });
});
