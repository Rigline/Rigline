/**
 * Tier 4: the tarballs, installed (docs/verification.md, D36).
 *
 * Every other tier drives this workspace, where a relative path from a package's `dist` happens to
 * reach the files beside it. Installed from npm those paths reach nothing, and `rigline install`
 * threw `payload is missing pre.js` for two releases while every test was green — because no test
 * had ever exercised the published artefact. This is that test, and it is the part of milestone 7
 * that stops the failure recurring rather than the part that fixes it.
 *
 * Since the wrapper and the engine separated it builds **two** prefixes, because that is what a user
 * has (D73): `rigline` alone, and `@rigline/core` under a temporary `RIGLINE_HOME/engine`. The engine
 * goes in through `engineInstallArgv`, the wrapper's own construction, so what is asserted is the
 * real npm invocation rather than a copy of it. The one step that cannot happen here is resolving a
 * version against a registry, which is tier 1's.
 *
 * `pnpm pack` and not `npm pack`: npm leaves `workspace:*` in the packed manifest, which installs as
 * a dependency npm cannot resolve. pnpm substitutes the exact version, which is also what makes the
 * tarballs resolve each other with no registry (D46).
 */
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundledDir } from "../../core/src/assets.ts";
import { writeFixtureExtension } from "../../core/test/fixtures.ts";
import { packageTarball } from "../../core/test/tar.ts";
import { engineDir, engineInstallArgv, findNpmCli, readEngineState } from "../src/engine.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The engine's half, in dependency order, and the wrapper's. */
const ENGINE_PACKAGES = ["plugin-api", "core"] as const;
const WRAPPER_PACKAGE = "cli";

/** The payload directory `install` writes under an extension's `webview/`. */
const PAYLOAD = ["webview", "rigline"] as const;

let work: string;
/** `RIGLINE_HOME` for every run here, so nothing touches the developer's own state. */
let home: string;
let prefix: string;
/** Where npm put the wrapper: the prefix's node_modules, wherever this platform keeps it. */
let modules: string;

