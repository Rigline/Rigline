/**
 * The engine's argument handling. `homedir()` is a temporary directory, so a verb that failed to
 * refuse would find no extension to act on rather than the live one, and the environment reaches no
 * editor, so no verb reads this machine's VS Code profiles or installs into them (D39).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import {
  encodeSettingsPayload,
  type RiglineSave,
  SETTINGS_PAYLOAD_VERSION,
  type SettingsSave,
} from "@rigline/plugin-api/internal";
import { writeFixtureExtension } from "../../test/fixtures.ts";
import { editorlessStubs } from "../../test/sandbox.ts";
import { editorDirs } from "../companion/profiles.ts";
import { EDITOR_CLIS } from "../companion/setup.ts";
import { readConfig } from "../plugins/config.ts";
import { ensureToken } from "../plugins/save.ts";
import { EXTENSIONS_DIR } from "../extension/locate.ts";
import { restoredAt } from "../inject/restored.ts";
import { runEngine } from "./main.ts";

const home = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return mkdtempSync(join(tmpdir(), "rigline-main-"));
});

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => home,
}));

/** Every profile read and every editor search a verb made, for the guard below. */
const seen = vi.hoisted(() => ({
  profiles: [] as { userData: string; extensionsDir: string }[],
  editors: [] as number[],
}));

vi.mock("../companion/profiles.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../companion/profiles.ts")>();
  return {
    ...actual,
    readProfiles: (userData: string, extensionsDir: string) => {
      seen.profiles.push({ userData, extensionsDir });
      return actual.readProfiles(userData, extensionsDir);
    },
  };
});

/** The companion this engine carries here, so a test can lay out VS Code's files to match it. */
const COMPANION = vi.hoisted(() => ({
  version: "2.0.0",
  code: '"use strict";\nexports.activate = () => {};\n',
  manifest: { name: "rigline", publisher: "rigline" },
}));

vi.mock("../companion/fingerprint.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../companion/fingerprint.ts")>();
  return {
    ...actual,
    carriedCompanion: () => ({
      version: COMPANION.version,
      fingerprint: actual.companionFingerprint(COMPANION.code, {
        ...COMPANION.manifest,
        version: COMPANION.version,
      }),
      vsix: "rigline.vsix",
    }),
  };
});

vi.mock("../companion/setup.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../companion/setup.ts")>();
  return {
    ...actual,
    findEditors: (...args: Parameters<typeof actual.findEditors>) => {
      const found = actual.findEditors(...args);
      seen.editors.push(found.length);
      return found;
    },
  };
});

if (!EXTENSIONS_DIR.startsWith(home)) throw new Error(`${EXTENSIONS_DIR} is not under ${home}`);

/** The default profile with Claude Code and the carried companion, as VS Code lists them (D143). */
function companionInstalled(): void {
  const name = `rigline.rigline-${COMPANION.version}`;
  mkdirSync(join(EXTENSIONS_DIR, name), { recursive: true });
  writeFileSync(join(EXTENSIONS_DIR, name, "extension.cjs"), COMPANION.code);
  writeFileSync(
    join(EXTENSIONS_DIR, name, "package.json"),
    JSON.stringify({ ...COMPANION.manifest, version: COMPANION.version }),
  );
  writeFileSync(
    join(EXTENSIONS_DIR, "extensions.json"),
    JSON.stringify([
      { identifier: { id: "anthropic.claude-code" }, version: "2.1.263" },
      { identifier: { id: "rigline.rigline" }, version: COMPANION.version, relativeLocation: name },
    ]),
  );
}

let log: MockInstance<typeof console.log>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  for (const [key, value] of editorlessStubs(home)) vi.stubEnv(key, value);
  vi.stubEnv("RIGLINE_HOME", "");
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("the sandbox (D39)", () => {
  const ext = join(EXTENSIONS_DIR, "anthropic.claude-code-2.1.263-win32-x64");

  afterEach(() => {
    rmSync(EXTENSIONS_DIR, { recursive: true, force: true });
    rmSync(join(home, ".rigline"), { recursive: true, force: true });
  });

  // No companion is laid out, so the install reads the profiles and goes looking for a CLI.
  it("keeps an injecting verb away from this machine's VS Code", async () => {
    writeFixtureExtension(ext);
    seen.profiles.length = 0;
    seen.editors.length = 0;

    expect(await runEngine(["install"])).toBe(1);

    expect(seen.profiles.length).toBeGreaterThan(0);
    for (const read of seen.profiles) {
      expect(read.userData.startsWith(home)).toBe(true);
      expect(read.extensionsDir.startsWith(home)).toBe(true);
    }
    expect(seen.editors).toEqual([0]);
    expect(error.mock.calls[0]?.[0]).toMatch(/no VS Code command-line tool was found on PATH/);
    for (const editor of EDITOR_CLIS) {
      expect(editorDirs(editor).userData.startsWith(home)).toBe(true);
    }
  }, 60_000);
});

