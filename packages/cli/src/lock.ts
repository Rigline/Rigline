/**
 * One writer at a time under `<RIGLINE_HOME>` (D80).
 *
 * Until the companion existed there was exactly one thing that installed an engine, so nothing
 * could race it. Now `rigline update` in a terminal and the companion in the extension host both
 * acquire, and two npm installs interleaving into one prefix is how `engine` ends up in the state
 * the wrapper's README already tells people to delete.
 *
 * The whole home rather than the engine directory, because `update` moves plugins in the same run
 * and those collide the same way. Injection is deliberately *not* covered: it is
 * rebuild-from-backup and idempotent, so two processes injecting write the same bytes, and a lock
 * held across it would serialise the slow half for nothing.
 *
 * `wx` is the primitive. Exclusive create is atomic on both platforms and needs no dependency, and
 * it is what decides a stolen lock too: a stealer unlinks and then races for `wx` like everybody
 * else, so two processes deciding to steal at once still produce one winner.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "./errors.ts";

/** Who holds it, as it is written into the file. Read by a waiter to say who it is waiting for. */
export interface LockHolder {
  readonly pid: number;
  /** ISO 8601, so the file is readable by a person deciding whether to delete it. */
  readonly since: string;
  /** What the holder is doing, in the words a waiter should print. */
  readonly what: string;
}

export interface LockOptions {
  readonly home: string;
  /** This holder's `what`. */
  readonly what: string;
  /** How long to wait for a holder before refusing. */
  readonly waitMs?: number;
  /** A lock at least this old whose process is gone is taken rather than waited for. */
  readonly staleMs?: number;
  readonly pollMs?: number;
  readonly now?: () => number;
  readonly isAlive?: (pid: number) => boolean;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** A minute: longer than any install, short enough that a crash is not a lasting injury. */
const STALE_MS = 60_000;
const WAIT_MS = 30_000;
const POLL_MS = 250;

export function lockPath(home: string): string {
  return join(home, ".lock");
}

/**
 * Whether a pid is a live process.
 *
 * Signal 0 checks for existence without delivering anything, on Windows as well as POSIX. `EPERM`
 * counts as alive: the process is there, it is simply not ours to signal.
 */
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
    // Unreadable or half-written: treated as stale rather than as a holder, because a file nobody
    // can identify is one nobody can wait for sensibly.
    return null;
  }
}

/** Whether a holder has stopped mattering. A lock with no readable holder is always stale. */
export function isStale(
  holder: LockHolder | null,
  now: number,
  staleMs: number,
  isAlive: (pid: number) => boolean,
): boolean {
  if (holder === null) return true;
  const since = Date.parse(holder.since);
  const old = Number.isNaN(since) || now - since >= staleMs;
  return old && !isAlive(holder.pid);
}

export class HomeLockedError extends UserError {
  readonly holder: LockHolder | null;

  constructor(path: string, holder: LockHolder | null) {
    super(
      holder === null
        ? `another Rigline process is using ${path}. Try again, or delete that file if nothing is.`
        : `${holder.what} (pid ${holder.pid}) has been working under Rigline's home since ` +
            `${holder.since}. Try again when it has finished, or delete ${path} if it has not.`,
    );
    // `name` stays "UserError": the wrapper's top level prints a UserError as a message rather than
    // a stack, and this is one of those. What distinguishes it is the class and `holder`.
    this.holder = holder;
  }
}

/**
 * Run `work` with the home locked, and release it whatever happens.
 *
 * The release is unconditional rather than best-effort: a lock left behind by a throw would be
 * waited on for a full minute by the next process, which is a silent delay rather than a loud
 * failure and so exactly what P8 refuses.
 */
export async function withHomeLock<T>(options: LockOptions, work: () => Promise<T>): Promise<T> {
  const {
    home,
    what,
    waitMs = WAIT_MS,
    staleMs = STALE_MS,
    pollMs = POLL_MS,
    now = Date.now,
    isAlive = alive,
    sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  } = options;

  const path = lockPath(home);
  mkdirSync(home, { recursive: true });
  const deadline = now() + waitMs;

  for (;;) {
    const holder: LockHolder = { pid: process.pid, since: new Date(now()).toISOString(), what };
    try {
      const fd = openSync(path, "wx");
      try {
        writeFileSync(fd, JSON.stringify(holder, null, 2));
      } finally {
        // `writeFileSync` does not close a descriptor it was handed, and an acquisition every half
        // minute for the life of an editor window is a descriptor leak with a long fuse.
        closeSync(fd);
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const held = readHolder(path);
      if (isStale(held, now(), staleMs, isAlive)) {
        // Unlink and go round again rather than writing over it: `wx` is what settles a tie, and
        // two stealers both reaching this line still produce one winner.
        rmSync(path, { force: true });
        continue;
      }
      if (now() >= deadline) throw new HomeLockedError(path, held);
      await sleep(pollMs);
    }
  }

  try {
    return await work();
  } finally {
    rmSync(path, { force: true });
  }
}
