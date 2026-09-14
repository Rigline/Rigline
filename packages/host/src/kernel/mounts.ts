/**
 * Host-placed DOM: mounts, their re-placement after a re-render, their ordering, and watches.
 *
 * **One pass per React commit, for every plugin, rather than an observer each or an observer at
 * all** (D52). React reconciles only the children it created, so a foreign node appended to a
 * React-owned container tends to survive; what does not survive is a parent whose whole child list
 * is replaced, or an anchor element swapped for a new one, and both of those *are* React commits.
 * The pre hook already taps the devtools hook and notifies its handlers once per frame, so this
 * subscribes to the signal itself rather than to a proxy for it, and gets the coalescing for free.
 * It is also what makes `watch` possible without any plugin polling.
 *
 * What that replaced was a `MutationObserver` over `document.body` with `subtree: true`. It cost a
 * discarded record for every childList change in the document, scanned every active mount and ran a
 * query per watch on every mutation batch — with one mount per transcript row and sessions
 * measured 319 rows deep — and, worst, it mutated the DOM from inside its own callback. A
 * MutationObserver callback is a microtask, so insertions that never stick re-queue it without the
 * event loop ever getting a turn. An observer survives only as the fallback below, for a webview
 * where no React renderer ever injected, and it schedules the same per-frame pass rather than
 * working in its own callback.
 *
 * Several mounts can share one anchor, and the naive insert gives the slot beside the anchor to
 * whichever plugin mounted last, which is decided by load timing and invisible to an author. So a
 * node is positioned against its sibling mounts by registry order, which makes the result the
 * same however the mounts were timed and puts a re-placed node back in the same slot. Every node
 * the host places is stamped `data-rigline-mount="<plugin>"`: attribution in devtools, and what
 * lets the probe assert the ordering without knowing which plugins exist.
 */
import type { Teardown } from "@rigline/plugin-api";
import type { Diagnostics, ReactBridge } from "./bridge.ts";

export type Placement = "inside" | "after";

interface ActiveMount {
  /** What the node is positioned by: its parent when "inside", its predecessor when "after". */
  readonly anchor: Element;
  readonly placement: Placement;
  readonly order: number;
  readonly owner: string;
  /** Built once, by `attach`, and re-placed rather than rebuilt. See `replaceLost`. */
  readonly node: Element;
  readonly onError: (reason: string) => void;
}

interface Watch {
  /** A resolved anchor selector, not a class: which element the anchor means is the table's answer. */
  readonly selector: string;
  readonly onFound: (element: Element) => Teardown | undefined;
  readonly onError: (reason: string) => void;
  current: Element | null;
  teardown: Teardown | null;
}

export interface MountService {
  /** Build, place and keep `build()`'s node at `anchor`. Null when `build()` threw (already reported). */
  attach(
    anchor: Element,
    placement: Placement,
    order: number,
    owner: string,
    build: () => Element,
    onError: (reason: string) => void,
    called: string,
  ): Teardown | null;
  /** Hand `onFound` the first element matching `selector` now and whenever it is replaced. */
  watch(
    selector: string,
    onFound: (element: Element) => Teardown | undefined,
    onError: (reason: string) => void,
  ): Teardown;
}