/** Run a command, failing the test with everything it said rather than with an exit code. */
function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env?: Readonly<Record<string, string>>,
): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd}\n${e.stdout ?? ""}\n${e.stderr ?? e.message ?? ""}`,
    );
  }
}

/** The same, for a command whose non-zero exit is a verdict rather than a failure to run. */
function attempt(
  command: string,
  args: readonly string[],
  cwd: string,
  env?: Readonly<Record<string, string>>,
): { readonly stdout: string } {
  try {
    return { stdout: run(command, args, cwd, env) };
  } catch (error) {
    const text = (error as Error).message;
    // A command that never started is still a failure: nothing it should have printed is there.
    if (!text.includes("injected") && !text.includes("refreshed")) throw error;
    return { stdout: text };
  }
}

function pack(name: string): string {
  const dir = join(ROOT, "packages", name);
  const args = ["pack", "--pack-destination", work];
  // Through `cmd` on Windows, where a runner's pnpm is a `.cmd` shim that spawning `pnpm` misses,
  // as `riglineCommand` runs `rigline` and `packages/create-plugin/test/packed.test.ts` runs pnpm.
  const out =
    process.platform === "win32"
      ? run(process.env.COMSPEC ?? "cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], dir)
      : run("pnpm", args, dir);
  // pnpm prints the path it wrote as the last non-empty line.
  const path = out.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
  if (!existsSync(path)) throw new Error(`pnpm pack wrote no tarball for ${name}: ${out}`);
  return path;
}

/**
 * The engine's third-party runtime dependencies, packed from the copies this workspace installed,
 * which is the exact version each is pinned at: what the registry would have served, offline.
 */
function packThirdParty(): string[] {
  const tarballs: string[] = [];
  for (const name of ENGINE_PACKAGES) {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "packages", name, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (dep.startsWith("@rigline/")) continue;
      const dir = join(ROOT, "packages", name, "node_modules", dep);
      const out = run(
        process.execPath,
        [findNpmCli(), "pack", dir, "--pack-destination", work, "--ignore-scripts"],
        work,
      );
      // npm prints the file name it wrote as the last non-empty line.
      const path = join(work, out.trim().split(/\r?\n/).at(-1)?.trim() ?? "");
      if (!existsSync(path)) throw new Error(`npm pack wrote no tarball for ${dep}: ${out}`);
      tarballs.push(path);
    }
  }
  return tarballs;
}

beforeAll(() => {
  // Asked first and through the resolver, so an unbuilt or stale workspace fails with the build
  // command rather than with an npm error about a tarball that has no `dist` in it.
  bundledDir();

  work = mkdtempSync(join(tmpdir(), "rigline-packed-"));
  home = join(work, "home");
  prefix = join(work, "prefix");
  const engine = engineDir(home);
  mkdirSync(prefix, { recursive: true });
  mkdirSync(engine, { recursive: true });

  // The engine, through the argv the wrapper itself would hand npm. `--offline` is the one addition,
  // because with every dependency packed here nothing needs the registry and a run that silently
  // reached for one would be a test of the network; `--ignore-scripts` is already in there (D47, D73).
  run(
    process.execPath,
    [
      ...engineInstallArgv({
        npmCli: findNpmCli(),
        prefix: engine,
        specs: [...ENGINE_PACKAGES.map(pack), ...packThirdParty()],
      }),
      "--offline",
      "--no-package-lock",
    ],
    work,
  );

  // npm's own script under this Node, as the engine's install above, since a runner's npm is a
  // `.cmd` shim that spawning `npm` misses on Windows.
  run(
    process.execPath,
    [
      findNpmCli(),
      "install",
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      pack(WRAPPER_PACKAGE),
    ],
    work,
  );
  modules = join(prefix, "node_modules");
}, 300_000);

/**
 * The `rigline` command npm wrote from our `bin`, and how to run it.
 *
 * A local install rather than `--global`, and the difference is only where the shims land: both go
 * through npm's `bin-links`, so the three declarations that have to hold for a command to exist are
 * the same either way. `--global` costs about seven seconds of fixed overhead on Windows for 0.5s
 * of work, which buys a test of npm's own prefix layout — npm's business, not ours.
 *
 * On Windows npm writes three shims of which the extensionless one is a POSIX script, so the `.cmd`
 * is the one to run, and running it needs a shell because `child_process.spawn` of a `.cmd` without
 * one throws `EINVAL` since the 2024 CVE fix. Hence the platform branch, which is about how to
 * start a process rather than about what is being tested.
 */
function riglineCommand(): { readonly path: string; readonly run: (args: string[]) => string } {
  const windows = process.platform === "win32";
  const bin = join(modules, ".bin");
  const path = join(bin, windows ? "rigline.cmd" : "rigline");
  return {
    path,
    run: (args) =>
      windows
        ? execFileSync(process.env.COMSPEC ?? "cmd.exe", ["/d", "/s", "/c", path, ...args], {
            encoding: "utf8",
            stdio: "pipe",
            env: { ...process.env, RIGLINE_HOME: home },
          })
        : execFileSync(path, args, {
            encoding: "utf8",
            stdio: "pipe",
            env: { ...process.env, RIGLINE_HOME: home },
          }),
  };
}

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("the published tarballs, installed and run", () => {
  it("puts a startable engine in the home prefix, through the wrapper's own npm argv", () => {
    // The engine is located the way the wrapper locates it: `bin["rigline-engine"]` in the installed
    // manifest, never a hard-coded `dist/index.js`. An engine that installs and cannot be started is
    // the exact shape of every @rigline/core published before this milestone.
    const state = readEngineState(engineDir(home));
    expect(state.kind).toBe("ready");
  });

  it("forwards install to that engine and bakes the four first-party plugins", () => {
    const ext = writeFixtureExtension(join(work, "ext"));
    const cli = join(modules, "rigline", "dist", "index.js");
    expect(existsSync(cli)).toBe(true);

    // The exit code is deliberately not asserted, and this is the one place that reads as a gap and
    // is not. A synthetic bundle carries none of the curated anchors, so every plugin's declaration
    // check fails against it and `install` exits 1 to say a person is needed — which is D27 working:
    // a refused plugin is still copied, still baked, and never blocks the injection. What this tier
    // is asking is whether the published artefact can do its job at all, and every line below is
    // work that only happened because it could.
    const { stdout: out } = attempt(process.execPath, [cli, "install", "--ext", ext], work, {
      RIGLINE_HOME: home,
    });

    const payload = join(ext, ...PAYLOAD);
    for (const file of ["pre.js", "post.js", "generated.js", "registry.js"]) {
      expect(existsSync(join(payload, file))).toBe(true);
    }

    const registry = readFileSync(join(payload, "registry.js"), "utf8");
    for (const name of ["session-id", "time-marks", "worktree", "probe"]) {
      expect(registry).toContain(`"name":"${name}"`);
      // The plugin's own files, copied at its manifest's `entry`, which is what the baked entry
      // points at: a registry naming a module that is not there loads nothing and says nothing.
      expect(existsSync(join(payload, "plugins", name, "dist", "index.js"))).toBe(true);
    }
    expect(out).toContain("injected");

    // The bundled set is the last root, so nothing shadows it and nothing is reported as shadowed:
    // a published install finding each name once is the arrangement this whole phase is about.
    expect(out).not.toContain("is shadowed by");

    // Nothing of the wrapper's is in what the user reads. A forwarded verb is the engine's output
    // and only the engine's, which is what "the wrapper adds nothing to stdout" means (D69).
    expect(out).not.toContain("rigline: installing the engine");
  });

  it("is runnable by name, which is the first thing a person touches", () => {
    // An install that writes no `rigline` command is the failure this covers, and nothing else here
    // would see it: every other assertion runs `dist/index.js` by path, which works whether or not
    // the package is installable by name. Three declarations have to hold together for a shim to
    // appear — `bin` in the manifest, the entry inside `files`, and the shebang surviving
    // `removeComments` in the build config — and only this asks all three at once.
    const rigline = riglineCommand();
    expect(existsSync(rigline.path)).toBe(true);
    expect(rigline.run(["--help"])).toContain("rigline install");
  });

  it("answers --version itself, naming both packages and reaching nothing", () => {
    // The one verb the wrapper does not forward (D69), and the reason is diagnostic: it is what
    // somebody runs when something is already wrong, so it must work with no engine and no network.
    const cli = join(modules, "rigline", "dist", "index.js");
    const empty = join(work, "no-home");
    const bare = execFileSync(process.execPath, [cli, "--version"], {
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, RIGLINE_HOME: empty },
    });
    expect(bare).toContain("rigline ");
    expect(bare).toContain("the next command installs one");
    expect(existsSync(join(empty, "engine", "node_modules"))).toBe(false);

    const withEngine = riglineCommand().run(["--version"]);
    expect(withEngine).toContain("@rigline/core ");
  });

  it("prints its usage without a bundler installed, which the packed tarballs have not got", () => {
    // Rolldown is a devDependency, so it is in neither prefix. Before it was lazily imported it was
    // pulled in from the head of the module graph and every command threw ERR_MODULE_NOT_FOUND
    // before reading its own arguments. `rigline build` failing in a user's engine is correct and is
    // not this: a build happens in a workspace, never against an installed engine.
    expect(existsSync(join(modules, "rolldown"))).toBe(false);
    expect(existsSync(join(engineDir(home), "node_modules", "rolldown"))).toBe(false);

    const cli = join(modules, "rigline", "dist", "index.js");
    const out = execFileSync(process.execPath, [cli, "--help"], {
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, RIGLINE_HOME: home },
    });
    expect(out).toContain("rigline install");
  });
});

/** Long enough ago that the release-age gate passes on any clock this runs under (D48). */
const PUBLISHED = "2020-01-01T00:00:00.000Z";

/**
 * A registry in this process: the engine at the version installed above, so `update` finds it
 * current, and one plugin whose `latest` a test moves.
 */
interface Registry {
  readonly url: string;
  latest: string;
  /** Every path asked for, so a run that reached another registry fails rather than passing. */
  readonly asked: string[];
  close(): Promise<void>;
}

async function serveRegistry(engine: string): Promise<Registry> {
  const tarballs = new Map(
    ["1.0.0", "1.1.0"].map((version) => [
      version,
      packageTarball({
        "rigline.json": JSON.stringify({ api: 1, name: "clock", entry: "dist/index.js", uses: {} }),
        "dist/index.js": `export default { setup() {} }; // ${version}`,
      }),
    ]),
  );
  const state = { latest: "1.0.0" };
  const asked: string[] = [];
  let url = "";
  const packument = (name: string, tags: Record<string, string>, versions: string[]) => ({
    name,
    "dist-tags": tags,
    time: Object.fromEntries(versions.map((v) => [v, PUBLISHED])),
    versions: Object.fromEntries(
      versions.map((v) => {
        const bytes = tarballs.get(v);
        const integrity = `sha512-${createHash("sha512")
          .update(bytes ?? "")
          .digest("base64")}`;
        return [v, { dist: { tarball: `${url}/${name}/-/${v}.tgz`, integrity } }];
      }),
    ),
  });

  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent(request.url ?? "");
    asked.push(path);
    const body =
      path === "/@rigline/core"
        ? packument("@rigline/core", { latest: engine }, [engine])
        : path === "/clock"
          ? packument("clock", { latest: state.latest }, [...tarballs.keys()])
          : (tarballs.get(/^\/clock\/-\/(.+)\.tgz$/.exec(path)?.[1] ?? "") ?? null);
    if (body === null) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200).end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    asked,
    get latest() {
      return state.latest;
    },
    set latest(version: string) {
      state.latest = version;
    },
    close: () => new Promise((done) => server.close(() => done())),
  };
}

