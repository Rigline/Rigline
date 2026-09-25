/**
 * The transcript as the host sees it: which rows are entries, when each happened, and the
 * decorations plugins have asked to draw on them.
 *
 * Three facts are joined here and none is where you would first look. A row's own `timestamp` is
 * the moment the row object was built, not the moment the message happened, so it is never read.
 * The real times arrive on the bus in two carriers, `get_session_response` (the transcript as it
 * was on disk) and `io_message` (everything since). And the DOM carries no identity, so a row is
 * matched to its message through the fiber react-dom keeps on the element (D103).
 * `@rigline/plugin-api` owns the three derivations; this owns the plumbing and the cost.
 *
 * Rows are keyed by index upstream, so React reuses one element for a different message when the
 * list is spliced. Identity is therefore re-read from scratch on every sweep, and plugins are
 * handed data, never elements.
 */
import {
  entriesDiffer,
  type FiberLike,
  messageTimes,
  rowIdentity,
  type Teardown,
  type TranscriptEntry,
} from "@rigline/plugin-api";
import type { Bus, Diagnostics, ReactBridge } from "./bridge.ts";
import type { MountService } from "./mounts.ts";

export type Decorate = (
  entry: TranscriptEntry,
  entries: readonly TranscriptEntry[],
) => Element | null;

interface Decorator {
  readonly plugin: string;
  readonly order: number;
  readonly build: Decorate;
  readonly onError: (reason: string) => void;
  readonly mounts: Teardown[];
}

export interface TranscriptService {
  /** Whether the React renderer ever injected into the hook; without it no row can be identified. */
  available(): boolean;
  /** Start decorating; returns the removal, which also removes every node this decorator placed. */
  decorate(
    plugin: string,
    order: number,
    build: Decorate,
    onError: (reason: string) => void,
  ): Teardown;
}

/**
 * How many message times to keep. A panel switches sessions for the life of the window, so this is
 * the one structure that grows with use rather than with the transcript on screen. Oldest out.
 */
const TIME_LIMIT = 20000;

/** The message types that carry real times; the transcript contract declares the same two. */
const TIME_CARRIERS = ["get_session_response", "io_message"] as const;

export function createTranscriptService(
  bus: Bus,
  react: ReactBridge,
  mounts: MountService,
  diagnostics: Diagnostics["transcript"],
  rowSelector: string | null,
  message: (e: unknown) => string,
  meter: (name: string) => void,
): TranscriptService {
  const times = new Map<string, number>();
  const decorators: Decorator[] = [];
  let entries: readonly TranscriptEntry[] = [];
  let elements: readonly Element[] = [];
  let watching = false;
  let scheduled = false;

  function capTimes(): void {
    while (times.size > TIME_LIMIT) {
      const oldest = times.keys().next();
      if (oldest.done) return;
      times.delete(oldest.value);
    }
  }

  /** One sweep soon, however many reasons arrive first: commits are already per frame, and a burst of bus messages costs one. */
  function scheduleSweep(): void {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      sweep();
    });
  }

  function sweep(): void {
    if (!rowSelector || decorators.length === 0) return;
    const found: TranscriptEntry[] = [];
    const rows: Element[] = [];
    // The anchor's resolved selector, so the candidates are rows rather than everything wearing the
    // row's class (D7). The fiber check below would have dropped a stray anyway — a class proposes
    // and the fiber disposes — but paying for a wrong candidate on every sweep, several hundred
    // rows deep, is a cost with nothing on the other side of it.
    for (const row of document.querySelectorAll(rowSelector)) {
      const identity = rowIdentity(react.fiberFor(row) as FiberLike | null);
      if (!identity) continue;
      found.push({ ...identity, at: times.get(identity.id) ?? null, index: found.length });
      rows.push(row);
    }
    diagnostics.sweeps++;
    meter("sweep");
    diagnostics.entries = found.length;
    diagnostics.timed = found.reduce((n, e) => n + (e.at === null ? 0 : 1), 0);

    if (!entriesDiffer(entries, found)) return;
    entries = found;
    elements = rows;
    diagnostics.rebuilds++;
    meter("rebuild");
    for (const decorator of [...decorators]) redecorate(decorator);
  }

  /** Tear down one decorator's nodes and build them again against the current entries. Rebuilt rather than diffed: the list changes once per message, not once per commit. */
  function redecorate(decorator: Decorator): void {
    for (const off of decorator.mounts.splice(0)) off();
    for (const [index, entry] of entries.entries()) {
      let node: unknown;
      try {
        node = decorator.build(entry, entries);
      } catch (e) {
        decorator.onError(`decorateTranscript() build() threw: ${message(e)}`);
        return;
      }
      if (node === null || node === undefined) continue;
      if (!(node instanceof Element)) {
        decorator.onError(
          `decorateTranscript() build() returned ${typeof node}, not an element or null`,
        );
        return;
      }
      const placed = node;
      const row = elements[index];
      if (!row) continue;
      const off = mounts.attach(
        row,
        "inside",
        decorator.order,
        decorator.plugin,
        () => placed,
        decorator.onError,
        "decorateTranscript()",
      );
      if (off) decorator.mounts.push(off);
    }
  }

  function watch(): void {
    if (watching) return;
    watching = true;
    for (const type of TIME_CARRIERS) {
      bus.on(type, (payload) => {
        let changed = false;
        for (const { id, at } of messageTimes(payload)) {
          if (times.get(id) === at) continue;
          times.set(id, at);
          changed = true;
        }
        if (!changed) return;
        capTimes();
        scheduleSweep();
      });
    }
    react.onCommit(scheduleSweep);
  }

  return {
    available: () => react.rendererVersion() !== null && rowSelector !== null,
    decorate(plugin, order, build, onError) {
      const decorator: Decorator = { plugin, order, build, onError, mounts: [] };
      decorators.push(decorator);
      watch();
      // A decorator arriving changes what belongs on screen even when the entry list has not
      // moved, and the list is what the sweep compares against: forget it so the sweep redraws.
      entries = [];
      scheduleSweep();
      return () => {
        const i = decorators.indexOf(decorator);
        if (i !== -1) decorators.splice(i, 1);
        for (const off of decorator.mounts.splice(0)) off();
      };
    },
  };
}
