/**
 * The engine's argument handling. `homedir()` is a temporary directory, so a verb that failed to
 * refuse would find no extension to act on rather than the live one (D39).
 */
import { rmSync } from "node:fs";
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
