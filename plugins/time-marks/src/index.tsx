/**
 * The clock time on every transcript entry, and a divider where the conversation jumped: a new
 * calendar day, or a pause long enough to be worth naming. Reopening an old session then says when
 * each part of it happened, at the density the CLI actually writes records — one per content block,
 * so tool calls and thinking blocks each carry their own time rather than inheriting whatever time
 * the surrounding message happened to render at.
 *
 * Claude Code stamps some rows itself, and where it does, its stamp is the one that stays: the same
 * instant, the person's own `timeFormat`, and the date on hover. This plugin fills in the rows it
 * leaves bare, in the same place and the same look, and marks the breaks (D135).
 *
 * Three constraints, two of them asserted in this plugin's own tests:
 *
 * - **Never narrow the row.** A reserved right-hand gutter works, and costs every line in every
 *   message an earlier wrap, a code block a tab stop of width, and the transcript its height. No
 *   rule here touches `padding-left`, `padding-right`, `width`, `max-width` or `margin-right`.
 * - **A node returned from here is a flex item.** A row is a flex column, so anything mounted in it
 *   claims a line and pushes the content down — while the row's timeline dot is the row's own
 *   `:before` at a fixed offset from the top and does not move with it, leaving a column of dots
 *   beside nothing. Both nodes built here are absolutely positioned.
 * - **Vertical room comes from the app's own variable.** `--message-padding-top` drives the row's
 *   padding, its content offset and its dot together, so a `padding-top` of our own would move one
 *   of the three. It is the handle the app raises for its own stamp, and `styleRules` raises it to
 *   the same value (D135).
 *
 * `dayName` is computed fresh on every call and never cached, because a row is built once and kept:
 * a panel open across midnight would otherwise go on saying "Today" over yesterday's rows. A
 * minute's poll re-registers the decorator when the date has moved, rather than a timer set for
 * midnight that a sleeping machine never runs.
 *
 * Turning the feature off tears the decorator down, which removes every node from the tree rather
 * than hiding it: nothing is left to be found by a search, copied with a selection, or read aloud.
 */
import { definePlugin, type Store, store, type TranscriptEntry } from "@rigline/plugin-api";
import { MenuItem, useStore } from "@rigline/plugin-api/ui";
import type { ReactNode } from "react";

/** Below this, a gap "reads as continuous" and gets no divider. */
const GAP_MS = 10 * 60 * 1000;

const STORAGE_KEY = "rigline.time-marks.visible";

/** How often the date is compared with the one the rows were drawn on. */
const MIDNIGHT_POLL_MS = 60 * 1000;

/** Present on both a plain time node and a divider; a divider adds LEAD_CLASS alongside it. */
const TIME_CLASS = "rigline-tm-time";
/** Present only on a divider's own node, which is the one case that needs room even when stamped. */
const LEAD_CLASS = "rigline-tm-lead";
/** The clock time itself, which the app's own stamp stands in for where it has one (D135). */
const STAMP_CLASS = "rigline-tm-stamp";

/** Where a time sits in the row's top band, and where the app puts its own stamp (D135). */
const STAMP_TOP_PX = 6;
/** The band a row gets to hold one, and what the app raises `--message-padding-top` to for its own. */
const BAND_PX = 24;
/** The line box the app's stamp occupies, so a 6px offset leaves the same room above and below. */
const LINE_PX = 16;

// Locale left undefined deliberately: whatever the runtime's default is, is what the rest of the
// app already renders in.
const DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const DAY_IN_YEAR = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
// The options the app's own stamp uses, so a column of times reads as one feature whichever side
// drew each row. The person's `timeFormat` and `timeZone` are deliberately not read (D135).
const TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h12",
});

/** One mark to draw, or null for nothing. */
interface Mark {
  readonly lead: string | null;
  readonly time: string;
}

/**
 * Two epoch instants, compared by the calendar date an observer in this locale would name them —
 * never by dividing the gap between them by a day's length. That division is wrong by the local
 * UTC offset at every midnight and wrong again across a daylight-saving change, where a calendar
 * day is not always 86,400,000ms.
 */