export function createMountService(
  message: (e: unknown) => string,
  react: ReactBridge,
  diagnostics: Diagnostics["mounts"],
  meter: (name: string) => void,
): MountService {
  const active: ActiveMount[] = [];
  /** `active` indexed by anchor, so positioning a node costs its own anchor's mounts, not all of
   * them. The array scan this replaces was O(N) per placement and so O(N²) per rebuild, which at one
   * mount per transcript row is the difference between a few operations and a hundred thousand. */
  const byAnchor = new Map<Element, ActiveMount[]>();
  const watches: Watch[] = [];

  function peersOf(mount: ActiveMount): ActiveMount[] {
    return (byAnchor.get(mount.anchor) ?? [])
      .filter((m) => m !== mount && m.placement === mount.placement && m.node.isConnected)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Whether `mount`'s node already sits where `place` would put it, so `place` can be a no-op.
   *
   * The two placements are judged differently, and the asymmetry is the point rather than an
   * oversight. An `after` mount is a decoration *of* its anchor — a badge beside the model pill —
   * and being one element further along is already the bug this exists to catch, so it must follow
   * its predecessor immediately. An `inside` mount was only ever asked to be *within* the anchor;
   * the append that placed it there was a convention, not a promise. Holding it to "still last"
   * would have the host re-appending it every time React added a child of its own, once per mount
   * per frame, with one mount per transcript row.
   *
   * Element siblings, not node siblings: a text node appearing between a mount and its predecessor
   * is not drift, and treating it as drift would mean a DOM write every frame for as long as it
   * stayed there.
   */
  function positioned(mount: ActiveMount): boolean {
    if (!mount.node.isConnected) return false;
    const peers = peersOf(mount);
    if (mount.placement === "after") {
      const predecessor = peers.filter((m) => m.order < mount.order).at(-1)?.node ?? mount.anchor;
      return mount.node.previousElementSibling === predecessor;
    }
    if (mount.node.parentNode !== mount.anchor) return false;
    const later = peers.find((m) => m.order > mount.order);
    if (!later) return true;
    return (
      (mount.node.compareDocumentPosition(later.node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
  }

  function place(mount: ActiveMount, node: Element): void {
    node.setAttribute("data-rigline-mount", mount.owner);
    const peers = peersOf(mount);

    if (mount.placement === "after") {
      const earlier = peers.filter((m) => m.order < mount.order);
      (earlier.at(-1)?.node ?? mount.anchor).after(node);
      return;
    }
    const later = peers.find((m) => m.order > mount.order);
    if (later) mount.anchor.insertBefore(node, later.node);
    else mount.anchor.appendChild(node);
  }

  /**
   * Put back every mount a re-render detached, re-inserting the node rather than building a new one.
   *
   * React removing a foreign child detaches the node; it does not destroy it, and a detached node
   * keeps its listeners, its attributes and whatever state the plugin hung on it. So the node goes
   * back exactly as it was, and `build()` is called precisely once per mount, by `attach`.
   *
   * Rebuilding was the obvious implementation and was wrong in a way that only shows up in a
   * plugin: it makes the node a plugin holds a reference to silently stale, so every plugin with
   * per-node state has to notice re-placement and re-attach to the new node. Two first-party
   * plugins got that wrong in different ways — one tracked the current node by hand, the other
   * leaked two document-level listeners belonging to a pop-up whose badge had been replaced
   * underneath it — which is a hazard in the capability rather than two bugs in the plugins.
   *
   * An anchor that has left the document takes its mount with it, and is skipped: retrying would
   * re-insert on every pass forever. Whether a replacement anchor exists is the plugin's question,
   * and `watch` is how it asks.
   *
   * **Position, not merely presence.** A mount whose node is still connected but whose anchor was
   * *moved* rather than replaced is stranded where the anchor used to be, and the first version of
   * this skipped it for exactly that reason. It is the 0.x prototype's vanishing session-id pill
   * (docs/archive/0.x/vanishing-session-id-pill.md) and it reproduced here the same way: an
   * attachment chip in the composer reorders the footer row, the model pill goes to the end of it,
   * and every decoration anchored to the pill stays behind. Silently and permanently, because
   * `watch` only re-anchors when the pill's *identity* changes and a move does not change it.
   *
   * So every mount with a live anchor is asked whether it is still where it belongs, and `place`
   * runs only when the answer is no. `positioned` is what keeps that affordable.
   *
   * **Both counters exist to answer whether this function should exist** (D52). `replaced`
   * accumulates re-placements that reconnected the node. `lost` is a gauge, recounted every pass
   * rather than accumulated, of mounts still detached from a live anchor afterwards — `place` can
   * fail silently as well as loudly, since `after()` on a parentless node is a no-op by
   * specification and `insertBefore` throws when the peer it positions against is not the anchor's
   * child. A `lost` that stays above zero is a node nobody can see being retried every frame.
   */
  function replaceLost(): void {
    let lost = 0;
    for (const m of active) {
      // An anchor that has left the document takes its mount with it. Whether a replacement anchor
      // exists is the plugin's question, and `watch` is how it asks.
      if (!m.anchor.isConnected) continue;
      if (positioned(m)) continue;
      const wasConnected = m.node.isConnected;
      try {
        place(m, m.node);
      } catch (e) {
        m.onError(`mount() re-placement threw: ${message(e)}`);
      }
      if (!m.node.isConnected) {
        lost += 1;
      } else if (wasConnected) {
        diagnostics.moved += 1;
        meter("move");
      } else {
        diagnostics.replaced += 1;
        meter("replace");
      }
    }
    diagnostics.lost = lost;
    diagnostics.active = active.length;
  }

  function runWatch(w: Watch): void {
    // `querySelector`, and the selector comes from the anchor table, because a class is a look and
    // not an identity (D7): `modelPill_gGYT1w` is on the model picker and on the agent-map button
    // alike, and `getElementsByClassName(...)[0]` handed three first-party decorations to whichever
    // of them React happened to render first.
    const found = document.querySelector(w.selector);
    if (found === w.current && (found === null || found.isConnected)) return;
    if (w.teardown) {
      const off = w.teardown;
      w.teardown = null;
      try {
        off();
      } catch (e) {
        w.onError(`watch() teardown threw: ${message(e)}`);
      }
    }
    w.current = found;
    if (!found) return;
    try {
      w.teardown = w.onFound(found) ?? null;
    } catch (e) {
      w.onError(`watch() handler threw: ${message(e)}`);
    }
  }

  /** Everything a re-render can invalidate, in one place, once per frame. */
  function pass(): void {
    replaceLost();
    for (const w of [...watches]) runWatch(w);
  }

  react.onCommit(pass);

  /**
   * The fallback for a webview no React renderer ever injected into, where nothing would otherwise
   * ever call `pass`. Settled here because post.ts is imported at the tail of the bundle, after
   * `createRoot().render()`, by which point a renderer that is going to inject has done so; and the
   * cost of being wrong runs the safe way, since an unnecessary observer only schedules a pass that
   * finds nothing to do, while a missing one would leave mounts detached for good.
   *
   * It schedules rather than works. Coalescing to a frame is what keeps a callback's own insertions
   * from re-entering it, which is the hazard that took the document-wide observer out of the design.
   */
  if (react.rendererVersion() === null) {
    diagnostics.driver = "observer";
    let scheduled = false;
    const schedule = (): void => {
      if (scheduled) return;
      scheduled = true;
      const run = (): void => {
        scheduled = false;
        pass();
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
      else setTimeout(run, 16);
    };
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }

  return {
    attach(anchor, placement, order, owner, build, onError, called) {
      let node: Element;
      try {
        node = build();
      } catch (e) {
        onError(`${called} build() threw: ${message(e)}`);
        return null;
      }
      const entry: ActiveMount = { anchor, placement, order, owner, node, onError };
      const peers = byAnchor.get(anchor);
      if (peers) peers.push(entry);
      else byAnchor.set(anchor, [entry]);
      place(entry, node);
      active.push(entry);
      diagnostics.active = active.length;
      return () => {
        const i = active.indexOf(entry);
        if (i !== -1) active.splice(i, 1);
        const siblings = byAnchor.get(anchor);
        if (siblings) {
          const j = siblings.indexOf(entry);
          if (j !== -1) siblings.splice(j, 1);
          // Dropped rather than left empty: an anchor's own lifetime is React's, and a map keyed on
          // elements that keeps the last entry for each would hold every transcript row the session
          // has ever rendered.
          if (siblings.length === 0) byAnchor.delete(anchor);
        }
        diagnostics.active = active.length;
        entry.node.remove();
      };
    },
    watch(selector, onFound, onError) {
      const w: Watch = { selector, onFound, onError, current: null, teardown: null };
      watches.push(w);
      runWatch(w);
      return () => {
        const i = watches.indexOf(w);
        if (i !== -1) watches.splice(i, 1);
        w.current = null;
        if (w.teardown) {
          const off = w.teardown;
          w.teardown = null;
          off();
        }
      };
    },
  };
}
