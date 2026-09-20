/**
 * The clock time on every transcript entry, and a divider where the conversation jumped: a new
 * calendar day, or a pause long enough to be worth naming. Reopening an old session then says when
 * each part of it happened, at the density the CLI actually writes records: one per content block,
 * not one per assistant turn, so a working session's tool calls and thinking blocks each carry
 * their own time instead of inheriting whatever time the surrounding message happened to render at.
 *
 * ## Why every entry, not just the jumps
 *
 * The first shape tried marked only the jump points and said almost nothing. A working session is
 * mostly tool calls seconds apart, so no pause threshold ever fires inside a busy stretch, and a
 * busy stretch is most of the transcript — a real session measured at 334 records deep, 203 of
 * them tool calls, would have earned perhaps a handful of marks under that scheme. Every timed
 * entry now gets its own clock time; a jump additionally gets a lead, on the same node rather than
 * a second one.
 *
 * ## Why the time costs no space, in either direction
 *
 * Two placements were tried before this one, and both cost the row something they should not have.
 *
 * Mounting the time as a line inside the row fails because a row is a flex column, so anything
 * `decorateTranscript` returns becomes a flex item and claims a line of its own, pushing the rest
 * of the row's content down — except the row's timeline dot is the row's own `:before`, positioned
 * at a fixed offset from the row's top, and does not move with the pushed content. The result is a
 * column of dots beside nothing.
 *
 * Reserving a right-hand gutter with `padding-right` works, and is not worth what it costs: every
 * line in every message wraps earlier, a code block loses a tab stop of width, and the whole
 * transcript grows taller to make room for a label that was supposed to be free. Narrowing the
 * content is the one thing a decoration here must never do — it is the constraint that rules out
 * most of the tidy-looking options, and it is asserted directly in this plugin's tests.
 *
 * What is actually free: the row is `padding: 8px 0` with `gap: 0` between rows, so two adjacent
 * rows' padding meets and leaves an unused vertical band at the seam. A label hung a few pixels
 * above the row's top edge sits inside that band, overlapping neither message. Left unset on both
 * sides, an absolutely-positioned flex child with no `left`/`right` falls to its *static
 * position* — the content box's own edge — which is exactly where a timeline row's left padding
 * and a plain user row's lack of it each already put their own content, so one node lands
 * correctly on both without reading or caring which kind of row it is in.
 *
 * ## Why the divider is allowed to move content, and nothing else is
 *
 * A divider marks a real break, and it needs the row's own top padding to make room for the label
 * without drawing over the first line beneath it. `--message-padding-top` is the app's own handle
 * on that padding, already driving the row's padding, the content's offset and the timeline dot's
 * vertical position together — raising it moves all three in lockstep, which a plugin-owned
 * `padding-top` alone could not do. That is `styleRules`'s entire job, and its only scope.
 *
 * ## Why `sameDay` and `dayName` are what they are
 *
 * `sameDay` compares local year/month/date rather than dividing two epoch instants by a day's
 * worth of milliseconds: that division gets the midnight boundary wrong by the observer's UTC
 * offset, and wrong again across a daylight-saving change, where a calendar day is not always
 * 86,400,000ms long. A session that runs past local midnight should break where the person actually
 * saw it break.
 *
 * `dayName` is computed fresh against `Date.now()` on every call, and is never cached. A panel can
 * sit open across midnight, and a cached "Today" would keep saying so after it stopped being true;
 * nothing here reruns on a clock timer, only when the transcript changes, so a cached answer would
 * persist arbitrarily long past being true.
 *
 * ## Why the toggle removes nodes instead of hiding them
 *
 * Turning the feature off tears down the decorator, which removes every node it placed from the
 * tree entirely — not `display: none`. Nothing is left to be found by a search, copied along with
 * a text selection, or read aloud by a screen reader. Turning it back on simply re-registers and
 * the host redraws whatever is on screen, which costs nothing worth caching state to avoid.
 */
import { definePlugin, type TranscriptEntry } from "@rigline/plugin-api";

/** Below this, a gap "reads as continuous" and gets no divider. */
const GAP_MS = 10 * 60 * 1000;

const STORAGE_KEY = "rigline.time-marks.visible";
const ICON_ID = "rigline-time-marks";

/** Present on both a plain time node and a divider; a divider adds LEAD_CLASS alongside it. */
const TIME_CLASS = "rigline-tm-time";
/** The class `styleRules` scopes its one rule to: present only on a divider's own node. */
const LEAD_CLASS = "rigline-tm-lead";

