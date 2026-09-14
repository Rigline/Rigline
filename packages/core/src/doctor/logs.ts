/**
 * Parsing VS Code's own log files for the lines that bear on a panel that misbehaved (D53).
 *
 * Every function here takes text and returns data; nothing in this module opens a file. That is
 * the point rather than a tidiness preference: `collect.ts` owns the decision about which files may
 * be opened at all, and that decision is the privacy boundary. A parser able to reach the
 * filesystem itself would be a second place for the rule to be forgotten.
 *
 * None of these formats is documented upstream, so each was read off real logs from a machine that
 * had actually lost a window. The surprises are recorded where they bite; the four worth knowing
 * before reading any of it:
 *
 *   - The `CodeWindow` lines in `main.log` do not name the window they belong to. One log holds
 *     every window of one app launch, so a detect and a recovery can only be paired by order.
 *   - A recovery line is usually a window *closing*, not a window recovering. See `WINDOW_CLOSE_MS`.
 *   - A detect is not always followed by a recovery at all; the next thing in the file can be
 *     another detect. Episodes therefore close out of order and some never close.
 *   - Continuation lines are indented with four spaces in `main.log`, with a tab in `exthost.log`,
 *     and not at all in some `renderer.log` lines. A continuation is therefore defined as "a line
 *     that does not begin with a timestamp", never by its indent.
 */

/**
 * One log line's header: `2026-09-14 12:12:31.615 [error] message`.
 *
 * The message group is optional because VS Code writes a bare `[error] ` with nothing after it as
 * the header of a stack it is about to print on the following lines, and a pattern that required a
 * message would silently drop the line that carries the timestamp of the exception.
 */
const HEADER = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[(\w{1,16})\](?: (.*))?$/;

const DETECTED = "CodeWindow: detected unresponsive";
const RECOVERED = "CodeWindow: recovered from unresponsive";
const SAMPLES = "CodeWindow unresponsive samples:";
const UNCAUGHT_PREFIX = "[uncaught exception in main]: ";

/** `Extension host with pid 49324 exited with code: 0, signal: unknown.` */
const HOST_EXIT = /^Extension host with pid (\d{1,10}) exited with (.{0,200})$/;

/** `Started local extension host with pid 45272.`, from a window's `renderer.log`. */
const HOST_START = /^Started local extension host with pid (\d{1,10})\.?$/;

/** `Total Samples: 9`, the last line of a sample block. */
const TOTAL_SAMPLES = /^Total Samples: (\d{1,9})$/;

/**
 * How long after a recovery line an extension-host exit still reads as the same event.
 *
 * A window being closed produces exactly the shape of a window recovering: the renderer stops
 * being unresponsive because it is gone, `CodeWindow: recovered from unresponsive` is logged, and
 * the extension host for that window is torn down a moment later. On the logs this was written
 * against, *every* recovery was of that kind, with gaps of 1.5s, 1.65s, 1.9s and 2.1s — so a
 * threshold of "a second or two" would have missed one and reported a lockup as recovered.
 *
 * Three seconds, and only forwards: the teardown follows the recovery, and a symmetric window
 * would let an unrelated window's host exit reclassify a genuine recovery.
 */
export const WINDOW_CLOSE_MS = 3000;

/**
 * How close two recovery lines have to be before the second is read as a repeat of the first.
 *
 * A real log carries `CodeWindow: recovered from unresponsive` twice, one millisecond apart, for
 * what is plainly one window coming back. Taken at face value the second recovery pairs with
 * whatever detect is still open — which was a lockup from two and a half hours earlier — and the
 * report then leads with a 151-minute episode that never happened. Two windows recovering inside
 * the same quarter-second is possible; it is also far less likely than the duplicate that was
 * actually observed, and it costs a counted line rather than a fabricated one.
 */
export const DUPLICATE_RECOVERY_MS = 250;

/** One timestamped line and the untimestamped lines that follow it. */
export interface LogEntry {
  /** `2026-09-14 12:12:31.615`, exactly as written: local time, with no zone to resolve it. */
  readonly at: string;
  readonly level: string;
  readonly message: string;
  readonly detail: readonly string[];
}

