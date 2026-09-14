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

export type Placement = "inside" | "after" | "before";

/**
 * Consecutive passes of the same corrective action before the host concludes it is losing and
 * stops. Roughly half a second at 60fps: long enough that a boot settling, or a re-render storm
 * while a session loads, passes through untouched; short enough that a real fight costs a flicker
 * rather than a panel. See `abandon` (D54).
 */
const THRASH_LIMIT = 30;

interface ActiveMount {
  /** What the node is positioned by: its parent when "inside", its sibling otherwise. */
  readonly anchor: Element;
  readonly placement: Placement;
  readonly order: number;
  readonly owner: string;
  /** Built once, by `attach`, and re-placed rather than rebuilt. See `replaceLost`. */
  readonly node: Element;
  readonly onError: (reason: string) => void;
  /** Consecutive passes that found this mount out of position. Reset the moment one does not. */
  streak: number;
  /** Set once the streak ran out: the host has stopped re-placing this node. */
  abandoned: boolean;
}

/** What an anchor resolved to, and what it claims about itself, as `watch` needs them. */
export interface WatchTarget {
  /** The anchor's name. Diagnostics only: what the DOM is queried with is the selector. */
  readonly anchor: string;
  /** A resolved selector, not a class: which element the anchor means is the table's answer. */
  readonly selector: string;
  /** Whether more than one match is a fault, which is exactly what `kind: "singleton"` claims. */
  readonly unique: boolean;
}

