/**
 * Gathering what a webview cannot see: install state per version, and the lines in VS Code's own
 * logs that bear on a panel that misbehaved (D53).
 *
 * Two rules shape everything below, and both are about what is *not* here.
 *
 * The first is that this module is the only place that opens a log file, and every open goes
 * through one `Ledger`. A path that is never offered to `ledger.open` can never reach the report,
 * which is the whole mechanism: D53 asks for redaction to be a property of what the collector reads
 * rather than a filter applied afterwards, because a filter is a thing that can be forgotten. So
 * `Anthropic.claude-code/Claude VSCode.log` — megabytes of prompts, tool commands, file paths and
 * session ids — is passed to `ledger.refuse`, which stats it and never opens it, and the same for
 * every other per-extension output channel and every `output_logging_*` tree. The ledger is also
 * what makes the claim auditable: the report ends with every file read and every file refused, so
 * the person pasting it into an issue can see what is in it without being able to read our code.
 *
 * The second is scope. This is not a health check for VS Code. The test for including a source is
 * whether it can speak to a panel that misbehaved, so `main.log`, a window's `renderer.log` and its
 * `exthost.log` are in, and settings, extension inventories, GPU information, telemetry and
 * performance marks are out — recorded as refused, with that as the reason, rather than silently
 * passed over, so that "we did not look" is distinguishable from "there was nothing there".
 *
 * Nothing here throws for a condition a machine can be in. A user whose panel just froze runs this
 * once; a collector that aborts on an unreadable directory is one that never reaches the logs.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { UserError } from "../errors.ts";
import { installedExtensions } from "../extension/locate.ts";
import { CORE_VERSION } from "../version.ts";
import { type FileFact, fileFact, type InstallState, installStates } from "./install.ts";
import {
  type ErrorSummary,
  errorSummary,
  hostStarts,
  type MainLog,
  parseEntries,
  parseMainLog,
} from "./logs.ts";

/** A launch directory: one per app start, named for the moment it started. */
const LAUNCH_DIR = /^\d{8}T\d{6}$/;
const WINDOW_DIR = /^window(\d{1,6})$/;
/** `exthost/output_logging_20260914T121833`: captured output channels, never opened. */
const OUTPUT_LOGGING_DIR = /^output_logging_/;
/** A window's own captured output channels, one directory per launch of that window. */
const WINDOW_OUTPUT_DIR = /^output_\d{8}T\d{6}$/;
/** `publisher.extension`, the shape of a per-extension output channel directory. */
const EXTENSION_CHANNEL_DIR = /^[^.]{1,100}\.[^.]{1,100}$/;
/**
 * The Claude Code extension's own output channel directory, named because its size and age are the
 * one thing about an unopened channel worth putting in front of a reader: a window with megabytes
 * there is a window that was working hard, which is context for a lockup in it. Every other
 * extension's channel is refused just the same and reported only in the appendix.
 */
const CLAUDE_CHANNEL_DIR = "anthropic.claude-code";

/**
 * The largest log this will read into memory. Not a privacy rule — the privacy rule is which paths
 * are offered to the ledger at all — but a log that has run away is evidence of its own, and it is
 * better reported as a size than turned into a report nobody can paste.
 */
export const MAX_LOG_BYTES = 16 * 1024 * 1024;

const WHY_EXTENSION_CHANNEL =
  "per-extension output channel: prompts, tool commands, file paths and session ids (D53)";
const WHY_OUTPUT_LOGGING =
  "captured output channels: the same content as the per-extension logs (D53)";
const WHY_OUT_OF_SCOPE = "cannot speak to a misbehaving panel; doctor is not a health check (D53)";
const WHY_TELEMETRY = "telemetry, which is neither ours to collect nor evidence about the panel";

/**
 * How much of each window log to report, and why the two are not the same.
 *
 * A renderer stack is ten frames of minified `workbench.desktop.main.js`, which names nothing a
 * reader can act on; the message is the evidence. An extension host stack is the opposite — the
 * frames are what name the extension that threw, which is the whole reason for reading that file —
 * so it keeps its depth. With ten windows open, this asymmetry is the difference between a
 * diagnostic somebody pastes into an issue and one they skim past.
 */