/** `2026-09-14 12:12:31.615` as epoch milliseconds, or null when it will not parse. */
export function parseStamp(at: string): number | null {
  // Local time, because that is what VS Code writes and there is no zone in the line to say
  // otherwise. Mostly these are differenced against each other within one file, which needs no
  // zone at all; the one comparison against the clock is `errorSummary`'s time window, and it is
  // sound for the same reason — the log was written by this machine, in this zone. A line that
  // crosses a daylight-saving boundary can land an hour either side of the cut, which is why
  // "which launch directory" is answered from file mtimes instead.
  const ms = Date.parse(at.replace(" ", "T"));
  return Number.isNaN(ms) ? null : ms;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Every timestamped line in a log, each carrying the untimestamped lines that followed it.
 *
 * Blank continuation lines are dropped, because a stack printed by one extension is separated from
 * the next line by one, and keeping them turns a compact report into a sparse one. Non-blank
 * continuations are kept verbatim, indent included: the indent is how a reader tells a stack frame
 * from a wrapped message.
 */
export function parseEntries(text: string): LogEntry[] {
  const entries: { at: string; level: string; message: string; detail: string[] }[] = [];
  for (const line of splitLines(text)) {
    const header = HEADER.exec(line);
    if (header) {
      entries.push({
        at: header[1] ?? "",
        level: header[2] ?? "",
        message: header[3] ?? "",
        detail: [],
      });
      continue;
    }
    if (line.trim().length === 0) continue;
    entries.at(-1)?.detail.push(line);
  }
  return entries;
}

/** A `CodeWindow unresponsive samples:` block, kept verbatim because it is the actual evidence. */
export interface SampleBlock {
  readonly at: string;
  /** The `<N>` markers, the `at …` frames and the `Total Samples:` line, exactly as written. */
  readonly lines: readonly string[];
  readonly totalSamples: number | null;
}

/** An `[uncaught exception in main]` line and the frames VS Code printed under it. */
export interface UncaughtException {
  readonly at: string;
  readonly message: string;
  /** The window's id, which is the only place in `main.log` a window is ever named. */
  readonly windowId: number | null;
  readonly pid: number | null;
  readonly frames: readonly string[];
}

export interface ExtensionHostExit {
  readonly at: string;
  readonly pid: number;
  /** `code: 0, signal: unknown.` — kept whole, since a non-zero code is the interesting case. */
  readonly detail: string;
}

/** A window that stopped answering, and what the main process recorded while it was not. */
export interface UnresponsiveEpisode {
  readonly detectedAt: string;
  /** Null when no recovery line ever arrived for this detect — the lockup that did not end. */
  readonly recoveredAt: string | null;
  readonly durationMs: number | null;
  /**
   * The extension-host exit that followed the recovery closely enough to mean the window was being
   * closed rather than recovering (D53's caution, and `WINDOW_CLOSE_MS`). Null when the recovery
   * stands on its own, which is the only case where "recovered" may be read at face value.
   */
  readonly closedBy: ExtensionHostExit | null;
  readonly samples: readonly SampleBlock[];
  readonly uncaught: readonly UncaughtException[];
}

export interface MainLog {
  readonly episodes: readonly UnresponsiveEpisode[];
  readonly exits: readonly ExtensionHostExit[];
  /** Recovery lines with no detect left open. See `parseMainLog` for why these are not an error. */
  readonly orphanRecoveries: readonly string[];
  /** Recovery lines read as repeats of the one before them. See `DUPLICATE_RECOVERY_MS`. */
  readonly duplicateRecoveries: number;
  /** Sample blocks that arrived before any detect, which would mean a truncated or rotated log. */
  readonly straySamples: readonly SampleBlock[];
}

interface MutableEpisode {
  detectedAt: string;
  recoveredAt: string | null;
  durationMs: number | null;
  closedBy: ExtensionHostExit | null;
  samples: SampleBlock[];
  uncaught: UncaughtException[];
}

/** The untimestamped lines following index `from`, and the index of the first line after them. */
function readContinuation(lines: readonly string[], from: number): [string[], number] {
  const block: string[] = [];
  let i = from;
  while (i < lines.length && !HEADER.test(lines[i] ?? "")) {
    block.push(lines[i] ?? "");
    i++;
  }
  while (block.length > 0 && (block.at(-1) ?? "").trim().length === 0) block.pop();
  return [block, i];
}

/**
 * Whether an extension-host exit is close enough after `recoveredAt` to be the same event: the
 * window closing. Exported because it is the one judgement in this file a reader is likely to
 * disagree with, and a disagreement should be arguable against a test rather than against prose.
 */
export function closingExit(
  recoveredAt: string,
  exits: readonly ExtensionHostExit[],
  withinMs = WINDOW_CLOSE_MS,
): ExtensionHostExit | null {
  const recovered = parseStamp(recoveredAt);
  if (recovered === null) return null;
  for (const exit of exits) {
    const at = parseStamp(exit.at);
    if (at === null) continue;
    const delta = at - recovered;
    if (delta >= 0 && delta <= withinMs) return exit;
  }
  return null;
}

/**
 * Everything in `main.log` that speaks to a window that stopped answering.
 *
 * Pairing is by order and nothing else, because the lines carry no window id: a recovery closes the
 * *newest* detect still open. Neither order is correct in general — with no window id there is no
 * correct answer — but oldest-first was tried against a real log and produced a two-and-a-half-hour
 * episode out of a detect at 09:42 and a recovery at 12:12 that plainly belonged to different
 * windows, while leaving the intervening lockups looking instantaneous. Newest-first gives
 * plausible durations and leaves the long-outstanding detect open, which is the honest answer for a
 * window nothing ever recorded coming back.
 *
 * A recovery arriving with nothing open is recorded rather than discarded; it happens legitimately
 * when a log begins mid-lockup, and it is also the tell that this pairing has drifted from what the
 * lines meant, which a reader can only notice if it is on the page.
 *
 * Sample blocks attach to the newest open episode, since VS Code samples the window it has just
 * found unresponsive. With nothing open they attach to the most recent episode, because a block
 * still describes the lockup that has just ended rather than nothing at all.
 */
export function parseMainLog(text: string): MainLog {
  const lines = splitLines(text);
  const episodes: MutableEpisode[] = [];
  const open: MutableEpisode[] = [];
  const exits: ExtensionHostExit[] = [];
  const orphanRecoveries: string[] = [];
  const straySamples: SampleBlock[] = [];
  let duplicateRecoveries = 0;
  let lastRecoveredMs: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const header = HEADER.exec(lines[i] ?? "");
    if (!header) continue;
    const at = header[1] ?? "";
    const message = header[3] ?? "";

    if (message === DETECTED) {
      const episode: MutableEpisode = {
        detectedAt: at,
        recoveredAt: null,
        durationMs: null,
        closedBy: null,
        samples: [],
        uncaught: [],
      };
      episodes.push(episode);
      open.push(episode);
      continue;
    }

    if (message === RECOVERED) {
      const recoveredMs = parseStamp(at);
      if (
        lastRecoveredMs !== null &&
        recoveredMs !== null &&
        recoveredMs - lastRecoveredMs <= DUPLICATE_RECOVERY_MS
      ) {
        // Counted against the first line of the run rather than the previous one, so a burst of
        // repeats collapses to one event instead of walking forward a quarter-second at a time.
        duplicateRecoveries++;
        continue;
      }
      lastRecoveredMs = recoveredMs;
      const episode = open.pop();
      if (episode) {
        episode.recoveredAt = at;
        const from = parseStamp(episode.detectedAt);
        const to = parseStamp(at);
        episode.durationMs = from === null || to === null ? null : to - from;
      } else {
        orphanRecoveries.push(at);
      }
      continue;
    }

    if (message === SAMPLES) {
      const [block, next] = readContinuation(lines, i + 1);
      i = next - 1;
      const totalLine = block.map((l) => TOTAL_SAMPLES.exec(l)).find((m) => m !== null);
      const sample: SampleBlock = {
        at,
        lines: block,
        totalSamples: totalLine ? Number(totalLine[1]) : null,
      };
      const owner = open.at(-1) ?? episodes.at(-1);
      if (owner) owner.samples.push(sample);
      else straySamples.push(sample);
      continue;
    }

    if (message.startsWith(UNCAUGHT_PREFIX)) {
      const body = message.slice(UNCAUGHT_PREFIX.length);
      // The frames belong to the *next* entry, not to this one: VS Code writes the exception's
      // message on one line and then a second, empty `[error]` line whose continuation is the
      // stack. Absorbing it here is what keeps the stack attached to the exception it came from.
      let frames: string[] = [];
      const nextHeader = HEADER.exec(lines[i + 1] ?? "");
      if (nextHeader && (nextHeader[3] ?? "").length === 0) {
        const [block, next] = readContinuation(lines, i + 2);
        frames = block;
        i = next - 1;
      }
      const windowId = /window with ID (\d{1,10})/.exec(body);
      const pid = /pid (\d{1,10})/.exec(body);
      const exception: UncaughtException = {
        at,
        message: body,
        windowId: windowId ? Number(windowId[1]) : null,
        pid: pid ? Number(pid[1]) : null,
        frames,
      };
      (open.at(-1) ?? episodes.at(-1))?.uncaught.push(exception);
      continue;
    }

    const exit = HOST_EXIT.exec(message);
    if (exit) exits.push({ at, pid: Number(exit[1]), detail: exit[2] ?? "" });
  }

  for (const episode of episodes) {
    if (episode.recoveredAt !== null) episode.closedBy = closingExit(episode.recoveredAt, exits);
  }

  return { episodes, exits, orphanRecoveries, straySamples, duplicateRecoveries };
}

