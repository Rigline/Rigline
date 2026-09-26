/**
 * `update`'s hand-off, with a faked registry and a faked engine (D106). Nothing here spawns a process
 * or reaches a registry.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { core, fakeChild, npm, writeEngine } from "../test/engine.ts";
import { splitUpdateArgs, updateCommand } from "./commands.ts";
import { type EngineOptions, engineDir } from "./engine.ts";
import { UserError } from "./errors.ts";

const made: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-commands-"));
  made.push(dir);
  return dir;
}

let log: MockInstance<typeof console.log>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("splitUpdateArgs", () => {
  it("takes --tag for itself and forwards the rest as typed, --now included", () => {
    expect(splitUpdateArgs(["--tag", "next", "clock", "--now", "--verbose"])).toEqual({
      tag: "next",
      now: true,
      forward: ["clock", "--now", "--verbose"],
    });
    expect(splitUpdateArgs(["--tag=next"])).toEqual({ tag: "next", now: false, forward: [] });
  });

  it("forwards everything after -- untouched", () => {
    expect(splitUpdateArgs(["--", "--tag", "x"])).toEqual({
      now: false,
      forward: ["--", "--tag", "x"],
    });
  });

  it("refuses a --tag with nothing after it", () => {
    expect(() => splitUpdateArgs(["--tag"])).toThrow(UserError);
  });
});

describe("updateCommand", () => {
  /**
   * A home holding `installed`, and a spawn that records every call: npm's installs `moveTo`, and
   * the engine's exits `code`.
   */
  function machine(installed: string, moveTo: string | null = null, code = 0, wrapper = installed) {
    const home = temp();
    const entry = join(writeEngine(engineDir(home), core(installed)), "dist", "engine", "bin.js");
    const beside = temp();
    mkdirSync(join(beside, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(join(beside, "node_modules", "npm", "bin", "npm-cli.js"), "");
    const calls: string[][] = [];
    const options: EngineOptions = {
      home,
      nodePath: join(beside, "node.exe"),
      version: wrapper,
      spawnImpl: (_command, args) => {
        calls.push([...args]);
        const npmRun = (args[0] as string).endsWith("npm-cli.js");
        if (npmRun && moveTo !== null) writeEngine(engineDir(home), core(moveTo));
        return fakeChild(npmRun ? 0 : code);
      },
    };
    return { entry, calls, options };
  }

  const unreachable: EngineOptions["registry"] = {
    registry: "https://registry.example",
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    },
  };

  it("hands the engine its own update, with every argument but --tag", async () => {
    const { entry, calls, options } = machine("1.0.0-alpha.13");
    const code = await updateCommand(["--tag", "latest", "clock", "--now"], {
      ...options,
      registry: npm("1.0.0-alpha.13"),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([[entry, "update", "clock", "--now"]]);
    expect(log.mock.calls[0]?.[0]).toBe(
      "engine: 1.0.0-alpha.13, which is what its tag resolves to",
    );
  });

  it("moves the engine first, and says a newer wrapper is out before handing off", async () => {
    const { entry, calls, options } = machine("1.0.0-alpha.13", "1.0.0-alpha.14");
    await updateCommand([], { ...options, registry: npm("1.0.0-alpha.14") });

    expect(calls.map((argv) => argv[0])).toEqual([expect.stringMatching(/npm-cli\.js$/), entry]);
    expect(calls[1]).toEqual([entry, "update"]);
    expect(log.mock.calls[0]?.[0]).toContain("engine: 1.0.0-alpha.13 -> 1.0.0-alpha.14");
    expect(error).toHaveBeenCalledWith(
      "rigline 1.0.0-alpha.14 is out, and this is 1.0.0-alpha.13: npm i -g rigline@1.0.0-alpha.14",
    );
  });

  it("exits 1 when the engine could not move, and still hands off to the one there", async () => {
    const { entry, calls, options } = machine("1.0.0-alpha.13");
    const code = await updateCommand([], { ...options, registry: unreachable });

    expect(code).toBe(1);
    expect(calls).toEqual([[entry, "update"]]);
  });

  it("passes the engine's exit code through", async () => {
    const { options } = machine("1.0.0-alpha.13", null, 1);
    expect(await updateCommand([], { ...options, registry: npm("1.0.0-alpha.13") })).toBe(1);
  });

  it("refuses to hand off to an engine whose update refuses, rather than running it", async () => {
    const { calls, options } = machine("1.0.0-alpha.12", null, 0, "1.0.0-alpha.13");
    await expect(updateCommand([], { ...options, registry: unreachable })).rejects.toThrow(
      /no plugin was updated/,
    );
    expect(calls).toEqual([]);
  });
});