describe("the companion (D143)", () => {
  const ext = join(EXTENSIONS_DIR, "anthropic.claude-code-2.1.263-win32-x64");
  const mark = (): string => join(home, ".rigline", "restored");
  const lines = (): string[] => log.mock.calls.flat().map(String);

  beforeEach(() => {
    writeFixtureExtension(ext);
    seen.editors.length = 0;
    // Away from this checkout's `generated.ts`, which an install over the fixture would rewrite.
    vi.spyOn(process, "cwd").mockReturnValue(home);
  });

  afterEach(() => {
    rmSync(EXTENSIONS_DIR, { recursive: true, force: true });
    rmSync(join(home, ".rigline"), { recursive: true, force: true });
  });

  it("is said nothing about where it is current, and the install goes ahead", async () => {
    companionInstalled();
    await runEngine(["install"]);
    expect(existsSync(join(ext, "webview", "rigline", "registry.js"))).toBe(true);
    expect(lines().some((line) => line.includes("companion"))).toBe(false);
  }, 60_000);

  it("refuses an install that needs it and cannot get it, injecting nothing and keeping a restore", async () => {
    await runEngine(["restore"]);
    expect(await runEngine(["install"])).toBe(1);
    expect(existsSync(join(ext, "webview", "rigline"))).toBe(false);
    expect(existsSync(mark())).toBe(true);
  }, 60_000);

  it("is checked by check, which names the profile and installs nothing", async () => {
    expect(await runEngine(["check"])).toBe(1);
    expect(lines().join("\n")).toContain(
      'profile "Default" has no companion, which `rigline install` puts in',
    );
    expect(seen.editors).toEqual([]);
  }, 60_000);

  it("is left out of check while a restore holds Rigline out", async () => {
    await runEngine(["restore"]);
    log.mockClear();
    // The fixture's plugins are refused for want of anchors, so the exit says nothing here.
    await runEngine(["check"]);
    expect(lines().join("\n")).not.toContain("companion");
  }, 60_000);

  it("is offered to no companion, and added to no profile, while a restore holds (D111)", async () => {
    const userData = join(home, "AppData", "Roaming", "Code");
    mkdirSync(join(userData, "User", "globalStorage"), { recursive: true });
    writeFileSync(join(userData, "User", "globalStorage", "storage.json"), "{}");
    writeFileSync(
      join(EXTENSIONS_DIR, "extensions.json"),
      JSON.stringify([{ identifier: { id: "anthropic.claude-code" }, version: "2.1.263" }]),
    );
    const look = [
      "companion-profiles",
      ...["--user-data-dir", userData, "--extensions-dir", EXTENSIONS_DIR],
      ...["--cli-node", process.execPath, "--cli-script", join(home, "no-cli.js")],
    ];
    const answer = (): Record<string, unknown> =>
      JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Record<string, unknown>;

    // Without the mark the look tries, and this CLI is a script that is not there.
    await runEngine(look);
    expect(answer()).toMatchObject({ failed: true });

    await runEngine(["restore"]);
    await runEngine(look);
    expect(answer()).toEqual({
      v: 1,
      lines: ["changed no profile's companion: Rigline is out since `rigline restore`"],
      failed: false,
    });
    companionInstalled();
    await runEngine([
      "companion-status",
      join(EXTENSIONS_DIR, `rigline.rigline-${COMPANION.version}`),
    ]);
    expect(answer()).toEqual({ v: 1, current: false, carried: null });
  }, 60_000);

  it("comes with vscode-setup, which 1.x names after the major, and which takes no flags", async () => {
    companionInstalled();
    expect(await runEngine(["vscode-setup"])).toBe(await runEngine(["install"]));
    expect(existsSync(join(ext, "webview", "rigline", "registry.js"))).toBe(true);
    expect(await runEngine(["vscode-setup", "--remove"])).toBe(1);
    expect(error.mock.calls.at(-2)?.[0]).toMatch(/^rigline: Unknown option '--remove'/);
  }, 60_000);
});

