/**
 * The panel's layout editor (D93): the saved layout the panel shows, a working copy every move
 * changes, and one re-read of `registry.js` shared by Reload, the menu opening and a save's
 * confirmation. Nothing can push into a panel, so everything it learns about the file it pulls.
 */
import {
  compactRows,
  type Layout,
  type LayoutPlugin,
  layoutView,
  OFF,
  rowOf,
  type SaveRecord,
  type Store,
  sameLayout,
  store,
  type ViewPlace,
  withElementAt,
  withOrder,
} from "@rigline/plugin-api/internal";

/** Where a save from this panel stands. */
export type SaveState = "idle" | "saving" | "saved" | "unconfirmed";

export interface LayoutEditor {
  /** The saved layout the working copy started from. */
  readonly baseline: Store<Layout>;
  readonly working: Store<Layout>;
  /** Every declared element, grouped by where the working copy puts it. */
  readonly view: Store<readonly ViewPlace[]>;
  /** Whether the saved layout, when last read, differed from the baseline. */
  readonly newer: Store<boolean>;
  readonly saving: Store<SaveState>;
  /** Whether the panel is being edited in place (D95). */
  readonly editing: Store<boolean>;
  /** What Save goes through, or null where `install` baked nothing. */
  readonly save: SaveRecord | null;
  /** Moves `name` last into `place`, or back to its default where `place` is null. */
  move(name: string, place: string | null): void;
  /** Swaps `name` with its neighbour in the order its place shows. */
  shift(name: string, by: -1 | 1): void;
  /**
   * Puts `name` before the element at `index` in the order `place` shows now, counting `name` where
   * it is already there; switches it off where `place` is off (D95).
   */
  drop(name: string, place: string, index: number): void;
  /** Moves the row `place` to be the `to`th of its zone's rows, counting from 0 (D122). */
  moveRow(place: string, to: number): void;
  /** Every element back where its plugin puts it, in the working copy only. */
  reset(): void;
  /** Reads the saved layout afresh and shows it, dropping unsaved changes. */
  reload(): Promise<void>;
  /** Reads the saved layout afresh and says whether it moved since this panel's baseline. */
  check(): Promise<void>;
  /** The person is back at the panel: a `check`, unless one ran lately or there is no need (D126). */
  notice(): void;
  /**
   * After a Save click: waits for `registry.js` to hold `copy`, makes it the baseline, and holds
   * `saved` for a moment before leaving edit mode.
   */
  confirm(copy: Layout): Promise<void>;
}

export interface LayoutEditorOptions {
  readonly baked: Layout;
  readonly plugins: readonly LayoutPlugin[];
  readonly save: SaveRecord | null;
  /** The layout `registry.js` holds now, read afresh, or null when it cannot be read. */
  readonly readSaved: () => Promise<Layout | null>;
  /** Injected so a test need not wait out the confirmation. */
  readonly wait?: (ms: number) => Promise<void>;
  /** Milliseconds, injected so a test can step past `notice`'s gap. */
  readonly now?: () => number;
}

/** A save is the engine starting, one edit and a re-inject: a few seconds, rarely more. */
const CONFIRM_EVERY_MS = 500;
const CONFIRM_FOR_MS = 20_000;
/** How long "Saved." shows before it goes, taking edit mode with it (D125). */
const SAVED_MS = 1500;
/** Each read keeps a copy of `registry.js` for the panel's life, so `notice` reads sparingly (D126). */
const NOTICE_GAP_MS = 30_000;

export function createLayoutEditor(options: LayoutEditorOptions): LayoutEditor {
  const { baked, plugins, save, readSaved } = options;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => performance.now());
  let noticed = -Infinity;
  const baseline = store(baked);
  const working = store(baked);
  const view = store(layoutView(baked, plugins));
  const newer = store(false);
  const saving = store<SaveState>("idle");
  const editing = store(false);
  working.subscribe(() => view.set(layoutView(working.get(), plugins)));

  /**
   * A move, leaving the rows numbered from one (D122). A save's outcome is about the copy it saved,
   * so it goes once the copy changes.
   */
  function edit(next: Layout): void {
    working.set(compactRows(next, plugins));
    if (saving.get() !== "saving") saving.set("idle");
  }

  async function check(): Promise<void> {
    // Mid-save the file can hold the copy ahead of the baseline, which is not newer.
    if (saving.get() === "saving") return;
    const saved = await readSaved();
    newer.set(saved !== null && !sameLayout(saved, baseline.get()));
  }

  return {
    baseline,
    working,
    view,
    newer,
    saving,
    editing,
    save,
    move(name, place) {
      edit(withElementAt(working.get(), name, place));
    },
    shift(name, by) {
      const group = view.get().find((p) => p.elements.some((e) => e.name === name));
      if (!group) return;
      const names = group.elements.map((e) => e.name);
      const from = names.indexOf(name);
      const to = from + by;
      if (to < 0 || to >= names.length) return;
      names[from] = names[to] as string;
      names[to] = name;
      edit(withOrder(working.get(), group.place, names));
    },
    drop(name, place, index) {
      const shown =
        view
          .get()
          .find((p) => p.place === place)
          ?.elements.map((e) => e.name) ?? [];
      const from = shown.indexOf(name);
      if (place === OFF) {
        if (from === -1) edit(withElementAt(working.get(), name, OFF));
        return;
      }
      const names = shown.filter((n) => n !== name);
      const at = from !== -1 && from < index ? index - 1 : index;
      names.splice(Math.max(0, Math.min(at, names.length)), 0, name);
      if (from !== -1 && names.every((n, i) => n === shown[i])) return;
      edit(withOrder(working.get(), place, names));
    },
    moveRow(place, to) {
      const zone = rowOf(place)?.zone;
      const rows = view.get().filter((g) => zone !== undefined && rowOf(g.place)?.zone === zone);
      const from = rows.findIndex((g) => g.place === place);
      const at = Math.max(0, Math.min(to, rows.length - 1));
      if (from === -1 || at === from) return;
      const order = [...rows];
      order.splice(at, 0, ...order.splice(from, 1));
      let next = working.get();
      order.forEach((row, i) => {
        const there = rows[i];
        if (there === undefined || row === there) return;
        next = withOrder(
          next,
          there.place,
          row.elements.map((e) => e.name),
        );
      });
      edit(next);
    },
    reset() {
      edit({});
    },
    async reload() {
      const saved = await readSaved();
      if (saved === null) return;
      baseline.set(saved);
      working.set(saved);
      newer.set(false);
      saving.set("idle");
    },
    check,
    notice() {
      if (newer.get() || now() - noticed < NOTICE_GAP_MS) return;
      noticed = now();
      void check();
    },
    async confirm(copy) {
      saving.set("saving");
      for (let waited = 0; waited < CONFIRM_FOR_MS; waited += CONFIRM_EVERY_MS) {
        await wait(CONFIRM_EVERY_MS);
        const saved = await readSaved();
        if (saved !== null && sameLayout(saved, copy)) {
          baseline.set(saved);
          newer.set(false);
          saving.set("saved");
          await wait(SAVED_MS);
          // A move or a Reload during the hold has ended it already.
          if (saving.get() !== "saved") return;
          saving.set("idle");
          // A copy moved since the click is unsaved work, which leaving the mode would hide.
          if (sameLayout(working.get(), copy)) editing.set(false);
          return;
        }
      }
      saving.set("unconfirmed");
    },
  };
}