/** How far above the row's top edge a plain time hangs, inside the inter-row padding band. */
const HANG_PX = 6;
/** The row's own top padding while a divider occupies it, and what `--message-padding-top` is raised to. */
const DIVIDER_PX = 30;

// Locale left undefined deliberately: whatever the runtime's default is, is what the rest of the
// app already renders in.
const DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

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
 * "Today", "Yesterday", or the full weekday and date. Computed fresh against `Date.now()` on every
 * call, never cached — see the module comment. `setDate(-1)` rather than subtracting 24 hours of
 * milliseconds, so a daylight-saving change does not shift which calendar day "yesterday" names.
 */
function dayName(at: number): string {
  const now = new Date();
  if (sameDay(at, now.getTime())) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(at, yesterday.getTime())) return "Yesterday";
  return DAY.format(at);
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
 * The one rule this plugin ever writes over an app-owned element, scoped with `:has(> .LEAD)` so
 * it matches only rows this plugin actually put a divider on and lapses the moment that divider is
 * removed — no separate cleanup needed when the feature is toggled off. Sets both the custom
 * property the app's timeline dot and content already derive their offset from, and a literal
 * `padding-top`, because a sticky-header row was found to set `padding-top` outright rather than
 * deriving it, and would otherwise keep its own smaller value and let the divider draw over the
 * first line of the prompt beneath it — the row a divider lands on most often.
 *
 * `rowClass` always comes from the caller's own `ctx.anchor("transcriptRow")` rather than a
 * literal here, so a rename upstream is caught by the anchor declaration refusing the plugin, not
 * by a selector that silently stops matching anything.
 *
 * Never touches `padding-right`, `padding-left`, `width`, `max-width` or `margin-right`: an
 * earlier version of this rule reserved a right-hand gutter for the time, and every line of every
 * message wrapped earlier for it. Narrowing the content is the one thing this rule must never do
 * again, which is why that exact list is asserted against in this plugin's tests.
 */
