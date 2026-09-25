/**
 * One engine injects at a time (D105).
 *
 * The stability sample (D83) cannot tell another engine's writes from VS Code's, so two engines
 * injecting together refuse each other as "still being written". These are the wrapper's home-lock
 * rules (`packages/cli/src/lock.ts`), copied because the wrapper does not depend on core, and
 * synchronous because `install` is.
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { UserError } from "../errors.ts";
import { sleepSync } from "../extension/bundles.ts";
import { riglinePaths } from "../paths.ts";

/** Who holds it, as written into the file. */
export interface LockHolder {
  readonly pid: number;
  /** ISO 8601, for a person deciding whether to delete the file. */
  readonly since: string;
  /** The command holding it, as a waiter prints it. */
  readonly what: string;
}

export interface InjectionLockOptions {
  /** Defaults to `<RIGLINE_HOME>/inject.lock`. */
  readonly path?: string;
  /** This holder's `what`. */
  readonly what?: string;
  readonly waitMs?: number;
  /** A lock at least this old whose process is gone is taken rather than waited for. */
  readonly staleMs?: number;
  readonly pollMs?: number;
  readonly now?: () => number;
  readonly isAlive?: (pid: number) => boolean;
  readonly sleep?: (ms: number) => void;
  /** Handed the sentence to print, once, when the lock is found held. */
  readonly onWait?: (line: string) => void;
}

/** Past the slowest run measured, six corpus versions from vanilla; the wait is twice it (D105). */
const STALE_MS = 15_000;
const WAIT_MS = 30_000;
const POLL_MS = 100;

/** Signal 0 checks existence on both platforms; `EPERM` is a process that is there but not ours. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readHolder(path: string): LockHolder | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { pid, since, what } = parsed as Partial<LockHolder>;
    if (typeof pid !== "number" || typeof since !== "string" || typeof what !== "string") {
      return null;
    }
    return { pid, since, what };
  } catch {
    return null;
  }
}

/** The lock file's modification time, or NaN once it has gone. */
function writtenAt(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return Number.NaN;
  }
}

/**
 * Whether a lock has stopped mattering: old, and its process gone. A lock nobody can read is judged
 * by the file's own age, since it is usually a holder between its create and its write.
 */
export function isStale(
  holder: LockHolder | null,
  fileTime: number,
  now: number,
  staleMs: number,
  isAlive: (pid: number) => boolean,
): boolean {
  const since = holder === null ? fileTime : Date.parse(holder.since);
  const old = Number.isNaN(since) || now - since >= staleMs;
  return old && (holder === null || !isAlive(holder.pid));
}

export class InjectionLockedError extends UserError {
  readonly holder: LockHolder | null;

  constructor(path: string, holder: LockHolder | null) {
    super(
      holder === null
        ? `another Rigline process is holding ${path}. Try again, or delete that file if nothing is.`
        : `${holder.what} (pid ${holder.pid}) has held ${path} since ${holder.since}. Try again ` +
            "when it has finished, or delete that file if it has not.",
    );
    this.holder = holder;
  }
}

/** Run `work` holding the injection lock, and release it whatever happens. */
export function withInjectionLock<T>(options: InjectionLockOptions, work: () => T): T {
  const {
    path = riglinePaths().injectLock,
    what = "rigline",
    waitMs = WAIT_MS,
    staleMs = STALE_MS,
    pollMs = POLL_MS,
    now = Date.now,
    isAlive = alive,
    sleep = sleepSync,
    onWait,
  } = options;

  mkdirSync(dirname(path), { recursive: true });
  const deadline = now() + waitMs;
  let told = false;

  for (;;) {
    const holder: LockHolder = { pid: process.pid, since: new Date(now()).toISOString(), what };
    try {
      const fd = openSync(path, "wx");
      try {
        writeFileSync(fd, JSON.stringify(holder, null, 2));
      } finally {
        closeSync(fd);
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const held = readHolder(path);
      if (isStale(held, writtenAt(path), now(), staleMs, isAlive)) {
        // `wx` settles a tie, so two stealers reaching this line still produce one winner.
        rmSync(path, { force: true });
        continue;
      }
      if (now() >= deadline) throw new InjectionLockedError(path, held);
      if (!told) {
        told = true;
        onWait?.(
          held === null
            ? `waiting for another Rigline process to release ${path}`
            : `waiting for ${held.what} (pid ${held.pid}) to finish`,
        );
      }
      sleep(pollMs);
    }
  }

  try {
    return work();
  } finally {
    rmSync(path, { force: true });
  }
}