const RENDERER_ERRORS = { maxGroups: 8, maxDetail: 4 } as const;
const EXTHOST_ERRORS = { maxGroups: 8, maxDetail: 10 } as const;

/** One file this report opened. */
export interface ReadRecord extends FileFact {
  readonly what: string;
}

/** One file or directory this report found and deliberately did not open. */
export interface SkipRecord extends FileFact {
  /** Files inside, when the record stands for a whole directory; null for a single file. */
  readonly files: number | null;
  readonly why: string;
}

/**
 * The only door onto a log file, and the record of every time it was opened or refused.
 *
 * Reading and recording are the same call on purpose. The alternative — read here, remember to list
 * it there — puts the report's honesty in the hands of whoever edits the walk next.
 */
class Ledger {
  readonly reads: ReadRecord[] = [];
  readonly skips: SkipRecord[] = [];

  /** Reads a file as text and records it. Null when it is absent, unreadable or over the ceiling. */
  open(path: string, what: string): string | null {
    const fact = fileFact(path);
    if (fact === null) return null;
    if (fact.size > MAX_LOG_BYTES) {
      this.skips.push({
        ...fact,
        files: null,
        why: `larger than the ${Math.round(MAX_LOG_BYTES / (1024 * 1024))} MB ceiling this collector reads`,
      });
      return null;
    }
    try {
      const text = readFileSync(path, "utf8");
      this.reads.push({ ...fact, what });
      return text;
    } catch (error) {
      this.skips.push({
        ...fact,
        files: null,
        why: `unreadable: ${error instanceof Error ? error.message : String(error)}`,
      });
      return null;
    }
  }

  /** Records a file's existence, size and age without opening it. */
  refuse(path: string, why: string): SkipRecord | null {
    const fact = fileFact(path);
    if (fact === null) return null;
    const record: SkipRecord = { ...fact, files: null, why };
    this.skips.push(record);
    return record;
  }