describe("uninstall (D143)", () => {
  const ext = join(EXTENSIONS_DIR, "anthropic.claude-code-2.1.263-win32-x64");
  const lines = (): string[] => log.mock.calls.flat().map(String);

  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue(home);
  });

  afterEach(() => {
    rmSync(EXTENSIONS_DIR, { recursive: true, force: true });
    rmSync(join(home, ".rigline"), { recursive: true, force: true });
  });

  it("restores first, then names the profiles to clear by hand where no CLI is on PATH", async () => {
    writeFixtureExtension(ext);
    companionInstalled();
    await runEngine(["install"]);
    log.mockClear();

    expect(await runEngine(["uninstall"])).toBe(1);

    const said = lines();
    const restored = said.findIndex((line) => line.startsWith("restored: "));
    const kept = said.findIndex((line) => line.startsWith('profile "Default" still has'));
    expect(restored).toBeGreaterThanOrEqual(0);
    expect(kept).toBeGreaterThan(restored);
    expect(said[kept]).toMatch(/uninstall Rigline from the Extensions view there$/);
    expect(existsSync(join(ext, "webview", "rigline"))).toBe(false);
    expect(existsSync(join(home, ".rigline", "restored"))).toBe(true);
    expect(said.join("\n")).toContain("npm uninstall -g rigline");
  }, 60_000);

  it("exits 0 where nothing of Rigline's is left", async () => {
    expect(await runEngine(["uninstall"])).toBe(0);
    expect(lines()).toContain("the companion is in no VS Code profile");
  });

  it("reads no config.yaml, so a broken one cannot stop it", async () => {
    mkdirSync(join(home, ".rigline"), { recursive: true });
    writeFileSync(join(home, ".rigline", "config.yaml"), "- not: [a mapping\n");
    expect(await runEngine(["uninstall"])).toBe(0);
  });
});

describe("runEngine", () => {
  it.each([
    ["restore", "--ext", "DIR"],
    ["restore", "everything"],
    ["status", "--json"],
    ["status", "DIR"],
    ["install", "--payload", "DIR"],
    ["vscode-setup", "--profile", "Work"],
  ])(
    "refuses what %s does not take, so a later 1.x's flag is never ignored: %s %s",
    async (...argv) => {
      expect(await runEngine(argv)).toBe(1);
      expect(log).not.toHaveBeenCalled();
      expect(error.mock.calls[0]?.[0]).toMatch(/^rigline: (Unknown option|Unexpected argument)/);
      expect(error.mock.calls[1]?.[0]).toBe("`rigline --help` lists what each command takes.");
    },
  );

  it("answers a mistyped flag on any verb with a line, not a stack", async () => {
    expect(await runEngine(["check", "--verbos"])).toBe(1);
    expect(error.mock.calls[0]?.[0]).toMatch(/^rigline: Unknown option '--verbos'/);
  });
});

describe("help and the version (W33)", () => {
  const printed = (): string => log.mock.calls.flat().join("\n");

  it("lists a user's verbs before the ones for writing plugins", async () => {
    expect(await runEngine(["help"])).toBe(0);
    const usage = printed();
    expect(usage.indexOf("rigline install")).toBeLessThan(usage.indexOf("rigline codegen"));
    expect(usage.indexOf("For writing plugins:")).toBeLessThan(usage.indexOf("rigline build"));
  });

  it.each([[["help", "remove"]], [["remove", "--help"]], [["remove", "NAME", "-h"]]])(
    "prints one verb's part of the usage for %j",
    async (argv) => {
      expect(await runEngine(argv)).toBe(0);
      expect(printed()).toMatch(/^ {2}rigline remove NAME\n/);
      expect(printed()).not.toContain("rigline install");
    },
  );

  it("prints both verbs a shared block documents", async () => {
    expect(await runEngine(["enable", "--help"])).toBe(0);
    expect(printed()).toContain("rigline disable NAME");
  });

  it("refuses help for a verb there is none of", async () => {
    expect(await runEngine(["help", "nonsense"])).toBe(1);
    expect(error.mock.calls[0]?.[0]).toMatch(/^rigline: unknown command "nonsense"/);
  });

  it("prints the engine's version", async () => {
    expect(await runEngine(["--version"])).toBe(0);
    expect(printed()).toMatch(/^@rigline\/core \d+\.\d+\.\d+/);
  });
});

