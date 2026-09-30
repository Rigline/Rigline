/**
 * The engine's argument handling. `homedir()` is a temporary directory, so a verb that failed to
 * refuse would find no extension to act on rather than the live one (D39).
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
import { writeFixtureExtension } from "../../test/fixtures.ts";
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

if (!EXTENSIONS_DIR.startsWith(home)) throw new Error(`${EXTENSIONS_DIR} is not under ${home}`);

let log: MockInstance<typeof console.log>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
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

describe("runEngine", () => {
  it.each([
    ["restore", "--ext", "DIR"],
    ["restore", "everything"],
    ["status", "--json"],
    ["status", "DIR"],
    ["install", "--payload", "DIR"],
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
  });

  afterEach(() => {
    rmSync(ext, { recursive: true, force: true });
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
