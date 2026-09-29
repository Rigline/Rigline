/**
 * Finding, installing and running the engine (decisions.md, D69, D73).
 *
 * `@rigline/core` is installed with npm into `<RIGLINE_HOME>/engine` and spawned from there. That is
 * the only engine: no bundled copy, no precedence rule, no way for the engine you ran to differ from
 * the one you installed. Everything below is either about locating it or about starting a process,
 * and none of it opens a plugin manifest or reads the engine's files under `~/.rigline` (D70).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UserError } from "./errors.ts";
import { belowFloor } from "./floor.ts";
import { type LockOptions, withHomeLock } from "./lock.ts";
import { type RegistryOptions, releaseAgeProblem, resolveVersion } from "./registry.ts";

// For the companion, which reaches the wrapper only through this module (D80).
export { belowFloor } from "./floor.ts";

export const ENGINE_PACKAGE = "@rigline/core";
export const ENGINE_BIN = "rigline-engine";

/**
 * `$RIGLINE_HOME`, else `~/.rigline` — core's `riglineHome()`, reimplemented.
 *
 * The wrapper depends on no Rigline package (D69), so this rule lives in two files and a test holds
 * them together. Two lines against a dependency that would undo the split.
 */
export function riglineHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.RIGLINE_HOME;
  return override && override.length > 0 ? override : join(homedir(), ".rigline");
}

/** The npm prefix the engine is installed into. `rm -rf` on it is the documented recovery (D73). */
export function engineDir(home: string = riglineHome()): string {
  return join(home, "engine");
}

/** This wrapper's version, from its own manifest: a second constant would be a second thing to bump. */
export function wrapperVersion(): string {
  const manifest = fileURLToPath(new URL("../package.json", import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string") throw new Error(`${manifest} has no version`);
  return version;
}

/** The leading integer of a version, or null for anything that is not one. */
export function majorOf(version: string): number | null {
  const match = /^(\d+)\./.exec(version);
  return match === null ? null : Number(match[1]);
}

/** What the engine at a prefix is, as far as running it goes. */
export type EngineState =
  | { readonly kind: "none" }
  /** Installed, but this wrapper cannot start it: no `rigline-engine` bin, or its entry is gone. */
  | { readonly kind: "unusable"; readonly version: string; readonly why: string }
  | { readonly kind: "ready"; readonly version: string; readonly entry: string };

/** Read the installed engine's manifest. The entry comes from `bin`, never from a hard-coded path. */
export function readEngineState(prefix: string): EngineState {
  const dir = join(prefix, "node_modules", ENGINE_PACKAGE);
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) return { kind: "none" };

  let parsed: { version?: unknown; bin?: unknown };
  try {
    parsed = JSON.parse(readFileSync(manifest, "utf8")) as typeof parsed;
  } catch {
    return { kind: "unusable", version: "unreadable", why: `${manifest} is not readable JSON` };
  }
  const version = typeof parsed.version === "string" ? parsed.version : "unreadable";
  const bin = parsed.bin;
  const named =
    typeof bin === "object" && bin !== null
      ? (bin as Record<string, unknown>)[ENGINE_BIN]
      : undefined;
  if (typeof named !== "string") {
    return { kind: "unusable", version, why: `it has no ${ENGINE_BIN} command` };
  }
  const entry = resolve(dir, named);
  if (!existsSync(entry)) {
    return { kind: "unusable", version, why: `its ${ENGINE_BIN} entry ${entry} is missing` };
  }
  return { kind: "ready", version, entry };
}

/**
 * Why this wrapper cannot run that engine, or null. Majors move together (D73).
 *
 * A comparison of majors and nothing more: there is no semver ordering anywhere here, and this is
 * not the ordering D58 refuses.
 */
export function majorProblem(wrapper: string, engine: string): string | null {
  const ours = majorOf(wrapper);
  const theirs = majorOf(engine);
  if (ours === null || theirs === null || ours === theirs) return null;
  // Both steps, as stability.md promises, and the second only for somebody who uses the companion,
  // since declining it must cost nothing (D80).
  return (
    `rigline ${ours}.x cannot run engine ${theirs}.x (${ENGINE_PACKAGE} ${engine}). ` +
    "Run npm i -g rigline@latest, then rigline vscode-setup if you use the companion."
  );
}

/**
 * Semver precedence, prerelease included, or null for a version it cannot read. It says whether a
 * newer wrapper exists and never which version to install, so it is not the ordering D58 refuses.
 */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (x === null || y === null) return null;
  for (let i = 0; i < 3; i++) {
    const diff = (x.release[i] as number) - (y.release[i] as number);
    if (diff !== 0) return diff;
  }
  // A release outranks every prerelease of it.
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pNumeric = /^\d+$/.test(p);
    const qNumeric = /^\d+$/.test(q);
    if (pNumeric && qNumeric) return Number(p) - Number(q);
    if (pNumeric !== qNumeric) return pNumeric ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

function parseVersion(version: string): { release: number[]; pre: string[] } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (match === null) return null;
  return {
    release: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split("."),
  };
}