describe("--out (W33)", () => {
  it("makes the directory a doctor report is written into", async () => {
    const out = join(home, "reports", "today", "doctor.md");
    expect(await runEngine(["doctor", "--out", out])).toBe(0);
    expect(readFileSync(out, "utf8")).toMatch(/^# rigline doctor/);
  });
});

describe("the mark restore leaves (D111)", () => {
  const mark = (): string => join(home, ".rigline", "restored");

  afterEach(() => {
    rmSync(mark(), { force: true });
  });

  it("is left by restore, which says Rigline stays out", async () => {
    expect(await runEngine(["restore"])).toBe(0);
    expect(existsSync(mark())).toBe(true);
    expect(log.mock.calls.flat()).toContain(
      "Rigline stays out, whatever reloads or updates, until you run `rigline install` or another command that injects.",
    );
  });

  it("comes with removing what an install left in a version VS Code deleted (D113)", async () => {
    const leftover = join(EXTENSIONS_DIR, "anthropic.claude-code-2.1.280-win32-x64");
    mkdirSync(join(leftover, "webview", "rigline"), { recursive: true });
    writeFileSync(join(leftover, "webview", "rigline", "pre.js"), "");

    expect(await runEngine(["restore"])).toBe(0);
    expect(existsSync(leftover)).toBe(false);
    expect(log.mock.calls.flat()).toContain(
      `removed: ${leftover} (left by an install after VS Code deleted that version)`,
    );
  });

  it("stays through the companion's install, and goes with a person's", async () => {
    await runEngine(["restore"]);

    // No extension is installed here, so both stop there; what differs is the mark.
    expect(await runEngine(["install", "--companion"])).toBe(1);
    expect(error.mock.calls.flat()).toEqual([
      `rigline: no Claude Code extension is installed in ${EXTENSIONS_DIR}`,
    ]);
    expect(existsSync(mark())).toBe(true);
    expect(await runEngine(["install"])).toBe(1);
    expect(existsSync(mark())).toBe(false);
    expect(log.mock.calls.flat()).toContain(
      "Rigline was out since `rigline restore`; this puts it back.",
    );
  });
});

describe("a version that is not whole (W9, W10)", () => {
  const good = join(EXTENSIONS_DIR, "anthropic.claude-code-2.1.263-win32-x64");
  const broken = join(EXTENSIONS_DIR, "anthropic.claude-code-2.1.280-win32-x64");

  afterEach(() => {
    rmSync(EXTENSIONS_DIR, { recursive: true, force: true });
  });

  it("is named by status beside every other version, rather than ending it", async () => {
    writeFixtureExtension(good);
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "package.json"), '{"version": "2.1.2');

    expect(await runEngine(["status"])).toBe(0);
    const lines = log.mock.calls.flat();
    expect(lines).toContain("anthropic.claude-code-2.1.280-win32-x64: webview/index.js is missing");
    expect(lines.some((line) => String(line).startsWith("2.1.263: webview "))).toBe(true);
  });

  it("is a directory that is not there, when --ext names one", async () => {
    const nowhere = join(home, "no-such-extension");
    expect(await runEngine(["install", "--ext", nowhere])).toBe(1);
    expect(error.mock.calls.flat()).toEqual([`rigline: ${nowhere} does not exist`]);
  });
});

describe("a directory named with --ext (W34, D118)", () => {
  const copy = join(home, "copies", "anthropic.claude-code-2.1.263-win32-x64");
  const rigline = (): string => join(home, ".rigline");
  const generated = join(process.cwd(), "generated.ts");
  const read = (path: string): string | null =>
    existsSync(path) ? readFileSync(path, "utf8") : null;

  beforeEach(() => {
    writeFixtureExtension(copy);
  });

  afterEach(() => {
    rmSync(join(home, "copies"), { recursive: true, force: true });
    rmSync(rigline(), { recursive: true, force: true });
  });

  it("is injected, and moves nothing kept about the installed set", async () => {
    const before = read(generated);
    await runEngine(["install", "--ext", copy]);
    expect(existsSync(join(copy, "webview", "rigline", "registry.js"))).toBe(true);
    expect(existsSync(join(rigline(), "baseline.json"))).toBe(false);
    expect(existsSync(join(rigline(), "drift.txt"))).toBe(false);
    expect(read(generated)).toBe(before);
  }, 60_000);

  it("leaves a restore holding the installed versions out, and says so", async () => {
    await runEngine(["restore"]);
    await runEngine(["install", "--ext", copy]);
    expect(existsSync(join(rigline(), "restored"))).toBe(true);
    const lines = log.mock.calls.flat().map(String);
    expect(
      lines.some((line) => line.startsWith("Rigline is out since `rigline restore` at ")),
    ).toBe(true);
    expect(lines).not.toContain("Rigline was out since `rigline restore`; this puts it back.");
  }, 60_000);
});

