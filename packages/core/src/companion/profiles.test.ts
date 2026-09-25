/**
 * Reading VS Code's profiles from its own files, and adding the companion where it is missing (D100).
 * The files are laid out as VS Code 1.139 writes them; the CLI is a fake that records its calls.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CompanionSettings } from "../plugins/config.ts";
import { type CarriedCompanion, companionFingerprint } from "./fingerprint.ts";
import {
  addWhereMissing,
  type EditorContext,
  editorDirs,
  installArgv,
  missingFrom,
  type Profile,
  readProfiles,
  setupTargets,
  uninstallArgv,
} from "./profiles.ts";

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
    companion: false,
    ...over,
  };
}

const EVERY: CompanionSettings = { everyProfile: true, skipProfiles: [] };

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
        profile("Default", { claudeCode: true, companion: true }),
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

describe("missingFrom", () => {
  const holding = profile("Default", { claudeCode: true, companion: true });

  it("names each profile with Claude Code and without the companion", () => {
    const lacking = profile("B", { claudeCode: true });
    expect(missingFrom([holding, lacking, profile("C")], EVERY)).toEqual([lacking]);
  });

  // The companion being somewhere is what says the person wanted it at all.
  it("names none in an editor the companion is in nowhere", () => {
    expect(missingFrom([profile("Default", { claudeCode: true })], EVERY)).toEqual([]);
  });

  it("names none when everyProfile is off, and leaves out the skipped", () => {
    const lacking = profile("B", { claudeCode: true });
    expect(missingFrom([holding, lacking], { everyProfile: false, skipProfiles: [] })).toEqual([]);
    expect(missingFrom([holding, lacking], { everyProfile: true, skipProfiles: ["B"] })).toEqual(
      [],
    );
  });

  it("leaves out a profile that shares the default's extensions", () => {
    const shared = profile("S", { claudeCode: true, sharesDefault: true });
    expect(missingFrom([holding, shared], EVERY)).toEqual([]);
  });
});

describe("setupTargets", () => {
  it("picks every profile with Claude Code or the companion, less the skipped", () => {
    const profiles = [
      profile("Default", { claudeCode: true }),
      profile("B", { companion: true }),
      profile("C"),
      profile("K", { claudeCode: true }),
    ];
    const { targets, skipped } = setupTargets(profiles, {
      everyProfile: true,
      skipProfiles: ["K"],
    });
    expect(targets.map((p) => p.name)).toEqual(["Default", "B"]);
    expect(skipped.map((p) => p.name)).toEqual(["K"]);
  });

  it("falls back to the default profile when no profile has Claude Code yet", () => {
    const { targets } = setupTargets([profile("Default"), profile("B")], EVERY);
    expect(targets.map((p) => p.name)).toEqual(["Default"]);
  });

  it("is the default profile alone when everyProfile is off", () => {
    const profiles = [profile("Default"), profile("B", { claudeCode: true })];
    const { targets } = setupTargets(profiles, { everyProfile: false, skipProfiles: [] });
    expect(targets.map((p) => p.name)).toEqual(["Default"]);
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

describe("addWhereMissing", () => {
  const CODE = '"use strict";\n';
  const MANIFEST = { name: "rigline" };
  const carried: CarriedCompanion = {
    version: "1.0.0",
    fingerprint: companionFingerprint(CODE, MANIFEST),
    vsix: "r.vsix",
  };

  function context(dirs: { userData: string; extensionsDir: string }, label = ""): EditorContext {
    return { label, ...dirs, cli: { command: "code", prefix: [] } };
  }

  /** The companion extracted at `carried.version`, as this build or another. */
  function extracted(extensionsDir: string, code = CODE): void {
    const dir = join(extensionsDir, `${COMPANION}-${carried.version}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.cjs"), code);
    writeFileSync(join(dir, "package.json"), JSON.stringify(MANIFEST));
  }

  function recorder(code = 0) {
    const calls: (readonly string[])[] = [];
    return {
      calls,
      run: async (_cli: unknown, argv: readonly string[]) => {
        calls.push(argv);
        return { code, output: code === 0 ? "" : "Profile 'B' not found." };
      },
    };
  }

  it("adds the companion to each profile that has Claude Code without it, and says so", async () => {
    const dirs = editor(
      [CLAUDE, COMPANION],
      [
        { name: "B", location: "pb", ids: [CLAUDE] },
        { name: "C", location: "pc", ids: [] },
      ],
    );
    extracted(dirs.extensionsDir);
    const { calls, run } = recorder();
    const answer = await addWhereMissing({
      contexts: [context(dirs, "VS Code")],
      settings: EVERY,
      carried,
      run,
    });
    expect(calls).toEqual([installArgv("r.vsix", "B", false)]);
    expect(answer).toEqual({
      v: 1,
      lines: ['added the companion to profile "B" in VS Code, which has Claude Code'],
      failed: false,
    });
  });

  it("does nothing, silently, where nothing is missing or no profiles exist to read", async () => {
    const { calls, run } = recorder();
    const answer = await addWhereMissing({
      contexts: [
        context(editor([CLAUDE, COMPANION])),
        context({ userData: join(temp(), "none"), extensionsDir: temp() }),
      ],
      settings: EVERY,
      carried,
      run,
    });
    expect(calls).toEqual([]);
    expect(answer).toEqual({ v: 1, lines: [], failed: false });
  });

  it("reports a failed install as failed, with what the CLI said", async () => {
    const dirs = editor([COMPANION], [{ name: "B", location: "pb", ids: [CLAUDE] }]);
    const { run } = recorder(1);
    const answer = await addWhereMissing({
      contexts: [context(dirs)],
      settings: EVERY,
      carried,
      run,
    });
    expect(answer.failed).toBe(true);
    expect(answer.lines).toEqual([
      `could not add the companion to profile "B": Profile 'B' not found.`,
    ]);
  });

  // An install re-extracts the shared directory, so it would swap this build out from under any
  // window running it.
  it("refuses when a different build is installed at the carried version", async () => {
    const dirs = editor([COMPANION], [{ name: "B", location: "pb", ids: [CLAUDE] }]);
    extracted(dirs.extensionsDir, `${CODE};`);
    const { calls, run } = recorder();
    const answer = await addWhereMissing({
      contexts: [context(dirs)],
      settings: EVERY,
      carried,
      run,
    });
    expect(calls).toEqual([]);
    expect(answer.failed).toBe(false);
    expect(answer.lines[0]).toMatch(/different build/);
  });

  it("says so when this engine carries no companion to add", async () => {
    const dirs = editor([COMPANION], [{ name: "B", location: "pb", ids: [CLAUDE] }]);
    const { calls, run } = recorder();
    const answer = await addWhereMissing({
      contexts: [context(dirs)],
      settings: EVERY,
      carried: null,
      run,
    });
    expect(calls).toEqual([]);
    expect(answer.lines[0]).toMatch(/carries none/);
  });

  it("says when profiles could not be read, and adds nothing there", async () => {
    const dirs = editor([COMPANION]);
    writeFileSync(join(dirs.userData, "User", "globalStorage", "storage.json"), "{ not json");
    const { calls, run } = recorder();
    const answer = await addWhereMissing({
      contexts: [context(dirs)],
      settings: EVERY,
      carried,
      run,
    });
    expect(calls).toEqual([]);
    expect(answer.lines[0]).toMatch(/could not read the profiles/);
  });
});
