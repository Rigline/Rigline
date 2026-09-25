/**
 * `vscode-setup`, with no editor on the machine and no process spawned.
 *
 * The search, the choice of profiles and the report are the parts worth holding: everything else is
 * one `spawn` whose behaviour belongs to VS Code.
 */
import { delimiter, join, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { UserError } from "../errors.ts";
import type { CompanionSettings } from "../plugins/config.ts";
import { installArgv, type Profile, type ProfilesRead, uninstallArgv } from "./profiles.ts";
import {
  checkoutEngineNote,
  EDITOR_CLIS,
  editorSpawn,
  type FoundEditor,
  findEditors,
  formatSetup,
  type SetupOutcome,
  setupCompanion,
} from "./setup.ts";

// Absolute wherever this runs, and PATH joined with this platform's separator. A Windows path is
// relative on Linux and `findEditors` drops a relative entry, so hardcoding one asserts nothing in
// CI — which is exactly how 1.0.0-alpha.7 was spent.
const abs = (...parts: string[]) => join(process.platform === "win32" ? "C:\\" : "/", ...parts);
const pathOf = (...dirs: string[]) => dirs.join(delimiter);

const VSIX = abs("engine", "dist", "bundled", "rigline.vsix");

const only =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p);

function editor(cli: string, label: string, path: string): FoundEditor {
  return { cli, label, path, product: label, dataFolder: `.${cli}` };
}

const CODE = editor("code", "VS Code", join(abs("bin"), "code.cmd"));
const CURSOR = editor("cursor", "Cursor", join(abs("bin"), "cursor.cmd"));

const EVERY: CompanionSettings = { everyProfile: true, skipProfiles: [] };

