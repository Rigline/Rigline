/**
 * The engine's argument handling. `homedir()` is a temporary directory, so a verb that failed to
 * refuse would find no extension to act on rather than the live one (D39).
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
import { EXTENSIONS_DIR } from "../extension/locate.ts";
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

describe("the mark restore leaves (D111)", () => {
  const mark = (): string => join(home, ".rigline", "restored");

  afterEach(() => {
    rmSync(mark(), { force: true });
  });

  it("is left by restore, which says Rigline stays out", async () => {
    expect(await runEngine(["restore"])).toBe(0);
    expect(existsSync(mark())).toBe(true);
    expect(log.mock.calls.flat()).toContain(
      "Rigline stays out, whatever reloads or updates, until you run `rigline install`.",
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
    expect(error.mock.calls.flat()).toEqual(["rigline: no Claude Code extension is installed"]);
    expect(existsSync(mark())).toBe(true);
    expect(await runEngine(["install"])).toBe(1);
    expect(existsSync(mark())).toBe(false);
    expect(log.mock.calls.flat()).toContain(
      "Rigline was out since `rigline restore`; this puts it back.",
    );
  });
});