/** Every `Started local extension host with pid N.` in a window's renderer log. */
export function hostStarts(entries: readonly LogEntry[]): { at: string; pid: number }[] {
  const starts: { at: string; pid: number }[] = [];
  for (const entry of entries) {
    const match = HOST_START.exec(entry.message);
    if (match) starts.push({ at: entry.at, pid: Number(match[1]) });
  }
  return starts;
}

/** One error, and every time it occurred with the same message and the same detail. */
export interface ErrorGroup {
  readonly message: string;
  readonly detail: readonly string[];
  readonly count: number;
  readonly first: string;
  readonly last: string;
  /** How many detail lines were dropped from `detail`, or 0 when it is whole. */
  readonly detailDropped: number;
}

export interface ErrorSummary {
  readonly groups: readonly ErrorGroup[];
  /** Error entries inside the time window, before any grouping. */
  readonly total: number;
  /** Distinct errors, before any capping. `groups.length` is what survived the cap. */
  readonly distinct: number;
  /** Error entries older than the time window, counted so their absence is visible. */
  readonly older: number;
}

export interface ErrorSummaryOptions {
  readonly maxGroups?: number;
  readonly maxDetail?: number;
  /**
   * Epoch milliseconds before which an error is counted but not reported, or null for all of them.
   *
   * A window's `renderer.log` and `exthost.log` live for as long as the launch does, which on a
   * machine left running is a week — so a report bounded only by which *launch* to read still
   * carries days of marketplace fetch failures around the one hour that matters. Bounding the
   * entries by the same window the launches were chosen with is what makes `--since` mean one
   * thing. Unresponsive episodes are deliberately never filtered this way: they are rare, they are
   * the point, and losing one to a clock that moved would cost the report its reason to exist.
   */
  readonly fromMs?: number | null;
}

