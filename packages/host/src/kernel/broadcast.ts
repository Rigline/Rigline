/**
 * Telling the other panels a save happened (D141), on the channel they share. A hint that shortens
 * the wait for the look-on-focus read and is never relied on in its place.
 */
import {
  type Layout,
  type RiglineSettings,
  readLayout,
  readModelSettings,
  sameValue,
} from "@rigline/plugin-api/internal";
import type { Peers } from "./peers.ts";
import { type Announcer, CONFIRM_FOR_MS, type Changed, type SavedState } from "./saving.ts";

type Type = "saving" | "saved";
type Section = Readonly<Record<string, unknown>>;

/** Everything a body can name, as this panel holds it now. */
export type Held = Pick<SavedState, "layout" | "settings" | "rigline">;

export interface Broadcast extends Announcer {
  /**
   * `read`, with each value another panel's save is writing in place of the file's while the file
   * still holds what this panel had before it was told: that is the write not having landed.
   */
  seen<T extends Held>(read: T): T;
  /** Starts hearing other panels' saves, which `apply` takes as a read of the keys they name. */
  listen(current: () => Held, apply: (changed: Changed) => void): void;
}

export interface BroadcastOptions {
  readonly peers: Peers;
  /** Milliseconds, injected so a test can step past an optimistic value's life. */
  readonly now?: () => number;
}

/** One value a body names: the layout, a plugin's section, or a block of Rigline's own. */
type Place =
  readonly ["layout"] | readonly ["settings", string] | readonly ["rigline", keyof RiglineSettings];

interface Optimistic {
  readonly place: Place;
  readonly value: unknown;
  readonly before: unknown;
  readonly until: number;
}

const EMPTY: Section = Object.freeze({});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function placesOf(changed: Changed): [Place, unknown][] {
  const places: [Place, unknown][] = [];
  if (changed.layout !== undefined) places.push([["layout"], changed.layout]);
  for (const [name, section] of Object.entries(changed.settings ?? {})) {
    places.push([["settings", name], section]);
  }
  if (changed.rigline?.model !== undefined) {
    places.push([["rigline", "model"], changed.rigline.model]);
  }
  return places;
}

function valueAt(held: Held, place: Place): unknown {
  if (place[0] === "layout") return held.layout;
  if (place[0] === "settings") {
    return Object.hasOwn(held.settings, place[1]) ? held.settings[place[1]] : EMPTY;
  }
  return held.rigline[place[1]];
}

function withValue<T extends Held>(held: T, place: Place, value: unknown): T {
  if (place[0] === "layout") return { ...held, layout: value as Layout };
  if (place[0] === "settings") {
    return { ...held, settings: { ...held.settings, [place[1]]: value as Section } };
  }
  return { ...held, rigline: { ...held.rigline, [place[1]]: value } };
}

/** What a body says changed, or why it does not hold — naming a field, never a value. */
function readChanged(body: unknown): Changed | string {
  if (!isRecord(body)) return "a body that is not an object";
  const changed: {
    layout?: Layout;
    settings?: Record<string, Section>;
    rigline?: RiglineSettings;
  } = {};
  if (body.layout !== undefined) {
    const layout = readLayout(body.layout, "layout");
    if (typeof layout === "string") return "a layout that does not hold";
    changed.layout = layout;
  }
  if (body.settings !== undefined) {
    if (!isRecord(body.settings)) return "settings that do not hold";
    const sections = Object.entries(body.settings);
    if (!sections.every((entry): entry is [string, Section] => isRecord(entry[1]))) {
      return "settings that do not hold";
    }
    changed.settings = Object.fromEntries(sections);
  }
  if (body.rigline !== undefined) {
    if (!isRecord(body.rigline)) return "Rigline's settings that do not hold";
    if (body.rigline.model !== undefined) {
      const model = readModelSettings(body.rigline.model);
      if ("problem" in model) return "Rigline's model settings that do not hold";
      changed.rigline = { model: model.settings };
    }
  }
  return changed;
}

export function createBroadcast(options: BroadcastOptions): Broadcast {
  const { peers } = options;
  const now = options.now ?? (() => performance.now());
  const optimistic = new Map<string, Optimistic>();

  function post(type: Type, changed: Changed): void {
    if (placesOf(changed).length > 0) peers.post(type, changed);
  }

  return {
    saving: (changed) => post("saving", changed),
    saved: (changed) => post("saved", changed),
    seen(read) {
      let seen = read;
      const at = now();
      for (const [key, held] of optimistic) {
        const file = valueAt(read, held.place);
        if (at < held.until && sameValue(file, held.before) && !sameValue(file, held.value)) {
          seen = withValue(seen, held.place, held.value);
        } else {
          optimistic.delete(key);
        }
      }
      return seen;
    },
    listen(current, apply) {
      const take = (type: Type) => (changed: Changed) => {
        const held = current();
        for (const [place, value] of placesOf(changed)) {
          const key = JSON.stringify(place);
          if (type === "saved") optimistic.delete(key);
          else {
            const before = valueAt(held, place);
            optimistic.set(key, { place, value, before, until: now() + CONFIRM_FOR_MS });
          }
        }
        apply(changed);
      };
      peers.on("saving", readChanged, take("saving"));
      peers.on("saved", readChanged, take("saved"));
    },
  };
}
