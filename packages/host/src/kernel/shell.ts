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
  type Surface,
  store,
  type Teardown,
  ZONES,
  type ZoneName,
} from "@rigline/plugin-api";
import type {
  Contribution,
  PanelPlace,
  PlacedElement,
  RiglineElements,
  StartShell,
} from "../shell/types.ts";
import type { CheckService } from "./checks.ts";
import type { LayoutEditor } from "./layout.ts";
import type { MountService } from "./mounts.ts";

/** Whose mount the pill and the zones are, in `data-rigline-mount` and in the mount diagnostics. */
const OWNER = RIGLINE;

/** After every plugin's mount at the same anchor, so the pill sits nearest the spacer. */
const PILL_ORDER = Number.MAX_SAFE_INTEGER;

/** How often the failing count on the pill is refreshed, which is how often every check runs. */
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

interface Zone {
  readonly node: HTMLElement;
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
  const zones = new Map<string, Zone>();
  const places = store<readonly PanelPlace[]>([]);
  /** The zones held in place while the panel is edited, so an empty one shows (D95). */
  let held: string[] = [];
  const failing = store(0);
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

  function zoneOf(name: string): Zone {
    let zone = zones.get(name);
    if (!zone) {
      const node = document.createElement("div");
      node.className = "rigline-zone";
      node.setAttribute("data-rigline-zone", name);
      node.setAttribute("data-rigline-title", placeTitle(name));
      zone = { node, members: 0, stop: null };
      zones.set(name, zone);
    }
    return zone;
  }

  /** The zone's node, placed while it has members and taken out when the last one leaves. */
  function join(name: string, anchor: string, selector: string): HTMLElement {
    const zone = zoneOf(name);
    zone.members += 1;
    if (zone.stop === null) {
      const { node } = zone;
      zone.stop = mounts.watch(
        { anchor, selector, unique: unique(anchor) },
        OWNER,
        (box) =>
          mounts.attach(box, "last", PILL_ORDER, OWNER, () => node, fail, `the ${name} zone`) ??
          undefined,
        fail,
      );
    }
    return zone.node;
  }

  function leave(name: string): void {
    const zone = zones.get(name);
    if (!zone) return;
    zone.members -= 1;
    if (zone.members === 0) {
      zone.stop?.();
      zone.stop = null;
    }
  }

  /** Every place a bound element offers that resolves on this panel, each once. */
  function publishPlaces(): void {
    const found = new Map<string, PanelPlace>();
    for (const b of bindings.values()) {
      for (const placement of b.spec.placements) {
        const place = placeName(placement);
        if (found.has(place)) continue;
        const where = resolve(placement);
        if ("state" in where) continue;
        found.set(
          place,
          typeof placement === "string"
            ? { place, zone: zoneOf(placement).node }
            : { place, selector: where.selector, at: placement.at },
        );
      }
    }
    places.set([...found.values()]);
  }

  function hold(): void {
    for (const p of places.get()) {
      if (!("zone" in p)) continue;
      const where = resolve(p.place);
      if ("state" in where) continue;
      join(p.place, where.anchor, where.selector).setAttribute("data-rigline-editing", "");
      held.push(p.place);
    }
  }

  function release(): void {
    for (const name of held) {
      zones.get(name)?.node.removeAttribute("data-rigline-editing");
      leave(name);
    }
    held = [];
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
    failing.set(checks.run().reduce((total, group) => total + group.failing, 0));
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
    const where = resolve(placement);
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
  editor.editing.subscribe(() => (editor.editing.get() ? hold() : release()));

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
