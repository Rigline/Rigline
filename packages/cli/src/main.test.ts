import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWrapper } from "./main.ts";

let home: string;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rigline-main-"));
  vi.stubEnv("RIGLINE_HOME", home);
  vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe("runWrapper", () => {
  it.each([["--version"], ["-v"]])("answers %s alone, installing nothing", async (flag) => {
    expect(await runWrapper([flag])).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });

  // Nothing updates the wrapper, so what 1.0 accepts here it accepts for the whole major (M29).
  it.each([
    [
      ["--version", "foo"],
      "Unexpected argument 'foo'. This command does not take positional arguments",
    ],
    [["-v", "--bogus"], "Unknown option '--bogus'"],
  ])("refuses %j in the engine's words", async (argv, said) => {
    expect(await runWrapper(argv)).toBe(1);
    expect(error.mock.calls).toEqual([
      [`rigline: ${said}\n\`rigline --help\` lists what each command takes.`],
    ]);
  });
});
