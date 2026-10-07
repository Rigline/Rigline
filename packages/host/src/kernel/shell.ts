/**
 * The shell's kernel half: the menu's contributions, the elements and where each is placed, the RIG
 * pill's place, and loading the root that draws them all (D88, D90). The root is `runtime/shell.js`,
 * loaded rather than bundled here, so failing to load it costs the shell and leaves every plugin
 * running.
 */
import {
  ANCHORS,
  type AnchorName,
  type AnchorSpec,
  type ElementComponent,
  type ElementSpec,
  elementRank,
  type IdentifierTables,
  type Layout,
  type MenuComponent,
  type Placement,
  placeElement,
  placementGap,
  placementLabel,
  placeName,
  placeTitle,
  RIGLINE,
  RIGLINE_ELEMENTS,
  rowNumbers,
  rowOf,
  rowPlace,
  SIDES,
  type Side,
  type Surface,
  store,
  type Teardown,
  ZONES,
  type ZoneName,
} from "@rigline/plugin-api/internal";
import type {
  Contribution,
  PanelPlace,
  PlacedElement,
  RiglineElements,
  StartShell,
} from "../shell/types.ts";
import type { Diagnostics } from "./bridge.ts";
import type { CheckGroup, CheckService } from "./checks.ts";
import type { LayoutEditor } from "./layout.ts";
import type { MountService } from "./mounts.ts";

/** Whose mount the pill and the zones are, in `data-rigline-mount` and in the mount diagnostics. */
const OWNER = RIGLINE;

/** After every plugin's mount at the same anchor, so the pill sits nearest the spacer. */
const PILL_ORDER = Number.MAX_SAFE_INTEGER;

/** How often every check runs, for the pill's count and for Diagnostics alike. */
const POLL_MS = 1000;

export interface ShellState {
  readonly started: boolean;
  readonly error: string | null;
  readonly pill: Element;
}

/**
 * What became of one bound element. `elsewhere` is a placement this surface has not got, which is
 * not a fault; `unavailable` is one this extension or engine cannot provide.
 */
export interface ElementReading {
  readonly state: "placed" | "off" | "elsewhere" | "unavailable";
  readonly detail: string;
}

export interface ShellService {
  contribute(
    owner: string,
    order: number,
    component: MenuComponent,
    onError: (reason: string) => void,
  ): Teardown;
  /**
   * Render `component` where the layout puts the element, or at its default. `index` is its position
   * in the manifest, which orders a plugin's own elements. Throws when `owner` has already bound `id`.
   */
  element(
    owner: string,
    order: number,
    index: number,
    id: string,
    spec: ElementSpec,
    component: ElementComponent,
    onError: (reason: string) => void,
  ): Teardown;
  /** Every bound element, keyed `owner/id`. */
  readonly bound: ReadonlyMap<string, ElementReading>;
  /**
   * Place the pill, load the root, and bind Rigline's own elements at registry order `order`, after
   * every plugin's (D97). Once, after every plugin's `setup` has run.
   */
  start(order: number): Promise<void>;
  readonly state: ShellState;
}

interface Row {
  readonly node: HTMLElement;
  /** Where each side's elements render (D127). */
  readonly sides: Readonly<Record<Side, HTMLElement>>;
  members: number;
  stop: Teardown | null;
}

/** One bound element: what it was bound with, and where it is placed now. */
interface Binding {
  readonly owner: string;
  readonly order: number;
  readonly index: number;
  readonly id: string;
  readonly spec: ElementSpec;
  readonly component: ElementComponent;
  readonly onError: (reason: string) => void;
  /** Its place and rank as one key, and how to take it away; null until first placed. */
  at: { readonly key: string; readonly unplace: Teardown } | null;
}

