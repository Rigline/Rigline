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
  type IdentifierTables,
  type MenuComponent,
  type Placement,
  placementGap,
  placementLabel,
  type Surface,
  store,
  type Teardown,
  ZONES,
  type ZoneName,
} from "@rigline/plugin-api";
import type { Contribution, PlacedElement, StartShell } from "../shell/types.ts";
import type { CheckService } from "./checks.ts";
import type { MountService } from "./mounts.ts";

/** Whose mount the pill and the zones are, in `data-rigline-mount` and in the mount diagnostics. */
const OWNER = "rigline";

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
   * Render `component` at the element's default placement. `index` is its position in the manifest,
   * which orders a plugin's own elements. Throws when `owner` has already bound `id`.
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
  /** Place the pill and load the root. Once, after every plugin's `setup` has run. */
  start(): Promise<void>;
  readonly state: ShellState;
}

interface Zone {
  readonly node: HTMLElement;
  members: number;
  stop: Teardown | null;
}

export function createShellService(
  tables: IdentifierTables,
  surface: Surface,
  mounts: MountService,
  checks: CheckService,
  fail: (reason: string) => void,
): ShellService {
  const pill = document.createElement("span");
  const state = { started: false, error: null as string | null, pill };
  const entries: (Contribution & { readonly order: number })[] = [];
  const contributions = store<readonly Contribution[]>([]);
  const placed: (PlacedElement & { readonly order: number })[] = [];
  const elements = store<readonly PlacedElement[]>([]);
  const bound = new Map<string, ElementReading>();
  const zones = new Map<string, Zone>();
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

  /** The zone's node, placed while it has members and taken out when the last one leaves. */
  function join(name: string, anchor: string, selector: string): HTMLElement {
    let zone = zones.get(name);
    if (!zone) {
      const node = document.createElement("div");
      node.className = "rigline-zone";
      node.setAttribute("data-rigline-zone", name);
      zone = { node, members: 0, stop: null };
      zones.set(name, zone);
    }
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
    element(owner, order, index, id, spec, component, onError) {
      const name = `${owner}/${id}`;
      if (bound.has(name)) throw new Error(`element "${id}" is already bound`);
      const placement = spec.default;
      if (placement === null) {
        bound.set(name, { state: "off", detail: "off by default" });
        return () => bound.delete(name);
      }
      const where = resolve(placement);
      if ("state" in where) {
        bound.set(name, where);
        return () => bound.delete(name);
      }
      // A plugin's own elements between its registry slot and the next plugin's, in manifest order,
      // so two of them at one anchor never claim the same position.
      const rank = order + index / 1024;
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
        bound.delete(name);
        const i = placed.indexOf(entry);
        if (i !== -1) placed.splice(i, 1);
        publishElements();
        unplace();
      };
    },
    bound,
    async start() {
      place();
      poll();
      setInterval(poll, POLL_MS);
      const layer = document.createElement("div");
      layer.setAttribute("data-rigline-layer", "");
      document.body.appendChild(layer);
      try {
        const shell = (await import(new URL("./runtime/shell.js", import.meta.url).href)) as {
          startShell?: StartShell;
        };
        if (typeof shell.startShell !== "function") {
          throw new Error("runtime/shell.js exports no startShell");
        }
        shell.startShell({ pill, layer, contributions, elements, failing, onError: fail });
        state.started = true;
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e);
        fail(`the shell did not load: ${state.error}`);
      }
    },
    state,
  };
}