describe("status and restore (W34)", () => {
  const older = join(EXTENSIONS_DIR, "anthropic.claude-code-2.1.263-win32-x64");
  const newer = join(EXTENSIONS_DIR, "anthropic.claude-code-2.1.280-win32-x64");

  afterEach(() => {
    rmSync(EXTENSIONS_DIR, { recursive: true, force: true });
    rmSync(join(home, ".rigline"), { recursive: true, force: true });
  });

  it("lists versions newest first, and one never injected as that", async () => {
    writeFixtureExtension(older);
    writeFixtureExtension(newer, "2.1.280");
    expect(await runEngine(["status"])).toBe(0);
    const lines = log.mock.calls.flat().map(String);
    expect(lines.filter((line) => line.startsWith("2.1."))).toEqual([
      "2.1.280: webview not injected; host vanilla",
      "2.1.263: webview not injected; host vanilla",
    ]);
  });

  it("says a restore is holding Rigline out", async () => {
    writeFixtureExtension(older);
    mkdirSync(join(home, ".rigline"), { recursive: true });
    writeFileSync(join(home, ".rigline", "restored"), "2026-09-29T01:00:00.000Z\n");
    expect(await runEngine(["status"])).toBe(0);
    expect(log.mock.calls[0]?.[0]).toBe(
      `Rigline is out since \`rigline restore\` at ${restoredAt("2026-09-29T01:00:00.000Z")}; ` +
        "`rigline install` puts it back.",
    );
  });

  it("says when there was nothing to restore", async () => {
    expect(await runEngine(["restore"])).toBe(0);
    expect(log.mock.calls.flat()).toContain(
      `No Claude Code extension is installed in ${EXTENSIONS_DIR}, so there was nothing to restore.`,
    );
  });
});

/**
 * `settings save`, which is the companion's verb and so not in the usage (D93, D138). No extension
 * is installed here, so `reinject` finds nothing and says so — the save has already printed by then,
 * which is the point: its first line is what the companion shows.
 */
describe("settings save (D138)", () => {
  const rigline = (): string => join(home, ".rigline");
  const configPath = (): string => join(rigline(), "config.yaml");

  /** A plugin discovery will find, which is all this needs of one. */
  function installed(name: string): void {
    const dir = join(rigline(), "plugins", name);
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(
      join(dir, "rigline.json"),
      JSON.stringify({ api: 1, name, entry: "dist/index.js", uses: {} }),
    );
    writeFileSync(join(dir, "dist", "index.js"), "export default { setup() {} };" + "\n");
  }

  function link(sections: Record<string, SettingsSave>, own?: RiglineSave): string {
    const made = ensureToken(join(rigline(), "token"));
    if ("problem" in made) throw new Error(made.problem);
    return encodeSettingsPayload({
      v: SETTINGS_PAYLOAD_VERSION,
      token: made.token,
      sections,
      ...(own === undefined ? {} : { rigline: own }),
    });
  }

  const lines = (): string[] => log.mock.calls.flat().map(String);

  afterEach(() => {
    rmSync(rigline(), { recursive: true, force: true });
  });

  it.each([
    ["settings"],
    ["settings", "nonsense"],
    ["settings", "save"],
    ["settings", "save", "one", "two"],
  ])("refuses %s %s %s, rather than saving something it half understood", async (...argv) => {
    expect(await runEngine(argv)).toBe(1);
    expect(error.mock.calls[0]?.[0]).toMatch(/^rigline: (settings|unknown settings command)/);
  });

  it("writes the section, and leads with the outcome", async () => {
    installed("clock");

    expect(
      await runEngine(["settings", "save", link({ clock: { from: {}, to: { tick: 1 } } })]),
    ).toBe(0);

    expect(lines()[0]).toBe(`saved the panel's settings to ${configPath()}`);
    expect(readConfig(configPath()).settings).toEqual({ clock: { tick: 1 } });
  }, 60_000);

  it("skips a section naming a plugin that is not installed, and names it after the outcome", async () => {
    installed("clock");

    const payload = link({
      clock: { from: {}, to: { tick: 1 } },
      gone: { from: {}, to: { tick: 2 } },
    });
    expect(await runEngine(["settings", "save", payload])).toBe(0);

    // In the outcome, not a line after it: `reinject` prints below, so a rule about what follows
    // would fire on that instead.
    expect(lines()[0]).toBe(
      `saved the panel's settings to ${configPath()}; skipped "gone": no plugin of that name is installed`,
    );
    expect(readConfig(configPath()).settings).toEqual({ clock: { tick: 1 } });
  }, 60_000);

  it("saves Rigline's own settings alone, and names them where they moved since", async () => {
    mkdirSync(rigline(), { recursive: true });
    writeFileSync(configPath(), "model:\n  requireChoice: unlessDefault\n");

    const payload = link(
      {},
      {
        from: { model: { requireChoice: "off", default: null } },
        to: { model: { requireChoice: "always", default: null } },
      },
    );
    expect(await runEngine(["settings", "save", payload])).toBe(0);

    expect(lines()[0]).toBe(
      `saved the panel's settings to ${configPath()}, over a change to Rigline's model settings made since the panel loaded`,
    );
    expect(readConfig(configPath()).model.requireChoice).toBe("always");
  }, 60_000);

  it("refuses, rather than reporting a save, when no section names a plugin it has", async () => {
    installed("clock");

    // A save that wrote nothing is a failed request, so it arrives at the companion on the
    // `rigline: ` line its refusal path already reads, not as an outcome it has to recognise.
    expect(
      await runEngine(["settings", "save", link({ gone: { from: {}, to: { tick: 2 } } })]),
    ).toBe(1);

    expect(error.mock.calls[0]?.[0]).toBe("rigline: not saved: no plugin named gone is installed");
    expect(existsSync(configPath())).toBe(false);
  }, 60_000);
});

