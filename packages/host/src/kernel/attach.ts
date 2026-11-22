/**
 * The editor context, opt-in per message: Claude Code attaches the open file or the selected lines
 * to every prompt, and with `editor.attach: ask` Rigline holds that back on the panel's own session
 * until the person ticks Rigline's chip (D150).
 *
 * The hold is the panel's own X, `dismissSelection()`, called from a subscriber on the session's
 * `selection` signal, so the panel's state says nothing is attached and every path to its `send`
 * agrees. A tick puts the selection back as the panel would; its next send attaches it, and the
 * session is held again. Every session member named here is asserted at harvest (P1).
 */
import {
  attachableOf,
  type EditorAttach,
  type EditorContextState,
  type EditorSettings,
  type FiberLike,
  type IdentifierTables,
  NO_EDITOR_CONTEXT,
  type Store,
  sameEditorContext,
  sessionGaps,
  store,
} from "@rigline/plugin-api/internal";
import type { Bus, ReactBridge } from "./bridge.ts";
import { findSession, isSignal, type Signal, sessionAbove } from "./models.ts";

/** The anchors the service rests on: where the session is found, and what the stylesheet hides. */
const ANCHORS = ["footerSpacer", "selectionChip", "selectionDivider"] as const;

/** How long Claude Code's chip may stay in the footer with nothing ticked: a new session's seed. */
const GRACE_MS = 500;

/** The members of the panel's session the hold reads and calls. */
interface SelectionSession {
  readonly selection: Signal;
  dismissedSelection: unknown;
  lastSentSelection: unknown;
  dismissSelection(): void;
  applySelectionUpdate(selection: unknown): void;
}

function selectionSessionOf(props: unknown): SelectionSession | null {
  const session = (props as { readonly session?: unknown } | null)?.session;
  if (typeof session !== "object" || session === null) return null;
  const s = session as Record<string, unknown>;
  const shaped =
    isSignal(s.selection) &&
    typeof s.dismissSelection === "function" &&
    typeof s.applySelectionUpdate === "function" &&
    "dismissedSelection" in s &&
    "lastSentSelection" in s;
  return shaped ? (session as unknown as SelectionSession) : null;
}

/** One session the service has subscribed to, and whether the person ticked its selection. */
interface Held {
  readonly session: SelectionSession;
  ticked: boolean;
  stop: (() => void) | null;
}

/** Why this extension cannot have its editor context held, one line per identifier it lacks. */
export function attachGaps(tables: IdentifierTables): string[] {
  const session = sessionGaps(tables, "editorContext").map(
    ({ needs, breaks }) => `the panel session's ${needs} is gone: ${breaks}`,
  );
  const anchors = ANCHORS.filter((name) => (tables.anchorSelectors?.[name] ?? null) === null).map(
    (name) =>
      `anchor "${name}" does not resolve${
        tables.unresolvedAnchors?.[name] ? `: ${tables.unresolvedAnchors[name]}` : ""
      }`,
  );
  return [...session, ...anchors];
}

export interface AttachStats {
  /** Sessions held, counting each new one. */
  readonly sessions: number;
  /** Ticks, and ticked selections that went with a message. */
  readonly ticked: number;
  readonly sent: number;
}

/** What Rigline's chip reads and does. */
export interface AttachView {
  readonly state: Store<EditorContextState>;
  /** Ticks what is available, or holds it again; only for a click a person made (D120). */
  toggle(event: { readonly isTrusted?: unknown }): void;
}

export interface AttachService extends AttachView {
  readonly mode: EditorAttach;
  /** Why nothing is held although the mode asks for it, or null while it holds. */
  readonly idle: string | null;
  readonly stats: AttachStats;
  /** Rigline's editor settings changed: the hold goes in or comes out with the mode. */
  configure(settings: EditorSettings): void;
}

