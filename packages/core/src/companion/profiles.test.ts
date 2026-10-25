/**
 * Reading VS Code's profiles from its own files, and the CLI arguments that change them (D100). The
 * files are laid out as VS Code 1.139 writes them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { editorDirs, installArgv, type Profile, readProfiles, uninstallArgv } from "./profiles.ts";

const made: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-profiles-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CLAUDE = "anthropic.claude-code";
const COMPANION = "rigline.rigline";

interface Named {
  readonly name: string;
  readonly location: string;
  readonly ids?: readonly string[];
  readonly sharesDefault?: boolean;
}

/** A user-data directory and an extensions directory, as VS Code lays them out. */
function editor(defaults: readonly string[], named: readonly Named[] = []) {
  const root = temp();
  const userData = join(root, "user");
  const extensionsDir = join(root, "ext");
  mkdirSync(join(userData, "User", "globalStorage"), { recursive: true });
  mkdirSync(extensionsDir, { recursive: true });
  const list = (ids: readonly string[]) =>
    JSON.stringify(ids.map((id) => ({ identifier: { id }, version: "1.0.0" })));
  writeFileSync(join(extensionsDir, "extensions.json"), list(defaults));
  writeFileSync(
    join(userData, "User", "globalStorage", "storage.json"),
    JSON.stringify({
      userDataProfiles: named.map(({ name, location, sharesDefault }) => ({
        name,
        location,
        ...(sharesDefault ? { useDefaultFlags: { extensions: true } } : {}),
      })),
    }),
  );
  for (const { location, ids } of named) {
    const dir = join(userData, "User", "profiles", location);
    mkdirSync(dir, { recursive: true });
    if (ids !== undefined) writeFileSync(join(dir, "extensions.json"), list(ids));
  }
  return { userData, extensionsDir };
}

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

/** A companion as the `editor` fixture lists one: a version, and no location. */
const HELD = { version: "1.0.0", dir: null };

describe("readProfiles", () => {
  it("lists the default profile first, then each named one, with what each has installed", () => {
    const { userData, extensionsDir } = editor(
      [CLAUDE, COMPANION],
      [
        { name: "Yarn PNP", location: "-5754f4db", ids: [CLAUDE] },
        { name: "Kokai", location: "-546c661a", ids: ["some.other"] },
      ],
    );
    const read = readProfiles(userData, extensionsDir);
    expect(read).toEqual({
      kind: "read",
      profiles: [
        profile("Default", { claudeCode: true, companion: HELD }),
        profile("Yarn PNP", { location: "-5754f4db", claudeCode: true }),
        profile("Kokai", { location: "-546c661a" }),
      ],
    });
  });

  it("reads a profile that shares the default's extensions as having the default's", () => {
    const { userData, extensionsDir } = editor(
      [CLAUDE],
      [{ name: "Shared", location: "pc", sharesDefault: true }],
    );
    const read = readProfiles(userData, extensionsDir);
    expect(read.kind === "read" && read.profiles[1]).toMatchObject({
      sharesDefault: true,
      claudeCode: true,
    });
  });

  it("reads a profile that has never had an extension as having none", () => {
    const { userData, extensionsDir } = editor([], [{ name: "Empty", location: "pe" }]);
    const read = readProfiles(userData, extensionsDir);
    expect(read.kind === "read" && read.profiles[1]).toMatchObject({ claudeCode: false });
  });

  it("gives the companion's version and directory, as VS Code resolves the entry", () => {
    const { userData, extensionsDir } = editor([]);
    const dir = join(extensionsDir, "rigline.rigline-1.2.0");
    const entries = [
      { relativeLocation: "rigline.rigline-1.2.0", location: { fsPath: "elsewhere" } },
      { location: { fsPath: dir } },
      { location: { path: pathToFileURL(dir).pathname, scheme: "file" } },
      { location: { path: "/x", scheme: "vscode-remote" } },
    ];
    const read = entries.map((entry) => {
      writeFileSync(
        join(extensionsDir, "extensions.json"),
        JSON.stringify([{ identifier: { id: COMPANION }, version: "1.2.0", ...entry }]),
      );
      const profiles = readProfiles(userData, extensionsDir);
      return profiles.kind === "read" ? profiles.profiles[0]?.companion : undefined;
    });
    expect(read).toEqual([
      { version: "1.2.0", dir },
      { version: "1.2.0", dir },
      { version: "1.2.0", dir },
      { version: "1.2.0", dir: null },
    ]);
  });

  it("matches ids whatever their case, as VS Code does", () => {
    const { userData, extensionsDir } = editor(["Anthropic.Claude-Code"]);
    const read = readProfiles(userData, extensionsDir);
    expect(read.kind === "read" && read.profiles[0]?.claudeCode).toBe(true);
  });

  it("has only the default profile until somebody makes another", () => {
    const { userData, extensionsDir } = editor([CLAUDE]);
    writeFileSync(join(userData, "User", "globalStorage", "storage.json"), "{}");
    const read = readProfiles(userData, extensionsDir);
    expect(read.kind === "read" && read.profiles.map((p) => p.name)).toEqual(["Default"]);
  });

  it("says there is nothing to read where there is no storage.json", () => {
    expect(readProfiles(join(temp(), "nowhere"), temp()).kind).toBe("none");
  });

  it("says what it could not read, rather than guessing", () => {
    const { userData, extensionsDir } = editor([CLAUDE]);
    writeFileSync(
      join(userData, "User", "globalStorage", "storage.json"),
      JSON.stringify({ userDataProfiles: [{ name: "No location" }] }),
    );
    const read = readProfiles(userData, extensionsDir);
    expect(read).toMatchObject({ kind: "unreadable" });
    expect(read.kind === "unreadable" && read.why).toMatch(/no name or location/);
  });
});