/**
 * The line saying a newer wrapper is out, or null (D106). All four packages release at one version
 * (D60), so an installed engine ahead of this wrapper means a wrapper at its version exists.
 */
export function newerWrapper(wrapper: string, engine: string): string | null {
  const order = compareVersions(engine, wrapper);
  if (order === null || order <= 0) return null;
  return `rigline ${engine} is out, and this is ${wrapper}: npm i -g rigline@${engine}`;
}

/** The last engine whose `update` refuses rather than runs, so a hand-off to it says nothing useful. */
const LAST_WITHOUT_UPDATE = "1.0.0-alpha.12";

/**
 * Why `update` cannot hand off to this engine, or null (D106). Only an engine older than the wrapper
 * can lack it: a build between releases carries the last release's version, as tier 4's does.
 */
export function handOffProblem(wrapper: string, engine: string): string | null {
  const behind = compareVersions(engine, wrapper);
  const old = compareVersions(engine, LAST_WITHOUT_UPDATE);
  if (behind === null || old === null || behind >= 0 || old > 0) return null;
  return (
    `${ENGINE_PACKAGE} ${engine} does no update of its own, so no plugin was updated. ` +
    `Run rigline update again once the engine has moved past ${LAST_WITHOUT_UPDATE}.`
  );
}

/**
 * npm's own entry, beside the running Node.
 *
 * Never the shim on PATH: under corepack, volta or fnm that is not necessarily the npm beside this
 * Node (D73). Windows keeps it under the Node directory, POSIX under `../lib`, and Homebrew's `node`
 * in its keg's `libexec`, where `process.execPath` lands because macOS resolves the symlink.
 */
export function findNpmCli(
  execPath: string = process.execPath,
  exists: (path: string) => boolean = existsSync,
): string {
  const here = dirname(execPath);
  const npmIn = (...dir: string[]) =>
    join(here, ...dir, "node_modules", "npm", "bin", "npm-cli.js");
  const candidates = [npmIn(), npmIn("..", "lib"), npmIn("..", "libexec", "lib")];
  const found = candidates.find(exists);
  if (found === undefined) {
    throw new UserError(
      `no npm was found beside ${execPath}, so the engine cannot be installed. ` +
        `Run: npm install --prefix "${engineDir()}" --save-exact --ignore-scripts ${ENGINE_PACKAGE}@latest`,
    );
  }
  return found;
}

/**
 * What the wrapper hands `process.execPath` to install an engine.
 *
 * Exported so a test can run the real construction rather than a copy of it: tier 4 installs a
 * packed tarball through this, which is the only way the published artefact gets exercised without
 * a registry (D36).
 */
export function engineInstallArgv(options: {
  readonly npmCli: string;
  readonly prefix: string;
  /** One in practice; a list because tier 4 hands over the engine and its dependency as tarballs. */
  readonly specs: readonly string[];
}): string[] {
  return [
    options.npmCli,
    "install",
    "--prefix",
    options.prefix,
    // Without it npm writes a caret range into that manifest, and a bare `npm install` there
    // becomes a second mechanism deciding what is installed (D58, D73).
    "--save-exact",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--loglevel=error",
    ...options.specs,
  ];
}

/** How a child process gets started. Injected so no test here spawns npm or an engine. */
export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { readonly stdio: readonly ("inherit" | "ignore" | "pipe")[] },
) => ChildProcess;

/**
 * Node's own, narrowed to that shape. Hidden, because the companion runs this with no console, and
 * Windows opens a window for a console program started from there; in a terminal it changes nothing.
 */
const nodeSpawn: SpawnLike = (command, args, options) =>
  spawn(command, [...args], { stdio: [...options.stdio], windowsHide: true });

