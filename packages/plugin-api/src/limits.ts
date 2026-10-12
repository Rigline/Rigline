/**
 * How much of the account's plan is used, read off the windows the extension pushes to every panel
 * (decisions.md, D129).
 *
 * Pure: the panel's own merge of `panel_usage_update`, what the merged windows read as at a given
 * time, and who is signed in. The host's limits service holds the state and the reset timer.
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

const NAMES = ["five_hour", "seven_day"] as const;

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

/**
 * `current` after one `panel_usage_update`, merged as the panel merges it: a window sent as null is
 * deleted, one left out is kept, and one without a reset time never replaces one with. `current`
 * itself when nothing changed.
 */
export function mergeWindows(current: RawWindows, update: unknown): RawWindows {
  const windows = asRecord(asRecord(update)?.unifiedWindows);
  if (windows === null) return current;
  let next: { five_hour?: RawWindow; seven_day?: RawWindow } | null = null;
  for (const name of NAMES) {
    if (windows[name] === null) {
      if (current[name] === undefined) continue;
      next ??= { ...current };
      delete next[name];
      continue;
    }
    const window = rawWindow(windows[name]);
    if (window === null) continue;
    if (window.resetsAt === null && current[name]?.resetsAt != null) continue;
    next ??= { ...current };
    next[name] = window;
  }
  return next ?? current;
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
  const times = NAMES.map((name) => raw[name]?.resetsAt)
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
