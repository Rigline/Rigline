/**
 * Telling the other panels a save happened (D141): a `BroadcastChannel` every editor-tab panel on
 * this machine shares, under a name `install` derives from the token. A hint that shortens the wait
 * for the look-on-focus read and is never relied on in its place, so whatever arrives that this
 * version does not understand is dropped and counted, and the read covers it.
 */
import {
  type Layout,
  RIGLINE,
  type RiglineSettings,
  readLayout,
  readModelSettings,
  sameValue,
} from "@rigline/plugin-api/internal";
import type { Diagnostics } from "./bridge.ts";
import { type Announcer, CONFIRM_FOR_MS, type Changed, type SavedState } from "./saving.ts";

export const BROADCAST_VERSION = 1;

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
  close(): void;
}

export interface BroadcastOptions {
  /** The channel's name from `registry.js`, or null where there is no token and so no save. */
  readonly name: string | null;
  readonly counts: Diagnostics["broadcast"];
  readonly fail: (reason: string) => void;
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

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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

/** The envelope's type and what it says changed, or why it was dropped. */
function readMessage(data: unknown, self: string): { type: Type; changed: Changed } | string {
  if (!isRecord(data)) return "a message that is not an object";
  if (data.v !== BROADCAST_VERSION) return "an unknown version";
  if (typeof data.from !== "string") return "no sender";
  if (data.from === self) return "its own message";
  if (data.ns !== RIGLINE) return "an unknown namespace";
  if (data.type !== "saving" && data.type !== "saved") return "an unknown type";
  const changed = readChanged(data.body);
  return typeof changed === "string" ? changed : { type: data.type, changed };
}

/** Random per panel and never kept: a panel only has to know itself within its own life. */
function senderId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createBroadcast(options: BroadcastOptions): Broadcast {
  const { name, counts, fail } = options;
  const now = options.now ?? (() => performance.now());
  const from = senderId();
  const optimistic = new Map<string, Optimistic>();
  let channel: BroadcastChannel | null = null;
  if (name !== null) {
    try {
      channel = new BroadcastChannel(name);
      counts.open = true;
    } catch (e) {
      fail(`the channel did not open: ${message(e)}`);
    }
  }

  function drop(reason: string): void {
    counts.dropped += 1;
    counts.lastDrop = reason;
  }

  function post(type: Type, changed: Changed): void {
    if (channel === null || placesOf(changed).length === 0) return;
    try {
      channel.postMessage({ v: BROADCAST_VERSION, from, ns: RIGLINE, type, body: changed });
      counts.posted += 1;
    } catch (e) {
      fail(`a save could not be told to the other panels: ${message(e)}`);
    }
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
      if (channel === null) return;
      channel.onmessage = (event: MessageEvent) => {
        const read = readMessage(event.data, from);
        if (typeof read === "string") {
          drop(read);
          return;
        }
        counts.heard += 1;
        const held = current();
        for (const [place, value] of placesOf(read.changed)) {
          const key = JSON.stringify(place);
          if (read.type === "saved") optimistic.delete(key);
          else {
            const before = valueAt(held, place);
            optimistic.set(key, { place, value, before, until: now() + CONFIRM_FOR_MS });
          }
        }
        try {
          apply(read.changed);
        } catch (e) {
          fail(`a save from another panel: ${message(e)}`);
        }
      };
      channel.onmessageerror = () => drop("a message that could not be read");
    },
    close() {
      channel?.close();
      channel = null;
    },
  };
}
