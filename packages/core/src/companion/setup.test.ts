/**
 * `vscode-setup`, with no editor on the machine and no process spawned.
 *
 * The search and the argv are the parts worth holding: everything else is one `spawn` whose
 * behaviour belongs to VS Code.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UserError } from "../errors.ts";
import {
  EDITOR_CLIS,
  type FoundEditor,
  findEditors,
  formatSetup,
  setupArgv,
  setupCompanion,
} from "./setup.ts";

const VSIX = join("C:", "engine", "dist", "bundled", "rigline.vsix");

const only =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p);

function editor(cli: string, label: string, path: string): FoundEditor {
  return { cli, label, path };
}

describe("findEditors", () => {
  it("finds every editor on PATH, in the order the table lists them", () => {
    const bin = join("C:", "bin");
    const found = findEditors({
      env: { PATH: bin },
      platform: "win32",
      exists: only(join(bin, "cursor.cmd"), join(bin, "code.cmd")),
    });
    expect(found.map((e) => e.cli)).toEqual(["code", "cursor"]);
  });

  it("takes the shim on Windows, which is how the CLI ships", () => {
    const bin = join("C:", "bin");
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
    const first = join("C:", "one");
    const second = join("C:", "two");
    const found = findEditors({
      env: { PATH: [first, second].join(";") },
      platform: "win32",
      exists: only(join(first, "code.cmd"), join(second, "code.cmd")),
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe(join(first, "code.cmd"));
  });

  it("skips a relative or empty PATH entry", () => {
    const found = findEditors({
      env: { PATH: ["", "node_modules/.bin"].join(";") },
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
        editor("code", "VS Code", join("C:", "bin", "code.cmd")),
        editor("cursor", "Cursor", join("C:", "bin", "cursor.cmd")),
      ],
      run: async (command, argv) => {
        calls.push({ command, argv });
        return { code: 0, output: "" };
      },
    });

    expect(calls.map((c) => c.command)).toEqual([
      join("C:", "bin", "code.cmd"),
      join("C:", "bin", "cursor.cmd"),
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
        editor("code", "VS Code", join("C:", "bin", "code.cmd")),
        editor("cursor", "Cursor", join("C:", "bin", "cursor.cmd")),
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
});