function profile(name: string, over: Partial<Profile> = {}): Profile {
  return {
    name,
    location: name === "Default" ? null : name.toLowerCase(),
    sharesDefault: false,
    claudeCode: false,
    companion: false,
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
  it("finds every editor on PATH, in the order the table lists them", () => {
    const bin = abs("bin");
    const found = findEditors({
      env: { PATH: bin },
      platform: "win32",
      exists: only(join(bin, "cursor.cmd"), join(bin, "code.cmd")),
    });
    expect(found.map((e) => e.cli)).toEqual(["code", "cursor"]);
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

  it("knows the forks people actually run Claude Code in", () => {
    expect(EDITOR_CLIS.map((e) => e.cli)).toContain("cursor");
    expect(EDITOR_CLIS.map((e) => e.cli)).toContain("windsurf");
  });
});

describe("setupCompanion", () => {
  it("installs into every profile with Claude Code or the companion, with each editor's CLI", async () => {
    const { calls, run } = recorder();
    const outcomes = await setupCompanion({
      vsix: VSIX,
      editors: [CODE, CURSOR],
      settings: EVERY,
      profilesOf: (e) =>
        e === CODE
          ? read(
              profile("Default", { claudeCode: true }),
              profile("Yarn PNP", { claudeCode: true }),
              profile("Kokai"),
            )
          : read(profile("Default", { companion: true })),
      run,
    });
    expect(calls).toEqual([
      { command: CODE.path, argv: installArgv(VSIX, null, true) },
      { command: CODE.path, argv: installArgv(VSIX, "Yarn PNP", true) },
      { command: CURSOR.path, argv: installArgv(VSIX, null, true) },
    ]);
    expect(outcomes[0]).toMatchObject({ skipped: [], others: 1 });
  });

  it("leaves out a skipped profile and says so", async () => {
    const { calls, run } = recorder();
    const outcomes = await setupCompanion({
      vsix: VSIX,
      editors: [CODE],
      settings: { everyProfile: true, skipProfiles: ["Kokai"] },
      profilesOf: () =>
        read(profile("Default", { claudeCode: true }), profile("Kokai", { claudeCode: true })),
      run,
    });
    expect(calls.map((c) => c.argv)).toEqual([installArgv(VSIX, null, true)]);
    expect(outcomes[0]?.skipped).toEqual(["Kokai"]);
  });

  it("uses the default profile where the profiles cannot be read, and says why", async () => {
    const { calls, run } = recorder();
    const outcomes = await setupCompanion({
      vsix: VSIX,
      editors: [CODE],
      settings: EVERY,
      profilesOf: () => ({ kind: "unreadable", why: "storage.json is not JSON" }),
      run,
    });
    expect(calls.map((c) => c.argv)).toEqual([installArgv(VSIX, null, true)]);
    expect(outcomes[0]?.unread).toBe("storage.json is not JSON");
  });

  it("installs into the one profile named, in each editor that has it", async () => {
    const { calls, run } = recorder();
    const outcomes = await setupCompanion({
      vsix: VSIX,
      editors: [CODE, CURSOR],
      profile: "Yarn PNP",
      settings: EVERY,
      profilesOf: (e) =>
        e === CODE ? read(profile("Default"), profile("Yarn PNP")) : read(profile("Default")),
      run,
    });
    expect(calls).toEqual([{ command: CODE.path, argv: installArgv(VSIX, "Yarn PNP", true) }]);
    expect(outcomes[1]?.absent).toBe("Yarn PNP");
  });

  it("refuses a profile no editor has, naming the ones there are", async () => {
    const { run } = recorder();
    await expect(
      setupCompanion({
        vsix: VSIX,
        editors: [CODE],
        profile: "Yarn",
        settings: EVERY,
        profilesOf: () => read(profile("Default"), profile("Yarn PNP")),
        run,
      }),
    ).rejects.toThrow(/no editor has a profile called "Yarn".*"Yarn PNP"/);
  });

  it("removes from every profile that holds the companion", async () => {
    const { calls, run } = recorder();
    await setupCompanion({
      remove: true,
      editors: [CODE],
      settings: EVERY,
      profilesOf: () =>
        read(
          profile("Default", { companion: true }),
          profile("B"),
          profile("C", { companion: true }),
        ),
      run,
    });
    expect(calls.map((c) => c.argv)).toEqual([uninstallArgv(null), uninstallArgv("C")]);
  });

  it("refuses with the Command Palette alternative when no CLI is on PATH", async () => {
    await expect(
      setupCompanion({
        vsix: VSIX,
        editors: [],
        settings: EVERY,
        run: async () => {
          throw new Error("nothing should have run");
        },
      }),
    ).rejects.toThrow(UserError);
  });

  it("names the macOS repair in that refusal, since that is where the CLI is missing", async () => {
    await expect(
      setupCompanion({
        vsix: VSIX,
        editors: [],
        settings: EVERY,
        run: async () => ({ code: 0, output: "" }),
      }),
    ).rejects.toThrow(/Shell Command/);
  });

  it("carries on past an editor that failed, and reports it", async () => {
    const { run } = recorder(CURSOR.path);
    const outcomes = await setupCompanion({
      vsix: VSIX,
      editors: [CODE, CURSOR],
      settings: EVERY,
      profilesOf: () => read(profile("Default", { claudeCode: true })),
      run,
    });
    const report = formatSetup(outcomes, false);
    expect(report).toContain("Default: installed");
    expect(report).toContain("Default: failed (cursor exited 1)");
  });
});

describe("formatSetup", () => {
  function outcome(over: Partial<SetupOutcome> = {}): SetupOutcome {
    return {
      editor: CODE,
      results: [{ profile: "Default", code: 0, output: "" }],
      skipped: [],
      others: 0,
      ...over,
    };
  }

  it("asks for a reload after a removal, and leaves an install's to the injection after it", () => {
    expect(formatSetup([outcome()], true)).toMatch(/Reload the window/);
    expect(formatSetup([outcome()], false)).not.toMatch(/Reload the window/);
  });

  it("does not ask for a reload when nothing did", () => {
    const failed = outcome({ results: [{ profile: "Default", code: 1, output: "broke" }] });
    expect(formatSetup([failed], true)).not.toMatch(/Reload the window/);
  });

  it("names the binary it used, because one machine holds several `code`s", () => {
    // Leo's laptop: `code --list-extensions` listed it, the Extensions view never showed it, and
    // nothing on screen said which editor had been installed into.
    const cli = join(abs("other-vscode"), "bin", "code.cmd");
    const report = formatSetup([outcome({ editor: editor("code", "VS Code", cli) })], false, VSIX);
    expect(report).toContain(cli);
  });

  it("names the VSIX, because the repair is installing it by hand elsewhere", () => {
    const report = formatSetup([outcome()], false, VSIX);
    expect(report).toContain(VSIX);
    expect(report).toMatch(/Install from VSIX/);
    expect(formatSetup([outcome()], true)).not.toMatch(/Install from VSIX/);
  });

  it("names every profile it installed into or skipped, and counts the rest", () => {
    const report = formatSetup(
      [
        outcome({
          results: [
            { profile: "Default", code: 0, output: "" },
            { profile: "Yarn PNP", code: 0, output: "" },
          ],
          skipped: ["Kokai"],
          others: 5,
        }),
      ],
      false,
      VSIX,
    );
    expect(report).toContain("Yarn PNP: installed");
    expect(report).toContain("Kokai: skipped, by companion.skipProfiles");
    expect(report).toContain("5 other profiles have no Claude Code");
  });

  // Every profile is read, so a profile is a cause only where that failed.
  it("names profiles as a cause only where they could not be read", () => {
    const read = formatSetup([outcome()], false, VSIX);
    expect(read).not.toMatch(/--profile NAME/);
    expect(read).not.toMatch(/Two causes/);
    const unread = formatSetup([outcome({ unread: "no storage.json" })], false, VSIX);
    expect(unread).toContain("no storage.json");
    expect(unread).toMatch(/Two causes/);
    expect(unread).toMatch(/--profile NAME/);
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
  });

  it("spawns a real executable directly, even on Windows", () => {
    const exe = win32.join("C:/", "bin", "code.exe");
    const [file, argv, opts] = editorSpawn(exe, ["--version"], "win32");
    expect(file).toBe(exe);
    expect(argv).toEqual(["--version"]);
    expect(opts.windowsVerbatimArguments).toBeUndefined();
  });

  it("leaves POSIX alone, where code is an ordinary script", () => {
    const [file, argv] = editorSpawn("/usr/bin/code", ["--version"], "linux");
    expect(file).toBe("/usr/bin/code");
    expect(argv).toEqual(["--version"]);
  });
});