function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/**
 * "Today", "Yesterday", or the full weekday and date, with the year when it is not this one.
 * Computed fresh against `Date.now()` on every call, never cached — see the module comment.
 * `setDate(-1)` rather than subtracting 24 hours of milliseconds, so a daylight-saving change does
 * not shift which calendar day "yesterday" names.
 */
export function dayName(at: number, now: number = Date.now()): string {
  if (sameDay(at, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(at, yesterday.getTime())) return "Yesterday";
  const inThisYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return (inThisYear ? DAY : DAY_IN_YEAR).format(at);
}

/**
 * A duration at the coarsest two units that still say something: minutes alone under an hour, then
 * hours with a minute remainder, then days with an hour remainder past 24h. Exported and pure
 * because the boundaries are exactly where a naive rounding prints something silly — "60m" for an
 * hour, "3h 0m" for an exact three hours, "0m" for the 50 seconds that round up to a minute — and
 * each is worth pinning with a test rather than trusting the arithmetic by eye.
 */
export function gapName(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return minutes === 0 ? `${totalHours}h` : `${totalHours}h ${minutes}m`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

/**
 * What to draw on one transcript entry, or null for nothing. `entry.at === null` means no record
 * has said when this happened yet — a prompt just sent is the common case — and P5 forbids
 * guessing: no marker, and the entry is skipped entirely when a later entry searches backward for
 * something to measure its own gap against.
 *
 * The search walks back to the nearest entry that actually has a time, not literally to
 * `index - 1`: an untimed entry sitting in between (the same just-sent prompt, seen from the other
 * side) would otherwise make every following entry's gap measure against "now", which is exactly
 * the wrong answer this whole capability exists to avoid.
 *
 * A negative gap — an entry arriving with an earlier timestamp than the one before it, which
 * happens across a resume — is never special-cased. `gap < GAP_MS` is already true for any
 * negative number, so it falls into the no-divider branch on its own; a resumed session does not
 * print "3h later" above a message that in fact came first.
 */
export function markFor(entry: TranscriptEntry, entries: readonly TranscriptEntry[]): Mark | null {
  if (entry.at === null) return null;
  const time = TIME.format(entry.at);

  let previousAt: number | null = null;
  for (let i = entry.index - 1; i >= 0; i--) {
    const at = entries[i]?.at;
    if (typeof at === "number") {
      previousAt = at;
      break;
    }
  }

  if (previousAt === null) {
    // Nothing to measure a gap against — the first timed entry in the transcript — and the one
    // lead worth showing unconditionally.
    return { lead: dayName(entry.at), time };
  }
  if (!sameDay(entry.at, previousAt)) {
    // A day boundary always wins over a duration: "20h later" is true and useless, and what a
    // reader wants at this boundary is the date.
    return { lead: dayName(entry.at), time };
  }
  const gap = entry.at - previousAt;
  if (gap < GAP_MS) return { lead: null, time };
  return { lead: `${gapName(gap)} later`, time };
}

/**
 * The two rules this plugin writes over app-owned elements. Both are scoped to rows it has put a
 * node on, so both lapse the moment the decorator is torn down — the toggle needs no cleanup of
 * its own, and switching the markers off hands every row back to the app's stamp.
 *
 * **The band** goes to a row that is showing a time of ours, and to any divider. A row the app
 * already stamps is excluded because the app has reserved the same 24px itself, and a row where
 * our time is hidden has nothing to reserve it for — a user prompt row is both, since the app's
 * stamp there is a line in the content rather than a label in the padding. `--message-padding-top`
 * and a literal `padding-top` together, because the sticky-header row sets its own padding outright
 * rather than deriving it, and a divider lands on that row more often than any other.
 *
 * **The dedupe** hides our clock time on a row the app has stamped. `visibility`, not `display`, so
 * the span keeps its box: a divider's rule then stops exactly where our time would have started,
 * which is where the app's stamp is, to the pixel, because both render the same string in the same
 * font (D135). It is still hidden from a search, a selection and a screen reader.
 *
 * `rowClass` comes from the caller's `ctx.anchor("transcriptRow")` rather than a literal, so a
 * rename upstream is caught by the anchor declaration refusing the plugin rather than by a selector
 * that silently stops matching. The app's own stamp is named by the `data-message-stamp` attribute
 * it carries, which no harvest watches — `ctx.check` is what says so when it changes.
 *
 * Never touches `padding-right`, `padding-left`, `width`, `max-width` or `margin-right`, which this
 * plugin's tests assert by name.
 */
export function styleRules(rowClass: string): string {
  const band = `{--message-padding-top:${BAND_PX}px;padding-top:${BAND_PX}px}`;
  return (
    `.${rowClass}:has(> .${TIME_CLASS}):not(:has(> [data-message-stamp])),` +
    `.${rowClass}:has(> .${LEAD_CLASS})${band}` +
    `.${rowClass}:has(> [data-message-stamp]) .${STAMP_CLASS}{visibility:hidden}`
  );
}

function storedVisible(): boolean {
  try {
    // Absence means on: the feature is why the plugin is installed, so a first run or a denied
    // store should read as on, not off.
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function storeVisible(visible: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, visible ? "on" : "off");
  } catch {
    // Storage may be denied in a webview. The preference just does not survive a reload, which is
    // better than a cosmetic setting throwing and disabling the whole plugin over it.
  }
}

function Toggle(props: { readonly visible: Store<boolean> }): ReactNode {
  const on = useStore(props.visible);
  return (
    <MenuItem
      label="Time markers"
      description="When each part of the session happened"
      checked={on}
      onSelect={(event) => {
        event.preventDefault();
        props.visible.set(!on);
      }}
    />
  );
}

export default definePlugin({
  setup(ctx) {
    const rowClass = ctx.anchor("transcriptRow");
    ctx.style(styleRules(rowClass));

    // Borrowed only for looks: itemTime makes this plugin's time read like the app's own small,
    // dimmed label. Losing it costs styling, never function, so it is declared optional and read
    // through ctx.optional rather than refusing the whole plugin over a class the inline styles
    // below can do without.
    const itemTimeClass = ctx.optional.anchor("itemTime");

    function timeSpan(text: string): HTMLElement {
      const span = document.createElement("span");
      span.className = STAMP_CLASS;
      span.textContent = text;
      if (itemTimeClass) span.classList.add(itemTimeClass);
      // The one place tabular figures earn themselves: a column of times read down a transcript.
      span.style.fontVariantNumeric = "tabular-nums";
      return span;
    }

    function buildPlain(time: string): Element {
      const node = document.createElement("div");
      node.className = TIME_CLASS;
      // Where the app puts its own stamp on a row it stamps, so one column holds both (D135).
      // Absolute offsets resolve against the row's padding box, so `right: 0` lands on the same
      // edge in a timeline row and a prompt row without this knowing which it is in.
      Object.assign(node.style, {
        position: "absolute",
        top: `${STAMP_TOP_PX}px`,
        right: "0",
        display: "flex",
        alignItems: "center",
        lineHeight: `${LINE_PX}px`,
        whiteSpace: "nowrap",
        userSelect: "none",
        // Also what keeps this off the app's stamp, which it sits exactly over and which answers
        // a hover with the full date.
        pointerEvents: "none",
      });
      node.appendChild(timeSpan(time));
      return node;
    }

    function buildDivider(lead: string, time: string): Element {
      const node = document.createElement("div");
      node.className = `${TIME_CLASS} ${LEAD_CLASS}`;
      Object.assign(node.style, {
        position: "absolute",
        top: `${STAMP_TOP_PX}px`,
        left: "0",
        right: "0",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        lineHeight: `${LINE_PX}px`,
        userSelect: "none",
        pointerEvents: "none",
      });

      const leadSpan = document.createElement("span");
      leadSpan.textContent = lead;
      if (itemTimeClass) leadSpan.classList.add(itemTimeClass);
      node.appendChild(leadSpan);

      // A flex-filled span rather than a CSS border, so the rule starts after the lead text
      // instead of running the full width behind it. currentColor at low alpha rather than a
      // border token, because this has to sit correctly on both the ordinary background and the
      // sticky-header background without resolving either one.
      const rule = document.createElement("span");
      Object.assign(rule.style, {
        flex: "1",
        height: "1px",
        background: "currentColor",
        opacity: "0.15",
      });
      node.appendChild(rule);

      node.appendChild(timeSpan(time));
      return node;
    }

    /** Rows this plugin has been asked about, and rows it returned a mark for. The two numbers its
     * check turns on: asked-but-never-marked is the whole feature silently absent. */
    let asked = 0;
    let marked = 0;
    let unmarkedSince: number | null = null;

    function build(entry: TranscriptEntry, entries: readonly TranscriptEntry[]): Element | null {
      asked += 1;
      if (unmarkedSince === null) unmarkedSince = performance.now();
      const mark = markFor(entry, entries);
      if (mark === null) return null;
      marked += 1;
      return mark.lead === null ? buildPlain(mark.time) : buildDivider(mark.lead, mark.time);
    }

    const visible = store(storedVisible());
    let decorateOff: (() => void) | null = null;
    let drawnOn = "";

    function decorate(): void {
      decorateOff = ctx.decorateTranscript(build);
      drawnOn = new Date().toDateString();
    }

    function applyDecoration(): void {
      if (visible.get() && decorateOff === null) {
        decorate();
      } else if (!visible.get() && decorateOff !== null) {
        decorateOff();
        decorateOff = null;
      }
    }
    applyDecoration();
    visible.subscribe(() => {
      storeVisible(visible.get());
      applyDecoration();
    });

    const midnight = setInterval(() => {
      if (decorateOff === null || new Date().toDateString() === drawnOn) return;
      decorateOff();
      decorate();
    }, MIDNIGHT_POLL_MS);

    ctx.menu(() => <Toggle visible={visible} />);

    /**
     * Whether any time is actually on screen.
     *
     * The failure this exists for: the plugin loads, its toggle is on, its decorator is registered,
     * and every row comes back unmarked because `entry.at` is null for all of them — the three-way
     * join behind an entry having come apart. Nothing else in the panel says a word about it. The
     * host's own `transcript:` line says rows are being identified and timed, which is a different
     * claim: it can pass while this fails, and that difference is what says the fault is here and
     * not in the host.
     *
     * Switched off is `n/a` and says so. A plugin the user has turned off is not a plugin that is
     * failing, and a red badge for a deliberate choice is the fastest way to teach somebody to
     * ignore the badge.
     *
     * The five-second grace is the same one the host's transcript check uses, and for the same
     * reason: a session still loading, or a prompt just sent, is a row that legitimately has no
     * record behind it yet.
     */
    ctx.check("marks are being placed", () => {
      if (!visible.get()) return { verdict: "n/a", detail: "markers are switched off" };
      if (asked === 0) return { verdict: "n/a", detail: "no transcript rows yet" };
      if (marked > 0) return { verdict: "pass", detail: `${marked} marked of ${asked} asked` };
      const waited = unmarkedSince === null ? 0 : performance.now() - unmarkedSince;
      if (waited > 5000) {
        return { verdict: "fail", detail: `${asked} rows, none carried a time` };
      }
      return { verdict: "n/a", detail: `${asked} rows, none timed yet` };
    });

    /**
     * Nothing in the harvest watches `data-message-stamp`, so this is what reports it: the day the
     * app renames that attribute, the dedupe rule stops matching and two times appear on the same
     * row (D135). One row is sampled rather than all of them, because the question is whether the
     * rule applies at all, and a computed style per row per second is not worth a second answer.
     */
    ctx.check("Claude Code's own time is not doubled", () => {
      if (!visible.get()) return { verdict: "n/a", detail: "markers are switched off" };
      let stamped = 0;
      let sample: Element | null = null;
      for (const node of document.getElementsByClassName(TIME_CLASS)) {
        const row = node.parentElement;
        if (!row || ![...row.children].some((c) => c.hasAttribute("data-message-stamp"))) continue;
        stamped += 1;
        sample ??= node.getElementsByClassName(STAMP_CLASS)[0] ?? null;
      }
      if (sample === null) {
        return { verdict: "n/a", detail: "Claude Code is stamping no row on screen" };
      }
      if (getComputedStyle(sample).visibility === "hidden") {
        return { verdict: "pass", detail: `${stamped} row(s) carry Claude Code's own time` };
      }
      return { verdict: "fail", detail: `${stamped} row(s) are showing two times` };
    });

    return () => clearInterval(midnight);
  },
});