/**
 * The `[error]` entries of one log, collapsed to one row per distinct error.
 *
 * Collapsing is not a nicety. A real `exthost.log` carries the same "Channel has been closed" with
 * the same four frames fifty times over as one extension host is torn down, and a report that
 * listed them all would be one nobody pastes into an issue. Identity is the message plus the whole
 * detail block, so two errors that share a message but not a stack stay apart.
 *
 * When more distinct errors than `maxGroups` are present the *most recent* survive, ordered by
 * their last occurrence: a log spanning days opens with startup noise, and the errors worth reading
 * are the ones near the problem the person is reporting. They are then rendered in first-seen
 * order, so the surviving rows still read as a sequence.
 */
export function errorSummary(
  entries: readonly LogEntry[],
  options: ErrorSummaryOptions = {},
): ErrorSummary {
  const maxGroups = options.maxGroups ?? 12;
  const maxDetail = options.maxDetail ?? 10;
  const fromMs = options.fromMs ?? null;

  /** One distinct error while it is still being counted. `order` is first-seen position. */
  interface Tally {
    readonly order: number;
    readonly message: string;
    readonly detail: readonly string[];
    readonly detailDropped: number;
    count: number;
    first: string;
    last: string;
  }

  const byKey = new Map<string, Tally>();
  let total = 0;
  let older = 0;
  for (const entry of entries) {
    if (entry.level !== "error") continue;
    if (fromMs !== null) {
      // An entry whose timestamp will not parse is kept rather than dropped: a line this parser
      // does not understand is the last thing a diagnostic should be silently discarding.
      const at = parseStamp(entry.at);
      if (at !== null && at < fromMs) {
        older++;
        continue;
      }
    }
    total++;
    const key = `${entry.message} ${entry.detail.join("\n")}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count++;
      // Timestamps in this format sort lexically, so first and last need no parsing. Compared
      // rather than assumed monotonic: a log rotated mid-write is not worth a wrong row.
      if (entry.at < existing.first) existing.first = entry.at;
      if (entry.at > existing.last) existing.last = entry.at;
      continue;
    }
    byKey.set(key, {
      order: byKey.size,
      message: entry.message,
      detail: entry.detail.slice(0, maxDetail),
      detailDropped: Math.max(0, entry.detail.length - maxDetail),
      count: 1,
      first: entry.at,
      last: entry.at,
    });
  }

  const all = [...byKey.values()];
  const kept =
    all.length <= maxGroups
      ? all
      : [...all]
          .sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : b.order - a.order))
          .slice(0, maxGroups)
          .sort((a, b) => a.order - b.order);

  return {
    groups: kept.map((tally) => ({
      message: tally.message,
      detail: tally.detail,
      count: tally.count,
      first: tally.first,
      last: tally.last,
      detailDropped: tally.detailDropped,
    })),
    total,
    distinct: all.length,
    older,
  };
}
