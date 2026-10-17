/**
 * Where a save from this panel stands, for the layout editor and the settings screen alike (D93).
 * Nothing can push into a panel from Node, so a save is confirmed by reading `registry.js` again until
 * it holds what was sent, and one that never does says so rather than going quiet. The other panels
 * are told as it starts and again as it ends (D141).
 */
import {
  type BakedPreset,
  type Layout,
  type RiglineSettings,
  type Store,
  store,
} from "@rigline/plugin-api/internal";

export type SaveState = "idle" | "saving" | "saved" | "unconfirmed";

/** What a re-read of `registry.js` yields. */
export interface SavedState {
  readonly layout: Layout;
  readonly presets: readonly BakedPreset[];
  readonly omitted: number;
  /** Every plugin's settings, by plugin name (D138). */
  readonly settings: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Rigline's own settings. */
  readonly rigline: RiglineSettings;
}

/** The part of a read one save wrote: a key that is absent is unchanged. */
export interface Changed {
  readonly layout?: Layout;
  readonly settings?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly rigline?: Partial<RiglineSettings>;
}

/** How a save reaches the other panels (D141). */
export interface Announcer {
  /** What a save is writing, before the file holds it. */
  saving(changed: Changed): void;
  /** What the file held of the same keys once that save settled, whether it landed or not. */
  saved(changed: Changed): void;
}

export const NO_ANNOUNCER: Announcer = { saving() {}, saved() {} };

/** What one save writes, and how to read the same keys out of the file. */
export interface Sent {
  readonly changed: Changed;
  readonly held: (saved: SavedState) => Changed;
}

export interface SaveTracker {
  readonly state: Store<SaveState>;
  /** The copy moved: an outcome is about the copy it saved, so it goes, and a save in flight stays. */
  edited(): void;
  /**
   * After a Save click: re-reads until `landed` says the file holds what was sent, hands that read
   * to `then`, and holds `saved` for a moment. Resolves true when the hold ran out with nothing
   * having ended it, false when something did or the file never held it.
   */
  confirm(
    landed: (saved: SavedState) => boolean,
    then: (saved: SavedState) => void,
    sent: Sent,
  ): Promise<boolean>;
}

/** A save is the engine starting, one edit and a re-inject: a few seconds, rarely more. */
const CONFIRM_EVERY_MS = 500;
export const CONFIRM_FOR_MS = 20_000;
/** How long "Saved." shows before it goes (D125). */
const SAVED_MS = 1500;

export function createSaveTracker(
  readSaved: () => Promise<SavedState | null>,
  wait: (ms: number) => Promise<void>,
  announce: Announcer = NO_ANNOUNCER,
): SaveTracker {
  const state = store<SaveState>("idle");
  return {
    state,
    edited() {
      if (state.get() !== "saving") state.set("idle");
    },
    async confirm(landed, then, sent) {
      state.set("saving");
      announce.saving(sent.changed);
      let last: SavedState | null = null;
      for (let waited = 0; waited < CONFIRM_FOR_MS; waited += CONFIRM_EVERY_MS) {
        await wait(CONFIRM_EVERY_MS);
        const saved = await readSaved();
        if (saved === null) continue;
        last = saved;
        if (!landed(saved)) continue;
        then(saved);
        announce.saved(sent.held(saved));
        state.set("saved");
        await wait(SAVED_MS);
        // An edit or a Reload during the hold has ended it already.
        if (state.get() !== "saved") return false;
        state.set("idle");
        return true;
      }
      if (last !== null) announce.saved(sent.held(last));
      state.set("unconfirmed");
      return false;
    },
  };
}