  /**
   * Records a whole directory without opening anything in it: how many files, how much, and when
   * it last changed. One record rather than one per file, because a tree refused wholesale is one
   * decision, and an appendix of nine hundred filenames is not more auditable than a count.
   */
  refuseTree(dir: string, why: string): SkipRecord | null {
    const fact = fileFact(dir);
    if (fact === null) return null;
    let files = 0;
    let size = 0;
    let modifiedMs = fact.modifiedMs;
    const walk = (at: string): void => {
      for (const entry of list(at)) {
        const path = join(at, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        const inner = fileFact(path);
        if (!inner) continue;
        files++;
        size += inner.size;
        modifiedMs = Math.max(modifiedMs, inner.modifiedMs);
      }
    };
    walk(dir);
    const record: SkipRecord = { path: dir, size, modifiedMs, files, why };
    this.skips.push(record);
    return record;
  }
}

function list(dir: string): { name: string; isDirectory: () => boolean }[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export interface LogRoot {
  /** `Code` or `Code - Insiders`: which build's logs these are. */
  readonly label: string;
  readonly path: string;
}

/**
 * Where VS Code keeps its logs, per platform, stable and Insiders alike.
 *
 * `%APPDATA%` is honoured over a path built from the home directory because a roaming profile can
 * put it somewhere else entirely, and a doctor that looked in the wrong place would report "no
 * logs" to the one user whose logs matter most.
 */
export function logRootCandidates(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): LogRoot[] {
  const builds = ["Code", "Code - Insiders"];
  if (platform === "win32") {
    const roaming =
      env.APPDATA && env.APPDATA.length > 0 ? env.APPDATA : join(home, "AppData", "Roaming");
    return builds.map((label) => ({ label, path: join(roaming, label, "logs") }));
  }
  if (platform === "darwin") {
    return builds.map((label) => ({
      label,
      path: join(home, "Library", "Application Support", label, "logs"),
    }));
  }
  return builds.map((label) => ({ label, path: join(home, ".config", label, "logs") }));
}

/**
 * `24h`, `7d`, `90m`, or `all`. Returns milliseconds, or null for "every launch directory".
 *
 * Deliberately small: a diagnostic's time window is a thing a person types once while something is
 * broken, and a syntax that needs the documentation open is a worse failure than a coarse unit.
 */
export function parseSince(text: string): number | null {
  if (text === "all") return null;
  const match = /^(\d{1,6})([mhd])$/.exec(text.trim());
  if (!match) {
    throw new UserError(`--since wants a duration like 24h, 7d, 90m, or "all"; got "${text}"`);
  }
  const n = Number(match[1]);
  const unit = match[2];
  const scale = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * scale;
}

export interface WindowReport {
  readonly name: string;
  readonly path: string;
  readonly renderer: ErrorSummary | null;
  readonly exthost: ErrorSummary | null;
  /** `Started local extension host with pid N`: the only link from a pid in `main.log` to a window. */
  readonly hostStarts: readonly { readonly at: string; readonly pid: number }[];
  /** The per-extension channel logs found here, recorded but never opened. */
  readonly unopened: readonly SkipRecord[];
}

export interface LaunchReport {
  readonly name: string;
  readonly path: string;
  /** The newest write anywhere this collector looked inside the launch. See `launchActivityMs`. */
  readonly activeMs: number;
  readonly main: MainLog | null;
  readonly windows: readonly WindowReport[];
}

export interface LogRootReport extends LogRoot {
  readonly exists: boolean;
  readonly launches: readonly LaunchReport[];
  /**
   * Launch directories not read: empty, or outside the time window. Counted so their absence from
   * the report reads as a decision rather than as "there were none".
   */
  readonly excluded: number;
}

export interface DoctorReport {
  readonly generatedAtMs: number;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly nodeVersion: string;
  readonly riglineVersion: string;
  readonly sinceMs: number | null;
  readonly installs: readonly InstallState[];
  /** Problems with the collection itself, not with anything it found. */
  readonly problems: readonly string[];
  readonly roots: readonly LogRootReport[];
  readonly reads: readonly ReadRecord[];
  readonly skips: readonly SkipRecord[];
}

export interface DoctorOptions {
  /** Extension directories to inspect. Defaults to every one installed for this user. */
  readonly exts?: readonly string[];
  /** Log roots to walk. Defaults to this platform's; override to read a copied log tree. */
  readonly logRoots?: readonly LogRoot[];
  /** How far back to look. Null reads every launch directory. Defaults to 24 hours. */
  readonly sinceMs?: number | null;
  readonly now?: number;
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export const DEFAULT_SINCE_MS = 24 * 3_600_000;

/**
 * When a launch directory was last written to, judged from the files this collector would read.
 *
 * The directory's own mtime is not enough and is the trap that makes the obvious default wrong: VS
 * Code creates a launch directory for every start, including the ones that hand off to a window
 * that is already open, so the newest directory by name is routinely empty while the launch that is
 * actually running is days older. Appending to `main.log` does not touch the directory's mtime
 * either. So the answer is the newest of the directory, `main.log`, each window directory, and each
 * window's `renderer.log` and `exthost.log` — a few stats, and the only reading of "recent" that
 * survives a machine left running for a week.
 */
export function launchActivityMs(dir: string): number {
  let newest = fileFact(dir)?.modifiedMs ?? 0;
  const bump = (path: string): void => {
    const fact = fileFact(path);
    if (fact) newest = Math.max(newest, fact.modifiedMs);
  };
  bump(join(dir, "main.log"));
  for (const entry of list(dir)) {
    if (!entry.isDirectory() || !WINDOW_DIR.test(entry.name)) continue;
    const window = join(dir, entry.name);
    bump(window);
    bump(join(window, "renderer.log"));
    bump(join(window, "exthost", "exthost.log"));
  }
  return newest;
}

function windowNumber(name: string): number {
  return Number(WINDOW_DIR.exec(name)?.[1] ?? 0);
}

/** A launch directory as the scan found it, before the time window has had its say. */
export interface LaunchCandidate {
  readonly name: string;
  readonly path: string;
  readonly activeMs: number;
  /** False for a directory VS Code created and never wrote to. See `selectLaunches`. */
  readonly hasContent: boolean;
}

/**
 * The launch directories to read: every one with content written inside the window, or — when
 * nothing falls inside it — the most recently written one that has content.
 *
 * Empty directories are dropped outright, and that is the whole difficulty. VS Code creates a
 * launch directory for every start, including the ones that hand off to a window already open, so a
 * day of ordinary work leaves half a dozen empty directories dated after the launch that is
 * actually running. Taking "the newest" literally reads the wrong one; keeping them all fills the
 * report with sections that say nothing.
 *
 * The fallback past the window is not a nicety either. Somebody whose panel froze yesterday, or who
 * left the machine off over a weekend, is exactly the person filing the report, and a window that
 * excluded their only log would produce a document that says nothing while looking complete.
 */
export function selectLaunches(
  launches: readonly LaunchCandidate[],
  sinceMs: number | null,
  now: number,
): LaunchCandidate[] {
  const newestFirst = launches
    .filter((launch) => launch.hasContent)
    .sort((a, b) => b.activeMs - a.activeMs || (a.name < b.name ? 1 : -1));
  if (sinceMs === null) return newestFirst;
  const chosen = newestFirst.filter((launch) => launch.activeMs >= now - sinceMs);
  return chosen.length > 0 ? chosen : newestFirst.slice(0, 1);
}

function readWindow(
  ledger: Ledger,
  dir: string,
  name: string,
  fromMs: number | null,
): WindowReport {
  const renderer = ledger.open(join(dir, "renderer.log"), `${name} renderer log`);
  const exthostDir = join(dir, "exthost");
  const exthost = ledger.open(join(exthostDir, "exthost.log"), `${name} extension host log`);
  const rendererEntries = renderer === null ? [] : parseEntries(renderer);
  const unopened: SkipRecord[] = [];

  for (const entry of list(dir)) {
    if (entry.name === "renderer.log") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "exthost") continue;
      if (WINDOW_OUTPUT_DIR.test(entry.name)) ledger.refuseTree(path, WHY_OUTPUT_LOGGING);
      else ledger.refuseTree(path, WHY_OUT_OF_SCOPE);
      continue;
    }
    ledger.refuse(path, WHY_OUT_OF_SCOPE);
  }

  for (const entry of list(exthostDir)) {
    if (entry.name === "exthost.log") continue;
    const path = join(exthostDir, entry.name);
    if (!entry.isDirectory()) {
      ledger.refuse(path, entry.name === "extHostTelemetry.log" ? WHY_TELEMETRY : WHY_OUT_OF_SCOPE);
      continue;
    }
    if (OUTPUT_LOGGING_DIR.test(entry.name)) {
      ledger.refuseTree(path, WHY_OUTPUT_LOGGING);
      continue;
    }
    const record = ledger.refuseTree(
      path,
      EXTENSION_CHANNEL_DIR.test(entry.name) ? WHY_EXTENSION_CHANNEL : WHY_OUT_OF_SCOPE,
    );
    // Surfaced in the window's own section as well as in the appendix, and only this one: saying
    // beside the window that our extension's own log is there and how big it grew makes "we did not
    // open it" a visible claim rather than a footnote. Ten other extensions' channels repeated per
    // window would bury it, and the appendix already has them all.
    if (record && entry.name.toLowerCase() === CLAUDE_CHANNEL_DIR) unopened.push(record);
  }

  return {
    name,
    path: dir,
    renderer:
      renderer === null ? null : errorSummary(rendererEntries, { ...RENDERER_ERRORS, fromMs }),
    exthost:
      exthost === null ? null : errorSummary(parseEntries(exthost), { ...EXTHOST_ERRORS, fromMs }),
    hostStarts: hostStarts(rendererEntries),
    unopened,
  };
}

function readLaunch(
  ledger: Ledger,
  path: string,
  name: string,
  activeMs: number,
  fromMs: number | null,
): LaunchReport {
  const main = ledger.open(join(path, "main.log"), "main process log");
  const windows = list(path)
    .filter((entry) => entry.isDirectory() && WINDOW_DIR.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => windowNumber(a) - windowNumber(b))
    .map((window) => readWindow(ledger, join(path, window), window, fromMs));

  for (const entry of list(path)) {
    if (entry.name === "main.log") continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      if (!WINDOW_DIR.test(entry.name)) ledger.refuseTree(child, WHY_OUT_OF_SCOPE);
      continue;
    }
    ledger.refuse(child, WHY_OUT_OF_SCOPE);
  }