export interface EngineOptions {
  readonly home?: string;
  readonly registry?: RegistryOptions;
  /** The dist-tag the engine follows. `latest` unless a preview line is named (D73). */
  readonly tag?: string;
  readonly spawnImpl?: SpawnLike;
  /** This wrapper's version, for the major check. Read from its own manifest by default. */
  readonly version?: string;
  /**
   * The Node that runs npm and the engine, and the one `findNpmCli` pairs against (D73).
   *
   * Defaults to this process, which is right for the CLI and wrong for the companion extension:
   * there `process.execPath` is VS Code's Electron binary, with no npm beside it and no ability to
   * run the engine's entry (D80).
   */
  readonly nodePath?: string;
  /**
   * That Node's version, which a move is held to the engine's floor with (D116). This process's
   * where `nodePath` is unset too; a path given without it is not guessed at, and nothing is held.
   */
  readonly nodeVersion?: string;
  /** What this process calls itself in the home lock, for whoever is waiting on it (D80). */
  readonly label?: string;
  /** The lock's timings, for tests. Its `home` and `what` are this call's. */
  readonly lock?: Omit<LockOptions, "home" | "what">;
}

/** A located engine, and how the wrapper runs it. */
export interface Engine {
  readonly version: string;
  readonly entry: string;
  /** Run a verb with our stdio, and answer with the child's exit code. */
  run(argv: readonly string[]): Promise<number>;
}

/**
 * The engine, installing it first if there is not a usable one.
 *
 * A first run reaches the registry, seconds after the user ran `npm i -g rigline`, and that is the
 * stated cost of never bundling a copy (D73). An unusable engine is reinstalled rather than
 * reported, since that is the documented recovery performed for the user — but only when the
 * resolved version differs from the one already there, because reinstalling the same bytes would
 * produce the same refusal with an npm run in front of it.
 */
export async function ensureEngine(options: EngineOptions = {}): Promise<Engine> {
  const prefix = engineDir(options.home ?? riglineHome());
  const version = options.version ?? wrapperVersion();
  const state = readEngineState(prefix);

  if (state.kind === "ready") {
    const problem = majorProblem(version, state.version);
    if (problem !== null) throw new UserError(problem);
    return engineAt(state, options);
  }

  const resolved = await resolveEngine(options);
  if (state.kind === "unusable" && resolved.version === state.version) {
    throw new UserError(
      `the engine in ${prefix} is ${ENGINE_PACKAGE} ${state.version} and ${state.why}, ` +
        `and that is what ${ENGINE_PACKAGE}@${options.tag ?? "latest"} resolves to. ` +
        `Delete ${prefix} and try again, or install a version that has one.`,
    );
  }

  const problem = majorProblem(version, resolved.version);
  if (problem !== null) throw new UserError(problem);

  // On stderr, so the first `list --json` on a machine is still JSON.
  console.error(`rigline: installing the engine, ${ENGINE_PACKAGE} ${resolved.version}`);
  await installEngine(prefix, `${ENGINE_PACKAGE}@${resolved.version}`, options);

  const installed = readEngineState(prefix);
  if (installed.kind !== "ready") {
    throw new UserError(
      `${ENGINE_PACKAGE} ${resolved.version} was installed into ${prefix}, but ` +
        (installed.kind === "unusable" ? installed.why : "nothing is there"),
    );
  }
  return engineAt(installed, options);
}

/** What the tag resolves to now. The age gate is `update`'s, never a first run's (D48, D73). */
async function resolveEngine(options: EngineOptions) {
  return await resolveVersion(
    { name: ENGINE_PACKAGE, version: null, tag: options.tag ?? "latest" },
    options.registry,
  );
}

/**
 * Run npm. Its output is held back and printed only if it fails, where it is the whole diagnosis.
 *
 * Locked, and here rather than around a command, because this is the one act two processes must not
 * interleave (D80) and every verb can reach it — a first run installs an engine whatever was typed.
 * Injection is left outside deliberately: it is the slow half and it is idempotent.
 */
async function installEngine(prefix: string, spec: string, options: EngineOptions): Promise<void> {
  const home = options.home ?? riglineHome();
  await withHomeLock({ home, what: options.label ?? "rigline", ...options.lock }, async () => {
    mkdirSync(prefix, { recursive: true });
    const node = options.nodePath ?? process.execPath;
    const argv = engineInstallArgv({ npmCli: findNpmCli(node), prefix, specs: [spec] });
    const run = await capture(node, argv, options.spawnImpl);
    if (run.code !== 0) {
      throw new UserError(
        `installing ${spec} into ${prefix} failed (npm exited ${run.code}).\n${run.output.trim()}`,
      );
    }
  });
}

function engineAt(state: { version: string; entry: string }, options: EngineOptions): Engine {
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const node = options.nodePath ?? process.execPath;
  return {
    version: state.version,
    entry: state.entry,
    run: (argv) =>
      new Promise((done, fail) => {
        const child = spawnImpl(node, [state.entry, ...argv], {
          stdio: ["inherit", "inherit", "inherit"],
        });
        child.on("error", fail);
        child.on("close", (code) => done(code ?? 1));
      }),
  };
}

