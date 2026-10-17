/**
 * Where a save from this panel stands, for the layout editor and the settings screen alike (D93).
 * Nothing can push into a panel, so a save is confirmed by reading `registry.js` again until it holds
 * what was sent, and one that never does says so rather than going quiet.
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
  ): Promise<boolean>;
}

/** A save is the engine starting, one edit and a re-inject: a few seconds, rarely more. */
const CONFIRM_EVERY_MS = 500;
const CONFIRM_FOR_MS = 20_000;
/** How long "Saved." shows before it goes (D125). */
const SAVED_MS = 1500;

export function createSaveTracker(
  readSaved: () => Promise<SavedState | null>,
  wait: (ms: number) => Promise<void>,
): SaveTracker {
  const state = store<SaveState>("idle");
  return {
    state,
    edited() {
      if (state.get() !== "saving") state.set("idle");
    },
    async confirm(landed, then) {
      state.set("saving");
      for (let waited = 0; waited < CONFIRM_FOR_MS; waited += CONFIRM_EVERY_MS) {
        await wait(CONFIRM_EVERY_MS);
        const saved = await readSaved();
        if (saved === null || !landed(saved)) continue;
        then(saved);
        state.set("saved");
        await wait(SAVED_MS);
        // An edit or a Reload during the hold has ended it already.
        if (state.get() !== "saved") return false;
        state.set("idle");
        return true;
      }
      state.set("unconfirmed");
      return false;
    },
  };
}