/**
 * The environment for a run that re-injects with no `--ext`, as `add` and `update` do: a home with
 * no extensions in it, and a `PATH` with no editor on it, so nothing reaches the live extension or
 * an editor's profiles (D39). Asynchronous, because the registry answering it is in this process.
 *
 * Every `npm_` variable goes, matched without case: under `pnpm test` the environment carries
 * `NPM_CONFIG_REGISTRY`, which Windows reads as the same name as ours and may prefer.
 */
function sandboxed(registry: string): NodeJS.ProcessEnv {
  const user = join(work, "user");
  mkdirSync(user, { recursive: true });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(path|vscode_.*|npm_.*)$/i.test(key)),
  );
  return {
    ...env,
    PATH: dirname(process.execPath),
    HOME: user,
    USERPROFILE: user,
    APPDATA: join(user, "AppData", "Roaming"),
    XDG_CONFIG_HOME: join(user, ".config"),
    RIGLINE_HOME: home,
    npm_config_registry: registry,
  };
}

function riglineIn(
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const cli = join(modules, "rigline", "dist", "index.js");
  return new Promise((done) => {
    execFile(process.execPath, [cli, ...args], { env, encoding: "utf8" }, (error, stdout, stderr) =>
      done({ code: error === null ? 0 : Number(error.code ?? 1), stdout, stderr }),
    );
  });
}