export function createShellService(
  tables: IdentifierTables,
  surface: Surface,
  editor: LayoutEditor,
  mounts: MountService,
  checks: CheckService,
  diagnostics: Diagnostics,
  fail: (reason: string) => void,
): ShellService {
  const pill = document.createElement("span");
  pill.className = "rigline-slot";
  const state = { started: false, error: null as string | null, pill };
  const entries: (Contribution & { readonly order: number })[] = [];
  const contributions = store<readonly Contribution[]>([]);
  const placed: (PlacedElement & { readonly order: number })[] = [];
  const elements = store<readonly PlacedElement[]>([]);
  const bound = new Map<string, ElementReading>();
  const bindings = new Map<string, Binding>();
  /** Each row, keyed by its own spelling, which is its left side's. */
  const rows = new Map<string, Row>();
  const places = store<readonly PanelPlace[]>([]);
  /** The rows held in place while the panel is edited, so an empty one shows (D95). */
  let held: string[] = [];
  const failing = store(0);
  const ran = store<readonly CheckGroup[]>([]);
  let next = 0;

  function publish(): void {
    contributions.set([...entries].sort((a, b) => a.order - b.order || a.key - b.key));
  }

  function publishElements(): void {
    elements.set([...placed].sort((a, b) => a.order - b.order));
  }

  /** The anchor a placement lands at and its selector, or why it cannot land on this panel. */
  function resolve(
    placement: Placement,
  ): { readonly anchor: string; readonly selector: string } | ElementReading {
    const gap = placementGap(placement, tables);
    if (gap !== null) return { state: "unavailable", detail: gap };
    const anchor =
      typeof placement === "string" ? ZONES[placement as ZoneName].anchor : placement.anchor;
    const spec: AnchorSpec | undefined = ANCHORS[anchor as AnchorName];
    if (spec?.surfaces && !spec.surfaces.includes(surface)) {
      return { state: "elsewhere", detail: `${anchor} is not on the ${surface} surface` };
    }
    const selector = tables.anchorSelectors?.[anchor] ?? null;
    if (!selector) return { state: "unavailable", detail: `anchor "${anchor}" is not one element` };
    return { anchor, selector };
  }

  function unique(anchor: string): boolean {
    return (ANCHORS[anchor as AnchorName] as AnchorSpec | undefined)?.kind === "singleton";
  }

  /** The spelling of the row `place` is a side of. */
  function rowKey(place: string): string {
    const at = rowOf(place);
    return at === null ? place : rowPlace(at.zone, at.row);
  }

  /** The row `place` is a side of, built with both its sides, and that side's node. */
  function rowAt(place: string): { readonly row: Row; readonly side: HTMLElement } {
    const key = rowKey(place);
    let row = rows.get(key);
    if (!row) {
      const node = document.createElement("div");
      node.className = "rigline-zone";
      node.setAttribute("data-rigline-zone", key);
      node.setAttribute("data-rigline-title", placeTitle(key));
      const side = (name: Side): HTMLElement => {
        const div = document.createElement("div");
        div.className = "rigline-side";
        div.setAttribute("data-rigline-side", name);
        return node.appendChild(div);
      };
      row = { node, sides: { left: side("left"), right: side("right") }, members: 0, stop: null };
      rows.set(key, row);
    }
    return { row, side: row.sides[rowOf(place)?.side ?? "left"] };
  }

  /**
   * The node of the side `place` names. Its row is placed while either side has members, and taken
   * out when the last one leaves; rows are kept last in their anchor in number order (D122).
   */
  function join(place: string, anchor: string, selector: string): HTMLElement {
    const { row, side } = rowAt(place);
    row.members += 1;
    if (row.stop === null) {
      const key = rowKey(place);
      const order = rowOf(key)?.row ?? 0;
      row.stop = mounts.watch(
        { anchor, selector, unique: unique(anchor) },
        OWNER,
        (box) =>
          mounts.attach(box, "last", order, OWNER, () => row.node, fail, `the ${key} zone`) ??
          undefined,
        fail,
      );
    }
    return side;
  }

  function leave(place: string): void {
    const row = rows.get(rowKey(place));
    if (!row) return;
    row.members -= 1;
    if (row.members === 0) {
      row.stop?.();
      row.stop = null;
    }
  }

  /**
   * Every place a bound element offers that resolves on this panel, each once. A zone is both sides
   * of each of its rows the working copy shows, then of the next (D122, D127).
   */
  function publishPlaces(): void {
    const shown = editor.view.get().map((g) => g.place);
    const found = new Map<string, PanelPlace>();
    for (const b of bindings.values()) {
      for (const placement of b.spec.placements) {
        if (found.has(placeName(placement))) continue;
        const where = resolve(placement);
        if ("state" in where) continue;
        if (typeof placement !== "string") {
          const place = placeName(placement);
          found.set(place, { place, selector: where.selector, at: placement.at });
          continue;
        }
        const zone = placement as ZoneName;
        const numbers = rowNumbers(shown, zone);
        const next = (numbers.at(-1) ?? 0) + 1;
        for (const n of [...numbers, next]) {
          const { row } = rowAt(rowPlace(zone, n));
          for (const side of SIDES) {
            const place = rowPlace(zone, n, side);
            found.set(place, { place, zone: row.sides[side], row: row.node, fresh: n === next });
          }
        }
      }
    }
    places.set([...found.values()]);
    hold();
  }

  /**
   * Holds every row in place while the panel is edited, and the next row as the target that makes
   * one; lets them go when it is not (D95, D122).
   */
  function hold(): void {
    const want = editor.editing.get() ? places.get().flatMap((p) => ("zone" in p ? [p] : [])) : [];
    const handles = new Set(want.filter((p) => !p.fresh).map((p) => p.row)).size > 1;
    for (const name of held) {
      if (want.some((p) => p.place === name)) continue;
      const node = rows.get(rowKey(name))?.node;
      node?.removeAttribute("data-rigline-editing");
      node?.removeAttribute("data-rigline-handle");
      leave(name);
    }
    const kept = held.filter((name) => want.some((p) => p.place === name));
    for (const p of want) {
      const { node } = rowAt(p.place).row;
      node.setAttribute("data-rigline-editing", "");
      const later = (rowOf(p.place)?.row ?? 1) > 1;
      node.setAttribute(
        "data-rigline-title",
        p.fresh && later ? "New row" : placeTitle(rowKey(p.place)),
      );
      node.toggleAttribute("data-rigline-handle", handles && !p.fresh);
      if (kept.includes(p.place)) continue;
      const where = resolve(rowOf(p.place)?.zone ?? p.place);
      if ("state" in where) continue;
      join(p.place, where.anchor, where.selector);
      kept.push(p.place);
    }
    held = kept;
  }

  function composer(): Element | null {
    const selector = tables.anchorSelectors?.composerBox;
    return selector ? document.querySelector(selector) : null;
  }

  /** Beside the footer spacer where there is one (D54), and in a corner of the panel where not. */
  function place(): void {
    const selector = tables.anchorSelectors?.footerSpacer ?? null;
    const spec: AnchorSpec = ANCHORS.footerSpacer;
    if (selector && (!spec.surfaces || spec.surfaces.includes(surface))) {
      const target = { anchor: "footerSpacer", selector, unique: spec.kind === "singleton" };
      mounts.watch(
        target,
        OWNER,
        (spacer) =>
          mounts.attach(spacer, "before", PILL_ORDER, OWNER, () => pill, fail, "the RIG pill") ??
          undefined,
        fail,
      );
      return;
    }
    pill.classList.add("rigline-pill-fixed");
    mounts.attach(document.body, "inside", PILL_ORDER, OWNER, () => pill, fail, "the RIG pill");
  }

  function poll(): void {
    const groups = checks.run();
    ran.set(groups);
    failing.set(groups.reduce((total, group) => total + group.failing, 0));
  }

  /** Places `b` where `layout` puts it, and does nothing when that has not moved. */
  function settle(name: string, b: Binding, layout: Layout): void {
    const place = placeElement(layout, name, b.spec);
    const rank = elementRank(place, b.order, b.index);
    const key = `${placeName(place.placement)}#${rank}`;
    if (b.at?.key === key) return;
    b.at?.unplace();
    b.at = { key, unplace: placeAt(name, b, place.placement, place.listed, rank) };
  }

  /** Renders `b` at `placement`, recording what became of it; returns how to take it away. */
  function placeAt(
    name: string,
    b: Binding,
    placement: Placement | null,
    listed: number | null,
    rank: number,
  ): Teardown {
    const { owner, id, component, onError } = b;
    if (placement === null) {
      bound.set(name, {
        state: "off",
        detail: listed === null ? "off by default" : "switched off in the layout",
      });
      return () => {};
    }
    // A row the layout lists is its zone's; a manifest names only the zone.
    const where = resolve(
      typeof placement === "string" && listed !== null
        ? (rowOf(placement)?.zone ?? placement)
        : placement,
    );
    if ("state" in where) {
      bound.set(name, where);
      return () => {};
    }
    let target: Element;
    let targetKey: string;
    let unplace: Teardown;
    if (typeof placement === "string") {
      target = join(placement, where.anchor, where.selector);
      targetKey = `zone:${placement}`;
      unplace = () => leave(placement);
    } else {
      const slot = document.createElement("span");
      slot.className = "rigline-slot";
      slot.setAttribute("data-rigline-slot", name);
      target = slot;
      targetKey = `slot:${name}`;
      unplace = mounts.watch(
        { anchor: where.anchor, selector: where.selector, unique: unique(where.anchor) },
        owner,
        (anchor) =>
          mounts.attach(
            anchor,
            placement.at,
            rank,
            owner,
            () => slot,
            onError,
            `element "${id}"`,
          ) ?? undefined,
        onError,
      );
    }
    const entry = { key: next++, owner, id, component, onError, target, targetKey, order: rank };
    placed.push(entry);
    publishElements();
    bound.set(name, { state: "placed", detail: placementLabel(placement) });
    return () => {
      const i = placed.indexOf(entry);
      if (i !== -1) placed.splice(i, 1);
      publishElements();
      unplace();
    };
  }

  editor.working.subscribe(() => {
    const layout = editor.working.get();
    for (const [name, b] of bindings) settle(name, b, layout);
  });
  editor.view.subscribe(publishPlaces);
  editor.editing.subscribe(hold);

  function bind(
    owner: string,
    order: number,
    index: number,
    id: string,
    spec: ElementSpec,
    component: ElementComponent,
    onError: (reason: string) => void,
  ): Teardown {
    const name = `${owner}/${id}`;
    if (bindings.has(name)) throw new Error(`element "${id}" is already bound`);
    const b: Binding = { owner, order, index, id, spec, component, onError, at: null };
    bindings.set(name, b);
    settle(name, b, editor.working.get());
    publishPlaces();
    return () => {
      if (bindings.get(name) !== b) return;
      b.at?.unplace();
      bindings.delete(name);
      bound.delete(name);
      publishPlaces();
    };
  }

  return {
    contribute(owner, order, component, onError) {
      const entry = { key: next++, owner, order, component, onError };
      entries.push(entry);
      publish();
      return () => {
        const i = entries.indexOf(entry);
        if (i === -1) return;
        entries.splice(i, 1);
        publish();
      };
    },
    element: bind,
    bound,
    async start(order) {
      place();
      poll();
      setInterval(poll, POLL_MS);
      // Coming back to the panel is when a layout saved in another window can matter (D126).
      const notice = (): void => {
        if (document.visibilityState === "visible") editor.notice();
      };
      addEventListener("focus", notice);
      document.addEventListener("visibilitychange", notice);
      document.documentElement.addEventListener("pointerenter", notice);
      const layer = document.createElement("div");
      layer.setAttribute("data-rigline-layer", "");
      document.body.appendChild(layer);
      try {
        const shell = (await import(new URL("./runtime/shell.js", import.meta.url).href)) as {
          startShell?: StartShell;
          riglineElements?: RiglineElements;
        };
        if (typeof shell.startShell !== "function") {
          throw new Error("runtime/shell.js exports no startShell");
        }
        shell.startShell({
          pill,
          layer,
          contributions,
          elements,
          failing,
          checks: ran,
          diagnostics,
          surface,
          editor,
          readings: bound,
          places,
          composer,
          onError: fail,
        });
        state.started = true;
        const own = shell.riglineElements?.(editor) ?? {};
        Object.entries(RIGLINE_ELEMENTS).forEach(([id, spec], index) => {
          const component = own[id];
          if (component) bind(RIGLINE, order, index, id, spec, component, fail);
        });
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e);
        fail(`the shell did not load: ${state.error}`);
      }
    },
    state,
  };
}