export interface AttachOptions {
  readonly settings: EditorSettings;
  readonly bus: Bus;
  readonly react: Pick<ReactBridge, "onCommit" | "fiberFor">;
  readonly tables: IdentifierTables;
  readonly fail: (reason: string) => void;
}

export function installAttach(options: AttachOptions): AttachService {
  const { bus, react, tables, fail } = options;
  const missing = attachGaps(tables);
  const selector = (name: (typeof ANCHORS)[number]): string => tables.anchorSelectors?.[name] ?? "";
  const state = store<EditorContextState>(NO_EDITOR_CONTEXT);
  const stats = { sessions: 0, ticked: 0, sent: 0 };
  let mode: EditorAttach = "always";
  let idle: string | null = null;
  /** A fault that stopped the hold, which only a reload clears. */
  let broken: string | null = null;
  let stop: (() => void) | null = null;

  /** The hold while it runs: every session it holds, and the one on screen. */
  function hold(): () => void {
    const known = new WeakMap<SelectionSession, Held>();
    // Weak, so a conversation the panel has let go of is not kept alive by being held.
    let all: WeakRef<Held>[] = [];
    const ticked = new Set<Held>();
    let current: Held | null = null;
    let running = true;
    let style: HTMLStyleElement | null = null;
    let grace: ReturnType<typeof setTimeout> | null = null;
    let scheduled = false;

    function read(): EditorContextState {
      if (!running || current === null) return NO_EDITOR_CONTEXT;
      const { session } = current;
      const attached = attachableOf(session.selection.value);
      if (attached !== null) return { available: attached, ticked: true };
      return { available: attachableOf(session.dismissedSelection), ticked: false };
    }

    function publish(): void {
      const next = read();
      if (!sameEditorContext(next, state.get())) state.set(next);
    }

    /** Off the panel's setter: what follows may throw, and must never throw at Claude Code. */
    function schedule(): void {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        guarded("could not follow the session", settle);
      });
    }

    function guarded(what: string, fn: () => void): void {
      try {
        fn();
      } catch (e) {
        halt(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    function untick(held: Held): void {
      held.ticked = false;
      ticked.delete(held);
      if (held.session.selection.value !== undefined) held.session.dismissSelection();
    }

    function onSelection(held: Held): (value: unknown) => void {
      return (value) => {
        if (!running) return;
        try {
          if (value === undefined) {
            // The editor's selection went away, so a tick waits for nothing that comes after.
            if (held.ticked) untick(held);
          } else if (!held.ticked) {
            held.session.dismissSelection();
          }
        } catch (e) {
          // Inside the panel's setter, so reported later and never thrown here.
          const reason = `the hold threw: ${e instanceof Error ? e.message : String(e)}`;
          queueMicrotask(() => halt(reason));
          return;
        }
        schedule();
      };
    }

    function adopt(session: SelectionSession): Held {
      const found = known.get(session);
      if (found !== undefined) return found;
      const held: Held = { session, ticked: false, stop: null };
      known.set(session, held);
      all.push(new WeakRef(held));
      stats.sessions += 1;
      // Called at once with what the session holds now, which holds a seeded selection at once.
      held.stop = session.selection.subscribe(onSelection(held));
      if (style === null) {
        style = document.createElement("style");
        style.setAttribute("data-rigline-style", "attach");
        const chip = selector("selectionChip");
        style.textContent = `${chip}, ${selector("selectionDivider")}:has(+ ${chip}) { display: none !important; }`;
        document.head.appendChild(style);
      }
      return held;
    }

    function find(): void {
      const element = document.querySelector(selector("footerSpacer"));
      if (element === null) return;
      const fiber = react.fiberFor(element) as FiberLike | null;
      // Both halves of React's pair, so a session on its way in is held before it is on screen.
      for (const half of [fiber, fiber?.alternate ?? null]) {
        const session = sessionAbove(half, selectionSessionOf);
        if (session !== null) adopt(session);
      }
      const shown = findSession(fiber, selectionSessionOf);
      // None found keeps the last: the footer comes and goes with the views, the session does not.
      if (shown !== null) current = adopt(shown);
    }

    /** Claude Code's chip in the footer with nothing ticked on screen: the hold has missed it. */
    function stray(): boolean {
      if (document.querySelector(selector("selectionChip")) === null) return false;
      return !(current?.ticked === true && current.session.selection.value !== undefined);
    }

    function settle(): void {
      if (!running) return;
      for (const held of [...ticked]) {
        // Only `send` sets it, and a tick cleared it: the ticked selection has gone (D150).
        if (held.session.lastSentSelection !== undefined) {
          stats.sent += 1;
          untick(held);
        }
      }
      publish();
      if (style !== null && grace === null && stray()) {
        grace = setTimeout(() => {
          grace = null;
          if (running && stray()) {
            halt(
              "Claude Code's chip stayed in the footer with nothing ticked, so the hold is not " +
                "reaching this session; its own chip is back",
            );
          }
        }, GRACE_MS);
      }
    }

    flip = () => {
      if (!running || current === null) return;
      const held = current;
      if (held.ticked) {
        untick(held);
      } else {
        const available = held.session.dismissedSelection;
        if (available === undefined) return;
        held.ticked = true;
        ticked.add(held);
        stats.ticked += 1;
        restore(held.session, available);
      }
      publish();
    };

    const unhook = react.onCommit(() => {
      guarded("could not find the panel's session", find);
      schedule();
    });
    // The panel clears `dismissedSelection` on an empty selection without moving the signal, so a
    // change of the editor's selection is a reason to read the session again.
    const untap = bus.on("selection_changed", () => setTimeout(schedule, 0));
    guarded("could not find the panel's session", find);
    schedule();

    return () => {
      running = false;
      unhook();
      untap();
      if (grace !== null) clearTimeout(grace);
      style?.remove();
      // Back as the panel would have it, so Claude Code's chip shows what is there now.
      for (const ref of all) {
        const held = ref.deref();
        if (held === undefined) continue;
        try {
          held.stop?.();
          const available = held.session.dismissedSelection;
          if (!held.ticked && available !== undefined) restore(held.session, available);
        } catch {
          // Stopping already; the panel keeps whatever it holds.
        }
      }
      all = [];
      ticked.clear();
      current = null;
      flip = () => {};
      state.set(NO_EDITOR_CONTEXT);
    };
  }

  /** The selection put back as the panel's own update would, never counted as sent already. */
  function restore(session: SelectionSession, available: unknown): void {
    session.dismissedSelection = undefined;
    session.lastSentSelection = undefined;
    session.applySelectionUpdate(available);
  }

  /** The chip's tick or untick on the session on screen, while the hold runs. */
  let flip: () => void = () => {};

  function halt(reason: string): void {
    if (broken !== null) return;
    broken = reason;
    idle = reason;
    stop?.();
    stop = null;
    fail(reason);
  }

  const service: AttachService = {
    get mode() {
      return mode;
    },
    get idle() {
      return idle;
    },
    get stats(): AttachStats {
      return { ...stats };
    },
    state,
    toggle(event) {
      if (event.isTrusted !== true) return;
      try {
        flip();
      } catch (e) {
        halt(`a tick threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    configure(settings) {
      mode = settings.attach;
      if (mode === "always") {
        stop?.();
        stop = null;
        idle = null;
        return;
      }
      if (broken !== null) return;
      if (missing.length > 0) {
        idle = `Claude Code's own chip is in place: ${missing.join("; ")}`;
        return;
      }
      idle = null;
      try {
        stop ??= hold();
      } catch (e) {
        halt(`could not start: ${e instanceof Error ? e.message : String(e)}`);
      }
      // A fault while the hold was starting found nothing yet to stop.
      if (broken !== null) {
        stop?.();
        stop = null;
      }
    },
  };
  service.configure(options.settings);
  return service;
}