function recorded(name: string): Record<string, unknown> | undefined {
  const sources = JSON.parse(readFileSync(join(home, "sources.json"), "utf8")) as Record<
    string,
    Record<string, unknown>
  >;
  return sources[name];
}

describe("plugins from npm, through the packed wrapper and engine", () => {
  let registry: Registry;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    const engine = readEngineState(engineDir(home));
    if (engine.kind !== "ready") throw new Error("the packed engine is not installed");
    registry = await serveRegistry(engine.version);
    env = sandboxed(registry.url);
  });

  afterAll(async () => {
    await registry?.close();
  });

  it("forwards add, and the engine fetches, checks and places the plugin", async () => {
    const run = await riglineIn(env, ["add", "clock"]);

    expect(registry.asked).toEqual(["/clock", "/clock/-/1.0.0.tgz"]);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("added clock");
    expect(run.stdout).toContain("from clock@1.0.0 on npm, following latest");
    // The sandbox held: the re-inject found no extension, rather than the one on this machine.
    expect(run.stdout).toContain("No Claude Code extension is installed");
    expect(recorded("clock")).toMatchObject({ kind: "npm", version: "1.0.0", tag: "latest" });
  });

  it("moves the engine, then hands update to it, which moves the plugin", async () => {
    registry.latest = "1.1.0";
    registry.asked.length = 0;
    const run = await riglineIn(env, ["update"]);

    expect(registry.asked).toEqual(["/@rigline/core", "/clock", "/clock/-/1.1.0.tgz"]);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    const lines = run.stdout.split(/\r?\n/);
    expect(lines[0]).toMatch(/^engine: .+, which is what its tag resolves to$/);
    expect(lines).toContain("clock: 1.0.0 -> 1.1.0");
    expect(run.stdout).toContain("No Claude Code extension is installed");
    expect(recorded("clock")).toMatchObject({ version: "1.1.0", tag: "latest" });
  });
});