describe("editorDirs", () => {
  const code = { product: "Code", dataFolder: ".vscode" };
  const home = join(temp(), "home");

  it("finds VS Code's directories on each platform", () => {
    expect(editorDirs(code, { env: { APPDATA: "A" }, platform: "win32", home })).toEqual({
      userData: join("A", "Code"),
      extensionsDir: join(home, ".vscode", "extensions"),
    });
    expect(editorDirs(code, { env: {}, platform: "darwin", home }).userData).toBe(
      join(home, "Library", "Application Support", "Code"),
    );
    expect(editorDirs(code, { env: {}, platform: "linux", home }).userData).toBe(
      join(home, ".config", "Code"),
    );
    expect(
      editorDirs(code, { env: { XDG_CONFIG_HOME: "X" }, platform: "linux", home }).userData,
    ).toBe(join("X", "Code"));
  });

  it("honours the variables VS Code does, in its order", () => {
    const env = { VSCODE_APPDATA: "V", VSCODE_EXTENSIONS: "E", APPDATA: "A" };
    expect(editorDirs(code, { env, platform: "win32", home })).toEqual({
      userData: join("V", "Code"),
      extensionsDir: "E",
    });
    expect(
      editorDirs(code, { env: { ...env, VSCODE_PORTABLE: "P" }, platform: "win32", home }),
    ).toEqual({
      userData: join("P", "user-data"),
      extensionsDir: join("P", "extensions"),
    });
  });
});

describe("installArgv and uninstallArgv", () => {
  it("keeps the install out of Settings Sync, and forces only when asked (D93)", () => {
    expect(installArgv("r.vsix", null, true)).toEqual([
      "--install-extension",
      "r.vsix",
      "--force",
      "--do-not-sync",
    ]);
    expect(installArgv("r.vsix", "Yarn PNP", false)).toEqual([
      "--install-extension",
      "r.vsix",
      "--do-not-sync",
      "--profile",
      "Yarn PNP",
    ]);
  });

  it("uninstalls by id, naming no profile for the default", () => {
    expect(uninstallArgv(null)).toEqual(["--uninstall-extension", COMPANION]);
    expect(uninstallArgv("B")).toEqual(["--uninstall-extension", COMPANION, "--profile", "B"]);
  });
});