interface Watch {
  readonly target: WatchTarget;
  readonly owner: string;
  readonly onFound: (element: Element) => Teardown | undefined;
  readonly onError: (reason: string) => void;
  current: Element | null;
  teardown: Teardown | null;
  /** Consecutive passes that re-anchored this watch. Reset the moment one has nothing to do. */
  streak: number;
  /** Set once the streak ran out: the host has stopped re-anchoring this watch. */
  abandoned: boolean;
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
  /** Hand `onFound` the first element `target` matches now and whenever it is replaced. */
  watch(
    target: WatchTarget,
    owner: string,
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
   * The sibling placements and `inside` are judged differently, and the asymmetry is the point
   * rather than an oversight. An `after` or `before` mount is a decoration *of* its anchor — a badge
   * beside the model pill, a badge at the end of the footer's left cluster — and being one element
   * further along is already the bug this exists to catch, so it must be adjacent to its neighbour.
   * An `inside` mount was only ever asked to be *within* the anchor; the append that placed it there
   * was a convention, not a promise. Holding it to "still last" would have the host re-appending it
   * every time React added a child of its own, once per mount per frame, with one mount per
   * transcript row.
   *
   * Element siblings, not node siblings: a text node appearing between a mount and its neighbour
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
    if (mount.placement === "before") {
      const successor = peers.find((m) => m.order > mount.order)?.node ?? mount.anchor;
      return mount.node.nextElementSibling === successor;
    }
    if (mount.node.parentNode !== mount.anchor) return false;
    const later = peers.find((m) => m.order > mount.order);
    if (!later) return true;
    return (
      (mount.node.compareDocumentPosition(later.node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
  }

  /**
   * Registry order reads the same way for both sibling placements: left to right, lowest order
   * first. So an `after` mount is positioned against the nearest *earlier* peer and falls back to
   * the anchor, and a `before` mount against the nearest *later* one — which puts the highest order
   * immediately before the anchor and keeps `anchor A B C` and `A B C anchor` consistent.
   */
  function place(mount: ActiveMount, node: Element): void {
    node.setAttribute("data-rigline-mount", mount.owner);
    const peers = peersOf(mount);

    if (mount.placement === "after") {
      const earlier = peers.filter((m) => m.order < mount.order);
      (earlier.at(-1)?.node ?? mount.anchor).after(node);
      return;
    }
    if (mount.placement === "before") {
      (peers.find((m) => m.order > mount.order)?.node ?? mount.anchor).before(node);
      return;
    }
    const later = peers.find((m) => m.order > mount.order);
    if (later) mount.anchor.insertBefore(node, later.node);
    else mount.anchor.appendChild(node);
  }

  /**
   * Stop taking a corrective action that is not working, and say so once (D54).
   *
   * The host has exactly two: put this mount back where it belongs, and re-anchor this watch to the
   * element that replaced its own. Either one repeated on `THRASH_LIMIT` consecutive passes without
   * the next pass finding nothing to do means something is undoing it as fast as it is done, and
   * repeating it faster is not a way to win. The reproducing case is a decoration inside a container
   * whose owner measures its children: the measurement reflows, the reflow moves the anchor, the
   * host follows, following re-triggers the measurement (D54). The host cannot see any of that, only
   * that it keeps acting and the world keeps not being as it left it.
   *
   * The node is taken out of the document rather than left where it last landed. A frozen mount is
   * usually mid-oscillation and half of that cycle has it inside a container the app is about to
   * unmount, so leaving it puts a ghost on screen in a place nobody chose; removing it makes one
   * decoration disappear, which the diagnostics and the console then account for. It is reported
   * through the plugin's own `onError`, which disables that plugin rather than the panel — the
   * plugin asked for a position the host cannot hold, and that is its problem to have (D27).
   */
  function abandon(what: string, owner: string, node: Element | null, fail: (r: string) => void) {
    diagnostics.abandoned.push(`${owner}: ${what}`);
    node?.remove();
    fail(
      `${what} was re-placed ${THRASH_LIMIT} passes running without settling, so Rigline stopped; ` +
        `the app is very likely moving it back (see decisions.md D54)`,
    );
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
   *
   * **A mount the host cannot keep in place is given up on** (D54). A pass that finds a mount
   * already positioned clears its streak, so only an unbroken run of corrections counts, and a mount
   * whose anchor has left the document is skipped without counting — that is the app's business and
   * `watch`'s question, not a fight.
   */
  function replaceLost(): void {
    let lost = 0;
    // Collected rather than abandoned in place, and left null while there is nothing to collect:
    // `abandon` reports through the plugin's `onError`, which disables the plugin and runs its
    // teardowns, and a mount teardown splices `active` — which is the array being walked. The
    // common pass allocates nothing.
    let giveUp: ActiveMount[] | null = null;
    for (const m of active) {
      // An anchor that has left the document takes its mount with it. Whether a replacement anchor
      // exists is the plugin's question, and `watch` is how it asks.
      if (!m.anchor.isConnected) continue;
      if (positioned(m)) {
        m.streak = 0;
        continue;
      }
      if (m.abandoned) continue;
      m.streak += 1;
      if (m.streak > THRASH_LIMIT) {
        m.abandoned = true;
        if (giveUp === null) giveUp = [];
        giveUp.push(m);
        continue;
      }
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
    if (giveUp) {
      for (const m of giveUp) {
        abandon(`the mount ${m.placement} its anchor`, m.owner, m.node, m.onError);
      }
      diagnostics.active = active.length;
    }
  }

  /**
   * An anchor that claims to name one element, matching several.
   *
   * The peak is kept rather than the latest, because the count drops back as soon as the second
   * control unmounts and a gauge that healed itself would leave nothing to find. Warned once per
   * anchor, at the level it deserves: nothing has thrown and the panel is fine, but a decoration
   * may be on the wrong control, and that is worth a line in the console the first time and never
   * once a frame.
   */
  function reportMultiple(anchor: string, count: number): void {
    const previous = diagnostics.multiple[anchor] ?? 0;
    if (count <= previous) return;
    diagnostics.multiple[anchor] = count;
    if (previous === 0) {
      console.warn(
        `[rigline] anchor "${anchor}" names one element, and ${count} match it in this panel; a decoration may be on the wrong one`,
      );
    }
  }

  function runWatch(w: Watch): void {
    // The selector comes from the anchor table, because a class is a look and not an identity (D7):
    // `modelPill_gGYT1w` is on the model picker and on the agent-map button alike, and
    // `getElementsByClassName(...)[0]` handed three first-party decorations to whichever of them
    // React happened to render first.
    //
    // `querySelectorAll` rather than `querySelector` for the count, which is the runtime half of
    // the same question: the site count taken at build time says how many places the bundle applies
    // a class, and only this says how many elements a refinement actually leaves on screen. It is
    // the same one query per watch per pass, and there are a handful of watches.
    if (w.abandoned) return;
    const matches = document.querySelectorAll(w.target.selector);
    const found = matches[0] ?? null;
    if (w.target.unique && matches.length > 1) reportMultiple(w.target.anchor, matches.length);
    if (found === w.current && (found === null || found.isConnected)) {
      w.streak = 0;
      return;
    }
    // A re-anchor, as against a first resolution or an anchor going away: the element this watch
    // was bound to has been swapped for another. It is the corrective action the host takes here,
    // and so the one that can be fought (D54) — and the one the mount counters cannot see, because
    // it tears one mount down and attaches another rather than moving a node. The reproducing case
    // ran at one re-anchor per frame with `moved` and `replaced` both flat.
    if (found !== null && w.current !== null) {
      meter("rebind");
      w.streak += 1;
      if (w.streak > THRASH_LIMIT) {
        w.abandoned = true;
        abandon(`the watch on anchor "${w.target.anchor}"`, w.owner, null, w.onError);
        return;
      }
    }
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
      const entry: ActiveMount = {
        anchor,
        placement,
        order,
        owner,
        node,
        onError,
        streak: 0,
        abandoned: false,
      };
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
    watch(target, owner, onFound, onError) {
      const w: Watch = {
        target,
        owner,
        onFound,
        onError,
        current: null,
        teardown: null,
        streak: 0,
        abandoned: false,
      };
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