/** Run a command with its output collected. */
async function capture(
  command: string,
  argv: readonly string[],
  spawnImpl: SpawnLike = nodeSpawn,
): Promise<{ readonly code: number; readonly output: string }> {
  return await new Promise((done, fail) => {
    const child = spawnImpl(command, argv, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

/** What `update` did about the engine itself. */
export type EngineUpdate =
  /** No engine was installed, so this run is a first run and the age gate does not apply (D48). */
  | { readonly outcome: "installed"; readonly to: string }
  | { readonly outcome: "moved"; readonly from: string; readonly to: string }
  | { readonly outcome: "current"; readonly from: string }
  | {
      readonly outcome: "withheld";
      readonly from: string;
      readonly to: string;
      readonly reason: string;
      /** Too young, which waiting mends (D48), or above this Node's floor, which only a person can. */
      readonly by: "age" | "node";
    }
  | {
      readonly outcome: "failed";
      readonly from?: string;
      readonly to?: string;
      readonly reason: string;
    };

/**
 * Move the engine to whatever its tag resolves to, before any plugin is touched (D73).
 *
 * The engine first, so the new engine does the placing and the injection, and an engine that fails
 * to start leaves the previous injection untouched. A resolution that fails is reported and the run
 * carries on with the engine that is installed: a registry outage must not cost the plugin half its
 * update, or the re-injection.
 */
export async function updateEngine(options: EngineOptions = {}): Promise<EngineUpdate> {
  const prefix = engineDir(options.home ?? riglineHome());
  const state = readEngineState(prefix);
  const installed = state.kind === "none" ? null : state.version;

  let resolved: Awaited<ReturnType<typeof resolveEngine>>;
  try {
    resolved = await resolveEngine(options);
  } catch (error) {
    return {
      outcome: "failed",
      ...(installed === null ? {} : { from: installed }),
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (state.kind === "ready" && resolved.version === state.version) {
    return { outcome: "current", from: state.version };
  }

  const problem = majorProblem(options.version ?? wrapperVersion(), resolved.version);
  if (problem !== null) {
    // `to`, so a caller can tell a major it cannot follow from a failure it can retry (D99).
    return {
      outcome: "failed",
      ...(installed === null ? {} : { from: installed }),
      to: resolved.version,
      reason: problem,
    };
  }

  // The gates need something to stay on, so they do not apply where there is no engine (D48, D73,
  // D116). `ensureEngine` installs one regardless a moment later — a first run has to produce a
  // working command — so gating here would only have this run refuse and then contradict itself.
  if (installed !== null) {
    const node = nodeFloorProblem(resolved, options);
    if (node !== null) {
      return {
        outcome: "withheld",
        from: installed,
        to: resolved.version,
        reason: node,
        by: "node",
      };
    }
    const age = releaseAgeProblem(resolved, options.registry);
    if (age !== null) {
      return { outcome: "withheld", from: installed, to: resolved.version, reason: age, by: "age" };
    }
  }

  try {
    await installEngine(prefix, `${ENGINE_PACKAGE}@${resolved.version}`, options);
  } catch (error) {
    return {
      outcome: "failed",
      ...(installed === null ? {} : { from: installed }),
      to: resolved.version,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return installed === null
    ? { outcome: "installed", to: resolved.version }
    : { outcome: "moved", from: installed, to: resolved.version };
}

/** Why the Node that would run this engine is below its floor, or null (D116). */
function nodeFloorProblem(
  resolved: { readonly version: string; readonly enginesNode: string | null },
  options: EngineOptions,
): string | null {
  const running =
    options.nodeVersion ?? (options.nodePath === undefined ? process.versions.node : null);
  if (running === null || resolved.enginesNode === null) return null;
  const floor = belowFloor(running, resolved.enginesNode);
  if (floor === null) return null;
  return (
    `${ENGINE_PACKAGE} ${resolved.version} needs Node ${floor} or newer, and ` +
    `${options.nodePath ?? process.execPath} is Node ${running}. Install a newer Node to move to it.`
  );
}

/** One line about the engine, naming the version it came from so a rollback has its argument. */
export function formatEngineUpdate(update: EngineUpdate, home: string = riglineHome()): string {
  switch (update.outcome) {
    case "installed":
      return `engine: installed ${update.to}`;
    case "moved":
      return (
        `engine: ${update.from} -> ${update.to}\n` +
        `  to go back: npm install --prefix ${engineDir(home)} --save-exact ` +
        `${ENGINE_PACKAGE}@${update.from}`
      );
    case "current":
      return `engine: ${update.from}, which is what its tag resolves to`;
    case "withheld":
      return `engine: staying on ${update.from} — ${update.reason}`;
    default:
      return `engine: FAILED — ${update.reason}`;
  }
}
