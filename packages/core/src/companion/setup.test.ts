/**
 * `vscode-setup`, with no editor on the machine and no process spawned.
 *
 * The search and the argv are the parts worth holding: everything else is one `spawn` whose
 * behaviour belongs to VS Code.
 */
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { UserError } from "../errors.ts";
import {
  EDITOR_CLIS,
  editorSpawn,
  type FoundEditor,
  findEditors,
  formatSetup,
  setupArgv,
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
  return { cli, label, path };
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

describe("setupArgv", () => {
  it("forces the install, so a re-run is a no-op rather than a refusal", () => {
    expect(setupArgv(VSIX, false)).toEqual(["--install-extension", VSIX, "--force"]);
  });

  it("uninstalls by extension id, which is what the editor knows it as", () => {
    expect(setupArgv(VSIX, true)).toEqual(["--uninstall-extension", "rigline.rigline"]);
  });
});

describe("setupCompanion", () => {
  it("runs once per editor, with that editor's own CLI", async () => {
    const calls: { command: string; argv: readonly string[] }[] = [];
    const outcomes = await setupCompanion({
      vsix: VSIX,
      editors: [
        editor("code", "VS Code", join(abs("bin"), "code.cmd")),
        editor("cursor", "Cursor", join(abs("bin"), "cursor.cmd")),
      ],
      run: async (command, argv) => {
        calls.push({ command, argv });
        return { code: 0, output: "" };
      },
    });

    expect(calls.map((c) => c.command)).toEqual([
      join(abs("bin"), "code.cmd"),
      join(abs("bin"), "cursor.cmd"),
    ]);
    expect(outcomes).toHaveLength(2);
  });

  it("refuses with the Command Palette alternative when no CLI is on PATH", async () => {
    await expect(
      setupCompanion({
        vsix: VSIX,
        editors: [],
        run: async () => {
          throw new Error("nothing should have run");
        },
      }),
    ).rejects.toThrow(UserError);
  });

  it("names the macOS repair in that refusal, since that is where the CLI is missing", async () => {
    await expect(
      setupCompanion({ vsix: VSIX, editors: [], run: async () => ({ code: 0, output: "" }) }),
    ).rejects.toThrow(/Shell Command/);
  });

  it("carries on past an editor that failed, and reports it", async () => {
    const outcomes = await setupCompanion({
      vsix: VSIX,
      editors: [
        editor("code", "VS Code", join(abs("bin"), "code.cmd")),
        editor("cursor", "Cursor", join(abs("bin"), "cursor.cmd")),
      ],
      run: async (command) =>
        command.includes("cursor") ? { code: 1, output: "no" } : { code: 0, output: "" },
    });

    const report = formatSetup(outcomes, false);
    expect(report).toContain("VS Code: installed");
    expect(report).toContain("Cursor: failed");
  });
});

describe("formatSetup", () => {
  it("asks for a reload when anything changed", () => {
    const outcomes = [{ editor: editor("code", "VS Code", "code"), code: 0, output: "" }];
    expect(formatSetup(outcomes, false)).toMatch(/Reload the window/);
  });

  it("does not ask for a reload when nothing did", () => {
    const outcomes = [{ editor: editor("code", "VS Code", "code"), code: 1, output: "broke" }];
    expect(formatSetup(outcomes, false)).not.toMatch(/Reload the window/);
  });

  it("names the binary it used, because one machine holds several `code`s", () => {
    // Leo's laptop: `code --list-extensions` listed it, the Extensions view never showed it, and
    // nothing on screen said which editor had been installed into. `installed` alone is true and
    // useless; the path is the whole diagnosis.
    const cli = join(abs("other-vscode"), "bin", "code.cmd");
    const outcomes = [{ editor: editor("code", "VS Code", cli), code: 0, output: "" }];
    expect(formatSetup(outcomes, false, VSIX)).toContain(cli);
  });

  it("names the VSIX, because the repair is installing it by hand elsewhere", () => {
    const outcomes = [{ editor: editor("code", "VS Code", "code"), code: 0, output: "" }];
    const report = formatSetup(outcomes, false, VSIX);
    expect(report).toContain(VSIX);
    expect(report).toMatch(/Install from VSIX/);
  });

  it("offers neither on a removal, where there is nothing to install by hand", () => {
    const outcomes = [{ editor: editor("code", "VS Code", "code"), code: 0, output: "" }];
    expect(formatSetup(outcomes, true)).not.toMatch(/Install from VSIX/);
  });
});

describe("editorSpawn", () => {
  it("runs a Windows .cmd through cmd.exe, because Node will not spawn one", () => {
    // Node throws EINVAL on a .cmd since the BatBadBut fix (CVE-2024-27980): a batch file can only
    // be run by an interpreter, and `spawn` will not pick one for you. Every test here injects
    // `run`, so the spawn itself had no coverage and `vscode-setup` had never worked on Windows.
    const cmd = "C:VS Code\bincode.cmd";
    const [file, argv, opts] = editorSpawn(
      cmd,
      ["--install-extension", "C:a b\r.vsix"],
      "win32",
      "cmd.exe",
    );
    expect(file).toBe("cmd.exe");
    expect(argv.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(argv[3]).toBe('""C:VS Code\bincode.cmd" "--install-extension" "C:a b\r.vsix""');
    expect(opts.windowsVerbatimArguments).toBe(true);
  });

  it("spawns a real executable directly, even on Windows", () => {
    const [file, argv, opts] = editorSpawn("C:\bincode.exe", ["--version"], "win32");
    expect(file).toBe("C:\bincode.exe");
    expect(argv).toEqual(["--version"]);
    expect(opts.windowsVerbatimArguments).toBeUndefined();
  });

  it("leaves POSIX alone, where code is an ordinary script", () => {
    const [file, argv] = editorSpawn("/usr/bin/code", ["--version"], "linux");
    expect(file).toBe("/usr/bin/code");
    expect(argv).toEqual(["--version"]);
  });
});
