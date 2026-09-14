/**
 * Host-placed DOM: mounts, their re-placement after a re-render, their ordering, and watches.
 *
 * One `MutationObserver` for every plugin rather than one each. React reconciles only the children
 * it created, so a foreign node appended to a React-owned container tends to survive; the observer
 * covers the case where a parent's whole child list is replaced, and it is what makes `watch`
 * possible without any plugin polling.
 *
 * Several mounts can share one anchor, and the naive insert gives the slot beside the anchor to
 * whichever plugin mounted last, which is decided by load timing and invisible to an author. So a
 * node is positioned against its sibling mounts by registry order, which makes the result the
 * same however the mounts were timed and puts a re-placed node back in the same slot. Every node
 * the host places is stamped `data-rigline-mount="<plugin>"`: attribution in devtools, and what
 * lets the probe assert the ordering without knowing which plugins exist.
 */
import type { Teardown } from "@rigline/plugin-api";

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
  readonly className: string;
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
  /** Hand `onFound` the first element with `className` now and whenever it is replaced. */
  watch(
    className: string,
    onFound: (element: Element) => Teardown | undefined,
    onError: (reason: string) => void,
  ): Teardown;
}

export function createMountService(message: (e: unknown) => string): MountService {
  const active: ActiveMount[] = [];
  const watches: Watch[] = [];

  function place(mount: ActiveMount, node: Element): void {
    node.setAttribute("data-rigline-mount", mount.owner);
    const peers = active
      .filter(
        (m) =>
          m !== mount &&
          m.anchor === mount.anchor &&
          m.placement === mount.placement &&
          m.node.isConnected,
      )
      .sort((a, b) => a.order - b.order);

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
   * re-insert on every mutation forever. Whether a replacement anchor exists is the plugin's
   * question, and `watch` is how it asks.
   */
  function replaceLost(): void {
    for (const m of active) {
      if (m.node.isConnected) continue;
      if (!m.anchor.isConnected) continue;
      try {
        place(m, m.node);
      } catch (e) {
        m.onError(`mount() re-placement threw: ${message(e)}`);
      }
    }
  }

  function runWatch(w: Watch): void {
    const found = document.getElementsByClassName(w.className)[0] ?? null;
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

  new MutationObserver(() => {
    replaceLost();
    for (const w of [...watches]) runWatch(w);
  }).observe(document.body, { childList: true, subtree: true });

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
      place(entry, node);
      active.push(entry);
      return () => {
        const i = active.indexOf(entry);
        if (i !== -1) active.splice(i, 1);
        entry.node.remove();
      };
    },
    watch(className, onFound, onError) {
      const w: Watch = { className, onFound, onError, current: null, teardown: null };
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
