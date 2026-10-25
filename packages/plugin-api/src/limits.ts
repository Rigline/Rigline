/**
 * How much of the account's plan is used, read off the windows the extension pushes to every panel
 * (decisions.md, D129) and the readings other panels share (D147).
 *
 * Pure: which of two readings stands, what the held windows read as at a given time, and who is
 * signed in. The host's limits service holds the state and the reset timer.
 */

/** One plan window, as the panel's own usage bars read it. */
export interface LimitWindow {
  /** How much of the window is used: 0 is none and 1 is the limit, as Claude Code reports it. */
  readonly used: number;
  /**
   * When the window resets, in milliseconds since the epoch. Null once it has reset, when `used` is
   * 0 until the next request starts a new one, and where Claude Code did not say.
   */
  readonly resetsAt: number | null;
}

/** How much of the plan's usage limits is used. */
export interface UsageLimits {
  /**
   * The five-hour session window, or null where Claude Code has not reported one: before the first
   * reading, and always for an API key or a cloud provider.
   */
  readonly fiveHour: LimitWindow | null;
  /** The seven-day weekly window, null on the same terms. */
  readonly sevenDay: LimitWindow | null;
}

export const UNKNOWN_LIMITS: UsageLimits = Object.freeze({ fiveHour: null, sevenDay: null });

/** A window as the extension sends it: `utilization` from 0 to 1, `resetsAt` in epoch seconds. */
export interface RawWindow {
  readonly utilization: number;
  readonly resetsAt: number | null;
}

export type RawWindows = Readonly<{ five_hour?: RawWindow; seven_day?: RawWindow }>;

export const WINDOW_KEYS = ["five_hour", "seven_day"] as const;
export type WindowKey = (typeof WINDOW_KEYS)[number];

/**
 * A window and when it was observed, in milliseconds since the epoch: exactly where the reading was
 * stamped, and no later than `at` where it was not (D147).
 */
export interface Reading extends RawWindow {
  readonly at: number;
  readonly exact: boolean;
}

export type Readings = Readonly<{ five_hour?: Reading; seven_day?: Reading }>;

/** The windows one message states: a reading each, or null for one the extension deletes. */
export type Stated = Readonly<{ five_hour?: Reading | null; seven_day?: Reading | null }>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function rawWindow(value: unknown): RawWindow | null {
  const w = asRecord(value);
  const utilization = count(w?.utilization);
  return utilization === null ? null : { utilization, resetsAt: count(w?.resetsAt) };
}

/** What a `unifiedWindows` states, each window it sends a reading observed at `at`. */
export function statedAt(unifiedWindows: unknown, at: number, exact: boolean): Stated {
  const windows = asRecord(unifiedWindows);
  const stated: { five_hour?: Reading | null; seven_day?: Reading | null } = {};
  if (windows === null) return stated;
  for (const name of WINDOW_KEYS) {
    if (windows[name] === null) {
      stated[name] = null;
      continue;
    }
    const window = rawWindow(windows[name]);
    if (window !== null) stated[name] = { ...window, at, exact };
  }
  return stated;
}

/** A reading as another panel sent it, or null where it does not hold. */
export function readingFrom(value: unknown): Reading | null {
  const window = rawWindow(value);
  const r = asRecord(value);
  const at = count(r?.at);
  if (window === null || at === null || typeof r?.exact !== "boolean") return null;
  return { ...window, at, exact: r.exact };
}

/**
 * Resets nearer than this, in seconds, are one period's: the extension rounds the usage endpoint's
 * to the second, and periods are hours apart.
 */
const SAME_PERIOD = 3600;

/**
 * Whether `next` stands over `held` (D147). Where the times settle it the newer stands, whichever
 * way the figure moves; where they do not, `next` stands only by raising it. One without a reset
 * time never stands over one with, as the panel merges.
 */
export function supersedes(held: Reading | undefined, next: Reading): boolean {
  if (held === undefined) return true;
  if (next.resetsAt === null && held.resetsAt !== null) return false;
  if (next.exact && next.at > held.at) return true;
  if (held.exact && next.at <= held.at) return false;
  const [was, now] = [held.resetsAt ?? 0, next.resetsAt ?? 0];
  return Math.abs(now - was) < SAME_PERIOD ? next.utilization > held.utilization : now > was;
}

/**
 * `held` after `stated`: each reading that supersedes what is held, and each window stated as null
 * deleted. `held` itself when nothing changed.
 */
export function mergeReadings(held: Readings, stated: Stated): Readings {
  let next: { five_hour?: Reading; seven_day?: Reading } | null = null;
  for (const name of WINDOW_KEYS) {
    const reading = stated[name];
    if (reading === undefined) continue;
    if (reading === null) {
      if (held[name] === undefined) continue;
      next ??= { ...held };
      delete next[name];
    } else if (supersedes(held[name], reading)) {
      next ??= { ...held };
      next[name] = reading;
    }
  }
  return next ?? held;
}

function windowAt(raw: RawWindow | undefined, now: number): LimitWindow | null {
  if (raw === undefined) return null;
  const resetsAt = raw.resetsAt === null ? null : raw.resetsAt * 1000;
  if (resetsAt !== null && resetsAt <= now) return { used: 0, resetsAt: null };
  return { used: raw.utilization, resetsAt };
}

/** What `raw` reads as at `now`: a window past its reset is used 0, as the panel's bars show it. */
export function limitsAt(raw: RawWindows, now: number): UsageLimits {
  return { fiveHour: windowAt(raw.five_hour, now), sevenDay: windowAt(raw.seven_day, now) };
}

/** The earliest reset still to come, in milliseconds since the epoch, or null. */
export function nextReset(raw: RawWindows, now: number): number | null {
  const times = WINDOW_KEYS.map((name) => raw[name]?.resetsAt)
    .filter((s): s is number => typeof s === "number")
    .map((s) => s * 1000)
    .filter((ms) => ms > now);
  return times.length === 0 ? null : Math.min(...times);
}

/**
 * Who an auth status says is signed in, as the panel tells accounts apart: `3p` for a cloud
 * provider, else the email. Null for signed out; undefined where it cannot tell.
 */
export function identityOf(status: Record<string, unknown> | null): string | null | undefined {
  if (status === null) return null;
  if (status.authMethod === "3p") return "3p";
  return typeof status.email === "string" ? status.email : undefined;
}

/** Whether the account changed, by the panel's rule: from one known identity to anything else. */
export function identityChanged(
  previous: string | null | undefined,
  next: string | null | undefined,
): boolean {
  return previous !== undefined && previous !== null && next !== undefined && previous !== next;
}
