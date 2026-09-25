/**
 * The wrapper's engine half, with a faked npm and a faked engine.
 *
 * Nothing here spawns a process or reaches a registry. What it asserts is the part of D73 a test can
 * hold: where the engine is looked for, what argv installs it, that a major mismatch refuses rather
 * than runs, and that `update` reports the engine before anything is fetched for a plugin.
 *
 * The first test is the one that earns the duplication D69 accepts: the wrapper reimplements core's
 * `riglineHome()` because it depends on no Rigline package, so the two are compared here. The import
 * is relative and test-only — a dependency would put core where a `src/` import could reach it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { riglineHome as coreRiglineHome } from "../../core/src/paths.ts";
import {
  ENGINE_BIN,
  ENGINE_PACKAGE,
  type EngineUpdate,
  engineDir,
  engineInstallArgv,
  ensureEngine,
  findNpmCli,
  formatEngineUpdate,
  majorProblem,
  readEngineState,
  riglineHome,
  updateEngine,
} from "./engine.ts";
import { lockPath } from "./lock.ts";
import type { FetchLike, RegistryOptions } from "./registry.ts";

const made: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-engine-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An engine prefix as npm would have left it, or as an older core would have. */
function writeEngine(
  prefix: string,
  manifest: Record<string, unknown>,
  entry: string | null = "dist/engine/bin.js",
): string {
  const dir = join(prefix, "node_modules", ENGINE_PACKAGE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  if (entry !== null) {
    mkdirSync(join(dir, "dist", "engine"), { recursive: true });
    writeFileSync(join(dir, entry), "");
  }
  return dir;
}

function core(version: string): Record<string, unknown> {
  return { name: ENGINE_PACKAGE, version, bin: { [ENGINE_BIN]: "./dist/engine/bin.js" } };
}

/** A registry serving one version of `@rigline/core`, with no network anywhere. */
function npm(version: string, publishedAt = "2026-09-01T12:00:00.000Z"): RegistryOptions {
  const packument = {
    "dist-tags": { latest: version },
    time: { [version]: publishedAt },
    versions: {
      [version]: { dist: { tarball: "https://example/core.tgz", integrity: "sha512-x" } },
    },
  };
  const fetchImpl: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => packument,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  return {
    registry: "https://registry.example",
    fetchImpl,
    clock: () => Date.parse("2026-09-21T12:00:00.000Z"),
  };
}

describe("riglineHome", () => {
  it("agrees with core's, which is the price D69 accepts for the split", () => {
    const env = { RIGLINE_HOME: "" } as NodeJS.ProcessEnv;
    expect(riglineHome(env)).toBe(coreRiglineHome(env));
    const set = { RIGLINE_HOME: join("C:", "elsewhere") } as NodeJS.ProcessEnv;
    expect(riglineHome(set)).toBe(coreRiglineHome(set));
  });

  it("puts the engine under it, which is what rm -rf recovers", () => {
    expect(engineDir(join("C:", "home", ".rigline"))).toBe(
      join("C:", "home", ".rigline", "engine"),
    );
  });
});

describe("readEngineState", () => {
  it("finds nothing in an empty prefix", () => {
    expect(readEngineState(temp()).kind).toBe("none");
  });

  it("reads the version and resolves the entry from bin, never from a fixed path", () => {
    const prefix = temp();
    const dir = writeEngine(prefix, core("1.0.0-alpha.6"));
    const state = readEngineState(prefix);
    expect(state).toMatchObject({
      kind: "ready",
      version: "1.0.0-alpha.6",
      entry: join(dir, "dist", "engine", "bin.js"),
    });
  });

  it("calls an engine with no rigline-engine command unusable rather than absent", () => {
    // Which is exactly what every published @rigline/core before this milestone looks like: a
    // package that installs cleanly and cannot be started.
    const prefix = temp();
    writeEngine(prefix, { name: ENGINE_PACKAGE, version: "1.0.0-alpha.5" });
    expect(readEngineState(prefix)).toMatchObject({
      kind: "unusable",
      version: "1.0.0-alpha.5",
    });
  });

  it("calls a bin whose entry is missing unusable too", () => {
    const prefix = temp();
    writeEngine(prefix, core("1.0.0"), null);
    const state = readEngineState(prefix);
    expect(state.kind).toBe("unusable");
    expect(state.kind === "unusable" && state.why).toContain("missing");
  });
});

describe("majorProblem", () => {
  it("passes a matching major and refuses a different one by name", () => {
    expect(majorProblem("1.0.0-alpha.6", "1.2.3")).toBeNull();
    expect(majorProblem("1.0.0", "2.0.0")).toContain("rigline 1.x cannot run engine 2.x");
  });

  it("says nothing about a version it cannot read, rather than guessing", () => {
    expect(majorProblem("1.0.0", "unreadable")).toBeNull();
  });
});

describe("engineInstallArgv", () => {
  it("pins exactly, declines scripts, and names the prefix", () => {
    const argv = engineInstallArgv({
      npmCli: join("C:", "node", "npm-cli.js"),
      prefix: join("C:", "home", ".rigline", "engine"),
      specs: [`${ENGINE_PACKAGE}@1.0.0`],
    });
    expect(argv[0]).toBe(join("C:", "node", "npm-cli.js"));
    expect(argv).toContain("--save-exact");
    expect(argv).toContain("--ignore-scripts");
    expect(argv.slice(-1)).toEqual([`${ENGINE_PACKAGE}@1.0.0`]);
    expect(argv[argv.indexOf("--prefix") + 1]).toBe(join("C:", "home", ".rigline", "engine"));
  });
});

describe("findNpmCli", () => {
  it("takes the npm beside this Node, never one on PATH", () => {
    const node = join("C:", "Program Files", "nodejs", "node.exe");
    const windows = join(
      "C:",
      "Program Files",
      "nodejs",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    expect(findNpmCli(node, (p) => p === windows)).toBe(windows);
  });

  it("falls through to the POSIX layout", () => {
    const node = join("/usr", "local", "bin", "node");
    const posix = join(
      "/usr",
      "local",
      "bin",
      "..",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    expect(findNpmCli(node, (p) => p === posix)).toBe(posix);
  });

  it("refuses with the command to run rather than reaching for PATH", () => {
    expect(() => findNpmCli(join("C:", "node.exe"), () => false)).toThrow(/npm install --prefix/);
  });
});

describe("updateEngine", () => {
  it("installs when there is none, through the argv it would really use", async () => {
    const prefix = temp();
    const calls: string[][] = [];
    const update = await updateEngine({
      home: prefix,
      version: "1.0.0-alpha.7",
      registry: npm("1.0.0-alpha.7"),
      spawnImpl: (_command, args) => {
        calls.push([...args]);
        // The install "succeeded", so the prefix must look installed for the caller to agree.
        writeEngine(engineDir(prefix), core("1.0.0-alpha.7"));
        return fakeChild(0);
      },
    });
    expect(update).toMatchObject({ outcome: "installed", to: "1.0.0-alpha.7" });
    expect(calls[0]).toContain(`${ENGINE_PACKAGE}@1.0.0-alpha.7`);
  });

  it("runs npm with the Node it was given rather than this process (D80)", async () => {
    // What the companion extension needs: there `process.execPath` is VS Code's Electron binary,
    // which has no npm beside it and cannot run the engine's entry. `findNpmCli` still pairs npm to
    // that Node, which is why the fake one gets a real npm beside it rather than a stubbed `exists`.
    const prefix = temp();
    const beside = temp();
    const node = join(beside, "node.exe");
    mkdirSync(join(beside, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(join(beside, "node_modules", "npm", "bin", "npm-cli.js"), "");

    const commands: string[] = [];
    const update = await updateEngine({
      home: prefix,
      nodePath: node,
      version: "1.0.0-alpha.7",
      registry: npm("1.0.0-alpha.7"),
      spawnImpl: (command, _args) => {
        commands.push(command);
        writeEngine(engineDir(prefix), core("1.0.0-alpha.7"));
        return fakeChild(0);
      },
    });

    expect(update).toMatchObject({ outcome: "installed", to: "1.0.0-alpha.7" });
    expect(commands).toEqual([node]);
  });

  it("holds the home lock across the npm run, not merely around it (D80)", async () => {
    // The property worth asserting is not that a lock is taken but that it is still held while the
    // thing it protects is happening, which is what a release in the wrong place would break.
    const prefix = temp();
    let heldDuringNpm: string | null = null;
    await updateEngine({
      home: prefix,
      label: "the Rigline companion extension",
      version: "1.0.0-alpha.7",
      registry: npm("1.0.0-alpha.7"),
      spawnImpl: () => {
        heldDuringNpm = readFileSync(lockPath(prefix), "utf8");
        writeEngine(engineDir(prefix), core("1.0.0-alpha.7"));
        return fakeChild(0);
      },
    });

    expect(JSON.parse(heldDuringNpm ?? "null")).toMatchObject({
      what: "the Rigline companion extension",
    });
    expect(existsSync(lockPath(prefix))).toBe(false);
  });

  it("refuses rather than installing over a live holder (D80)", async () => {
    const prefix = temp();
    mkdirSync(prefix, { recursive: true });
    writeFileSync(
      lockPath(prefix),
      JSON.stringify({ pid: process.pid, since: new Date().toISOString(), what: "rigline update" }),
    );
    const update = await updateEngine({
      home: prefix,
      version: "1.0.0-alpha.7",
      registry: npm("1.0.0-alpha.7"),
      lock: { waitMs: 0, sleep: async () => {} },
      spawnImpl: () => {
        throw new Error("npm should never have run");
      },
    });

    // Reported rather than thrown, which is `update`'s existing contract and the right one here:
    // the companion runs this unattended, and a contended lock is a thing to say, not to crash on.
    expect(update).toMatchObject({ outcome: "failed" });
    expect((update as { reason: string }).reason).toMatch(/rigline update \(pid \d+\)/);
    expect(existsSync(lockPath(prefix))).toBe(true);
  });

  it("leaves an engine already on what its tag resolves to, and spawns nothing", async () => {
    const prefix = temp();
    writeEngine(engineDir(prefix), core("1.0.0-alpha.7"));
    const update = await updateEngine({
      home: prefix,
      version: "1.0.0-alpha.7",
      registry: npm("1.0.0-alpha.7"),
      spawnImpl: () => {
        throw new Error("nothing should have been spawned");
      },
    });
    expect(update).toEqual({ outcome: "current", from: "1.0.0-alpha.7" });
  });

  it("does not gate a first run, because there is nothing to stay on (D48, D73)", async () => {
    // The shape Leo hit on a fresh machine: `update` on a day-old release refused the engine as too
    // young, printed `staying on undefined`, and then `ensureEngine` installed it anyway seconds
    // later — one run disagreeing with itself, and no re-inject, because the outcome said withheld.
    const prefix = temp();
    const update = await updateEngine({
      home: prefix,
      version: "1.0.0-alpha.6",
      registry: npm("1.0.0-alpha.6", "2026-09-21T11:51:00.000Z"),
      spawnImpl: (_command, _args) => {
        writeEngine(engineDir(prefix), core("1.0.0-alpha.6"));
        return fakeChild(0);
      },
    });
    expect(update).toEqual({ outcome: "installed", to: "1.0.0-alpha.6" });
    expect(formatEngineUpdate(update, prefix)).not.toContain("undefined");
  });

  it("withholds a version too young and names what it stayed on (D48)", async () => {
    const prefix = temp();
    writeEngine(engineDir(prefix), core("1.0.0-alpha.6"));
    const update = await updateEngine({
      home: prefix,
      version: "1.0.0-alpha.7",
      registry: npm("1.0.0-alpha.7", "2026-09-21T11:20:00.000Z"),
      spawnImpl: () => {
        throw new Error("nothing should have been spawned");
      },
    });
    expect(update).toMatchObject({
      outcome: "withheld",
      from: "1.0.0-alpha.6",
      to: "1.0.0-alpha.7",
    });
  });

  it("refuses a major of its own rather than installing one it cannot run", async () => {
    const prefix = temp();
    const update = await updateEngine({
      home: prefix,
      version: "1.0.0",
      registry: npm("2.0.0"),
      spawnImpl: () => {
        throw new Error("nothing should have been spawned");
      },
    });
    expect(update).toMatchObject({ outcome: "failed" });
    expect(update.outcome === "failed" && update.reason).toContain("cannot run engine 2.x");
  });

  it("reports a registry it cannot reach and leaves the engine where it is", async () => {
    const prefix = temp();
    writeEngine(engineDir(prefix), core("1.0.0-alpha.6"));
    const update = await updateEngine({
      home: prefix,
      version: "1.0.0-alpha.6",
      registry: {
        registry: "https://registry.example",
        fetchImpl: async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        },
      },
    });
    expect(update).toMatchObject({ outcome: "failed", from: "1.0.0-alpha.6" });
    expect(readEngineState(engineDir(prefix))).toMatchObject({ version: "1.0.0-alpha.6" });
  });
});

describe("formatEngineUpdate", () => {
  it("names the version it left, so the rollback has its argument", () => {
    const moved: EngineUpdate = { outcome: "moved", from: "1.0.0-alpha.6", to: "1.0.0-alpha.7" };
    const line = formatEngineUpdate(moved, join("C:", "home", ".rigline"));
    expect(line).toContain("1.0.0-alpha.6 -> 1.0.0-alpha.7");
    expect(line).toContain(`${ENGINE_PACKAGE}@1.0.0-alpha.6`);
  });
});

/** A child process that has already finished. Enough of one for `close` and for no stdio. */
function fakeChild(code: number) {
  const handlers = new Map<string, (value: number) => void>();
  queueMicrotask(() => handlers.get("close")?.(code));
  return {
    stdout: null,
    stderr: null,
    on(event: string, handler: (value: number) => void) {
      handlers.set(event, handler);
      return this;
    },
  } as unknown as ReturnType<typeof import("node:child_process").spawn>;
}

describe("Engine.run", () => {
  it("adds what it is given to this process's environment, which is how update defers (D98)", async () => {
    const prefix = temp();
    writeEngine(engineDir(prefix), core("1.0.0-alpha.7"));
    const envs: (NodeJS.ProcessEnv | undefined)[] = [];
    const engine = await ensureEngine({
      home: prefix,
      version: "1.0.0-alpha.7",
      spawnImpl: (_command, _args, options) => {
        envs.push(options.env);
        return fakeChild(0);
      },
    });

    await engine.run(["add", "staged"], { RIGLINE_DEFER_INJECT: "1" });
    await engine.run(["install"]);

    expect(envs[0]?.RIGLINE_DEFER_INJECT).toBe("1");
    expect(Object.keys(envs[0] ?? {})).toEqual(expect.arrayContaining(Object.keys(process.env)));
    // Absent rather than copied, so a plain run inherits exactly as it always did.
    expect(envs[1]).toBeUndefined();
  });
});