  return { name, path, activeMs, main: main === null ? null : parseMainLog(main), windows };
}

/**
 * Everything `rigline doctor` knows, gathered once.
 *
 * The install half runs first and independently of the log half, because it is the half that always
 * works: a machine with no VS Code logs at all — a fresh profile, a cleared log directory, a
 * platform whose paths have moved — must still produce a report that says which version is
 * installed and whether it is patched. Missing logs are an absence this reports, never a failure.
 */
export function collect(options: DoctorOptions = {}): DoctorReport {
  const now = options.now ?? Date.now();
  const sinceMs = options.sinceMs === undefined ? DEFAULT_SINCE_MS : options.sinceMs;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const problems: string[] = [];

  let exts: readonly string[] = options.exts ?? [];
  if (!options.exts) {
    try {
      exts = installedExtensions();
    } catch (error) {
      problems.push(
        `could not list installed extensions: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const installs = installStates(exts);
  if (installs.length === 0) problems.push("no Claude Code extension directory was found");

  // One window, two jobs: which launch directories to read, and how far back inside them to report
  // errors. `--since` would mean two different things otherwise, and the second is what keeps a
  // week-old `renderer.log` from burying the hour somebody is asking about.
  const fromMs = sinceMs === null ? null : now - sinceMs;
  const ledger = new Ledger();
  const roots: LogRootReport[] = [];
  for (const root of options.logRoots ?? logRootCandidates(platform, home, options.env)) {
    if (!existsSync(root.path)) {
      roots.push({ ...root, exists: false, launches: [], excluded: 0 });
      continue;
    }
    const found = list(root.path)
      .filter((entry) => entry.isDirectory() && LAUNCH_DIR.test(entry.name))
      .map((entry) => {
        const path = join(root.path, entry.name);
        return {
          name: entry.name,
          path,
          activeMs: launchActivityMs(path),
          hasContent: list(path).length > 0,
        };
      });
    const selected = selectLaunches(found, sinceMs, now);
    roots.push({
      ...root,
      exists: true,
      launches: selected.map((launch) =>
        readLaunch(ledger, launch.path, launch.name, launch.activeMs, fromMs),
      ),
      excluded: found.length - selected.length,
    });
  }

  return {
    generatedAtMs: now,
    platform,
    home,
    nodeVersion: process.version,
    riglineVersion: CORE_VERSION,
    sinceMs,
    installs,
    problems,
    roots,
    reads: ledger.reads,
    skips: ledger.skips,
  };
}

/**
 * The refusal reasons, by name, so a test can assert that a path was refused *for the right
 * reason* rather than merely absent from the reads. A skip recorded with the wrong reason is the
 * failure mode this whole design exists to prevent, and it is invisible to a test that only counts.
 */
export const SKIP_REASONS = {
  extensionChannel: WHY_EXTENSION_CHANNEL,
  outputLogging: WHY_OUTPUT_LOGGING,
  outOfScope: WHY_OUT_OF_SCOPE,
  telemetry: WHY_TELEMETRY,
} as const;