describe("dev (W2)", () => {
  const plugins = (): string => join(home, ".rigline", "plugins");
  const ext = join(EXTENSIONS_DIR, "anthropic.claude-code-2.1.263-win32-x64");

  function writePlugin(dir: string, name: string, marker: string): string {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "rigline.json"),
      JSON.stringify({ api: 1, name, entry: "dist/index.js", uses: {} }),
    );
    writeFileSync(join(dir, "src", "index.ts"), `export const marker = "${marker}";\n`);
    return dir;
  }

  /** The first pass, then Ctrl-C, as a person would stop it. */
  async function developOnce(dir: string): Promise<number> {
    const running = runEngine(["dev", dir]);
    await vi.waitFor(
      () => {
        expect(log.mock.calls.flat().some((line) => String(line).startsWith("watching"))).toBe(
          true,
        );
      },
      { timeout: 30_000 },
    );
    process.emit("SIGINT");
    return running;
  }

  beforeEach(() => {
    writeFixtureExtension(ext);
    companionInstalled();
  });

  afterEach(() => {
    rmSync(EXTENSIONS_DIR, { recursive: true, force: true });
    rmSync(join(home, ".rigline"), { recursive: true, force: true });
  });

  it("installs each build over the copy add made, so the panel loads what was just built", async () => {
    const dir = writePlugin(join(home, "work", "clock"), "clock", "fresh");
    const stale = writePlugin(join(plugins(), "clock"), "clock", "stale");
    mkdirSync(join(stale, "dist"));
    writeFileSync(join(stale, "dist", "index.js"), 'export const marker = "stale";\n');

    expect(await developOnce(dir)).toBe(0);

    expect(readFileSync(join(plugins(), "clock", "dist", "index.js"), "utf8")).toContain("fresh");
    const baked = join(ext, "webview", "rigline", "plugins", "clock", "dist", "index.js");
    expect(readFileSync(baked, "utf8")).toContain("fresh");
    expect(log.mock.calls.flat()).toContain(`replaced clock — ${join(plugins(), "clock")}`);
  }, 60_000);

  it("builds one already in ~/.rigline/plugins where it is, and copies nothing", async () => {
    const dir = writePlugin(join(plugins(), "clock"), "clock", "in place");

    expect(await developOnce(dir)).toBe(0);

    expect(readFileSync(join(dir, "dist", "index.js"), "utf8")).toContain("in place");
    expect(existsSync(join(home, ".rigline", "sources.json"))).toBe(false);
    expect(log.mock.calls.flat().some((line) => String(line).startsWith("replaced"))).toBe(false);
  }, 60_000);
});