export function styleRules(rowClass: string): string {
  return `.${rowClass}:has(> .${LEAD_CLASS}){--message-padding-top:${DIVIDER_PX}px;padding-top:${DIVIDER_PX}px}`;
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

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * A hand-drawn clock rather than an emoji glyph: the platform's emoji clocks are colour glyphs and
 * ignore `currentColor`, so one would sit wrong on a dark theme, a light theme and a custom one
 * indiscriminately. `stroke="currentColor"` inherits the button's own colour instead.
 */
function buildClockIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const face = document.createElementNS(SVG_NS, "circle");
  face.setAttribute("cx", "8");
  face.setAttribute("cy", "8");
  face.setAttribute("r", "6.2");
  svg.appendChild(face);

  // Hour and minute hands as one bent line from the centre rather than two separate ones: the
  // exact angle says nothing (this toggles a mode, it is not a real clock), so one path reads as
  // "clock" at 13px just as well.
  const hands = document.createElementNS(SVG_NS, "path");
  hands.setAttribute("d", "M8 4.4V8.3L11 10.6");
  svg.appendChild(hands);

  return svg;
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

    function timeSpan(text: string, dimmed: boolean): HTMLElement {
      const span = document.createElement("span");
      span.textContent = text;
      if (itemTimeClass) span.classList.add(itemTimeClass);
      span.style.fontVariantNumeric = "tabular-nums";
      span.style.letterSpacing = "0.03em";
      // A glance-only reference on a plain row; full opacity as a divider's own lead time.
      if (dimmed) span.style.opacity = "0.55";
      return span;
    }

    function buildPlain(time: string): Element {
      const node = document.createElement("div");
      node.className = TIME_CLASS;
      Object.assign(node.style, {
        position: "absolute",
        top: `-${HANG_PX}px`,
        display: "flex",
        alignItems: "center",
        whiteSpace: "nowrap",
        userSelect: "none",
        pointerEvents: "none",
      });
      // No left/right: an absolutely-positioned flex child with both auto keeps its static
      // position, which under align-items:flex-start on the row is the content box's own edge —
      // exactly where a timeline row's left padding and a plain user row's lack of it each already
      // put the content, without this needing to know which kind of row it is in.
      node.appendChild(timeSpan(time, true));
      return node;
    }

    function buildDivider(lead: string, time: string): Element {
      const node = document.createElement("div");
      node.className = `${TIME_CLASS} ${LEAD_CLASS}`;
      Object.assign(node.style, {
        position: "absolute",
        top: "7px",
        left: "0",
        right: "0",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        userSelect: "none",
        pointerEvents: "none",
      });

      const leadSpan = document.createElement("span");
      leadSpan.textContent = lead;
      if (itemTimeClass) leadSpan.classList.add(itemTimeClass);
      leadSpan.style.letterSpacing = "0.03em";
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

      node.appendChild(timeSpan(time, false));
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

    let visible = storedVisible();
    let decorateOff: (() => void) | null = null;

    function applyDecoration(): void {
      if (visible && decorateOff === null) {
        decorateOff = ctx.decorateTranscript(build);
      } else if (!visible && decorateOff !== null) {
        decorateOff();
        decorateOff = null;
      }
    }
    applyDecoration();

    // The host builds a mount once and re-places that same node through an ordinary re-render, so
    // this reference stays good for the life of one mount. What does build a second button is the
    // anchor itself being swapped for a new element, which ctx.watch reports and which starts a
    // fresh mount: buildIcon() then repoints this at whichever node is actually live, so a toggle
    // click reaches what is on screen rather than a detached predecessor.
    let currentIcon: HTMLButtonElement | null = null;

    function applyIconState(): void {
      if (!currentIcon) return;
      currentIcon.setAttribute("aria-pressed", String(visible));
      currentIcon.style.opacity = visible ? "0.75" : "0.3";
      currentIcon.title = visible
        ? "Time markers are on — click to hide them"
        : "Time markers are off — click to show when the session happened";
    }

    function setVisible(next: boolean): void {
      if (next === visible) return;
      visible = next;
      storeVisible(visible);
      applyIconState();
      applyDecoration();
    }

    function buildIcon(): HTMLButtonElement {
      const button = document.createElement("button");
      button.type = "button";
      button.id = ICON_ID;
      button.setAttribute("aria-label", "Toggle transcript time markers");
      Object.assign(button.style, {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "inherit",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "0",
      });
      button.appendChild(buildClockIcon());
      button.addEventListener("click", () => setVisible(!visible));
      currentIcon = button;
      applyIconState();
      return button;
    }

    // footerSpacer carries only the toggle: losing it costs the button, never the feature, since
    // the stored preference already governs whether decoration runs regardless of whether this ever
    // fires. Declared optional so an extension update that retires the spacer costs this one
    // decoration rather than the plugin (D41); ctx.watch already answers "the class is gone" the
    // same way an unfound anchor answers everywhere else, by watching nothing rather than throwing.
    //
    // The spacer rather than the model pill, which is the obvious anchor and the wrong one: the
    // footer measures its own element children to choose a fit stage and moves the pill out of
    // itself at the widest one, so a decoration anchored to the pill leaves and re-enters the
    // measured container on every change of mind and re-triggers the measurement by doing it (D54).
    // mountBefore rather than mountAfter because the spacer is `flex-grow:1`: before it is the end
    // of the footer's left cluster, after it is out beside the send button.
    ctx.watch("footerSpacer", (el) => ctx.mountBefore(el, buildIcon));

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
      if (!visible) return { verdict: "n/a", detail: "markers are switched off" };
      if (asked === 0) return { verdict: "n/a", detail: "no transcript rows yet" };
      if (marked > 0) return { verdict: "pass", detail: `${marked} marked of ${asked} asked` };
      const waited = unmarkedSince === null ? 0 : performance.now() - unmarkedSince;
      if (waited > 5000) {
        return { verdict: "fail", detail: `${asked} rows, none carried a time` };
      }
      return { verdict: "n/a", detail: `${asked} rows, none timed yet` };
    });

    /**
     * The toggle is on screen. `n/a` rather than a failure when the anchor itself is gone: the
     * spacer is declared optional, so losing it costs this one button and never the feature — the
     * stored preference still governs whether marks are drawn (D41).
     */
    ctx.check("toggle is mounted", () => {
      if (ctx.optional.anchor("footerSpacer") === null) {
        return { verdict: "n/a", detail: "this extension has no footer spacer to mount on" };
      }
      return currentIcon?.isConnected
        ? { verdict: "pass", detail: visible ? "on" : "off" }
        : { verdict: "fail", detail: "the toggle is not in the document" };
    });
  },
});
