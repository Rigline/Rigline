/**
 * Finding VS Code's CLI, running it, and taking the companion out of every profile, with no editor
 * on the machine and no process spawned.
 *
 * The search, the choice of profiles and the report are the parts worth holding: everything else is
 * one `spawn` whose behaviour belongs to VS Code.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COMPANION_ID, uninstallArgv } from "./profiles.ts";
import {
  checkoutEngineNote,
  EDITOR_CLIS,
  editorSpawn,
  type FoundEditor,
  findEditors,
  uninstallCompanion,
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

describe("uninstallCompanion", () => {
  const made: string[] = [];

  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const ENTRY = { identifier: { id: COMPANION_ID }, version: "2.0.0" };

  /** VS Code's files: the default profile, and one named profile per name, each listing `ids`. */
  function vscode(lists: Record<string, readonly object[]>) {
    const root = mkdtempSync(join(tmpdir(), "rigline-uninstall-"));
    made.push(root);
    const userData = join(root, "user");
    const extensionsDir = join(root, "ext");
    const list = (name: string): string =>
      name === "Default"
        ? join(extensionsDir, "extensions.json")
        : join(userData, "User", "profiles", `p-${name}`, "extensions.json");
    mkdirSync(join(userData, "User", "globalStorage"), { recursive: true });
    const named = Object.keys(lists).filter((name) => name !== "Default");
    writeFileSync(
      join(userData, "User", "globalStorage", "storage.json"),
      JSON.stringify({ userDataProfiles: named.map((name) => ({ name, location: `p-${name}` })) }),
    );
    for (const [name, entries] of Object.entries(lists)) {
      mkdirSync(join(list(name), ".."), { recursive: true });
      writeFileSync(list(name), JSON.stringify(entries));
    }
    return { dirs: { userData, extensionsDir }, list };
  }

  /** A CLI that takes the companion out of the profile named, unless told to fail or miss. */
  function cli(
    at: ReturnType<typeof vscode>,
    outcome: Record<string, "removes" | "nowhere" | number> = {},
  ) {
    const calls: (readonly string[])[] = [];
    return {
      calls,
      run: async (_cli: unknown, argv: readonly string[]) => {
        calls.push(argv);
        const flag = argv.indexOf("--profile");
        const name = flag === -1 ? "Default" : (argv[flag + 1] as string);
        const result = outcome[name] ?? "removes";
        if (typeof result === "number") return { code: result, output: "It is in use." };
        if (result === "removes") writeFileSync(at.list(name), "[]");
        return { code: 0, output: "" };
      },
    };
  }

  it("takes the companion out of every profile that lists it, and says so", async () => {
    const at = vscode({ Default: [ENTRY], Work: [ENTRY], Plain: [] });
    const fake = cli(at);
    const done = await uninstallCompanion({ dirs: at.dirs, findCli: () => [CODE], run: fake.run });
    expect(fake.calls).toEqual([uninstallArgv(null), uninstallArgv("Work")]);
    expect(done).toEqual({
      lines: [
        'removed the companion from profile "Default"',
        'removed the companion from profile "Work"',
      ],
      kept: [],
      unknown: false,
    });
  });

  it("names a profile that kept it, by what the CLI said or by reading it again", async () => {
    const at = vscode({ Default: [ENTRY], Work: [ENTRY] });
    const done = await uninstallCompanion({
      dirs: at.dirs,
      findCli: () => [CODE],
      run: cli(at, { Default: 1, Work: "nowhere" }).run,
    });
    expect(done.kept).toEqual(["Default", "Work"]);
    expect(done.lines).toEqual([
      'profile "Default" still has the companion: It is in use; uninstall Rigline from the Extensions view there',
      `profile "Work" still has the companion: ${CODE.path} said it removed it, so that \`code\` is another editor; uninstall Rigline from the Extensions view there`,
    ]);
  });

  it("says where to do it by hand where no CLI is on PATH, and runs nothing", async () => {
    const at = vscode({ Default: [ENTRY], Work: [ENTRY] });
    const fake = cli(at);
    const done = await uninstallCompanion({ dirs: at.dirs, findCli: () => [], run: fake.run });
    expect(fake.calls).toEqual([]);
    expect(done.kept).toEqual(["Default", "Work"]);
    expect(done.lines[0]).toMatch(
      /^profiles "Default" and "Work" still have the companion, and no VS Code command-line tool was found on PATH to remove it: uninstall Rigline from the Extensions view in each$/,
    );
  });

  it("asks for no CLI where no profile has the companion", async () => {
    const at = vscode({ Default: [], Work: [] });
    const done = await uninstallCompanion({
      dirs: at.dirs,
      findCli: () => {
        throw new Error("nothing should have looked");
      },
      run: cli(at).run,
    });
    expect(done).toEqual({
      lines: ["the companion is in no VS Code profile"],
      kept: [],
      unknown: false,
    });
  });

  // Saying "in no profile" over files it could not read would be a guess, and exit 0 on it.
  it("says what it could not read, does what it can, and leaves the rest unknown", async () => {
    const at = vscode({ Default: [ENTRY], Work: [ENTRY] });
    writeFileSync(join(at.dirs.userData, "User", "globalStorage", "storage.json"), "{ not json");
    const fake = cli(at);
    const done = await uninstallCompanion({ dirs: at.dirs, findCli: () => [CODE], run: fake.run });
    expect(fake.calls).toEqual([uninstallArgv(null)]);
    expect(done.unknown).toBe(true);
    expect(done.lines.at(0)).toMatch(/^VS Code's profiles could not be read, so this looked at/);
    expect(done.lines.at(-1)).toBe(
      "uninstall Rigline from the Extensions view in any other profile that has it",
    );

    writeFileSync(at.list("Default"), "{ not json");
    const blind = await uninstallCompanion({ dirs: at.dirs, findCli: () => [CODE], run: fake.run });
    expect(blind).toMatchObject({ kept: [], unknown: true });
    expect(blind.lines[0]).toMatch(/in each that has it$/);
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
