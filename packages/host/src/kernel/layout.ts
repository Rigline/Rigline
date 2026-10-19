/**
 * The panel's layout editor (D93): the saved layout the panel shows, a working copy every move
 * changes, and one re-read of `registry.js` shared by Reload, the menu opening and a save's
 * confirmation. Node cannot push into a panel, so it learns of the file by reading it, or from
 * another panel's save (D141).
 */
import {
  type BakedPreset,
  compactRows,
  isApplicable,
  type Layout,
  type LayoutPlugin,
  layoutView,
  OFF,
  rowNumbers,
  rowOf,
  rowPlace,
  type SaveRecord,
  SHIPPED_LAYOUT,
  SIDES,
  type Side,
  type Store,
  sameLayout,
  store,
  type ViewPlace,
  withElementAt,
  withOrder,
} from "@rigline/plugin-api/internal";
import { type Announcer, createSaveTracker, type SavedState, type SaveState } from "./saving.ts";

export type { SavedState, SaveState } from "./saving.ts";

export interface LayoutEditor {
  /** The saved layout the working copy started from. */
  readonly baseline: Store<Layout>;
  readonly working: Store<Layout>;
  /** Every declared element, grouped by where the working copy puts it. */
  readonly view: Store<readonly ViewPlace[]>;
  /** Whether a newer layout is saved behind unsaved changes, which it does not replace. */
  readonly newer: Store<boolean>;
  readonly saving: Store<SaveState>;
  /** Whether the panel is being edited in place (D95). */
  readonly editing: Store<boolean>;
  /** The presets a person can pick here, shipped and their own, each name once (D133). */
  readonly presets: Store<readonly BakedPreset[]>;
  /** How many of their own a bound left out of the bake, for the line that says so. */
  readonly omitted: Store<number>;
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
  /** Moves the row `place` is a side of to be the `to`th of its zone's rows, from 0 (D122, D127). */
  moveRow(place: string, to: number): void;
  /** What `reset` puts in the working copy: the shipped layout, its rows numbered for this panel. */
  readonly shipped: Layout;
  /** The shipped layout in the working copy only (D142). */
  reset(): void;
  /**
   * Shows the named preset's layout in the working copy, which a Save keeps and Revert drops.
   * Does nothing for a name that is not there, or one that could not be read.
   */
  apply(name: string): void;
  /** Reads the saved layout afresh and shows it, dropping unsaved changes. */
  reload(): Promise<void>;
  /** Reads the saved layout afresh and `observe`s it. */
  check(): Promise<void>;
  /**
   * The saved layout, from a read or another panel: shown where nothing is unsaved, and otherwise
   * `newer` says whether it differs from what the copy started from (D126, D141).
   */
  observe(saved: Layout): void;
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
  /** The presets `install` baked beside the layout. */
  readonly presets?: readonly BakedPreset[];
  readonly omitted?: number;
  /**
   * What `registry.js` holds now, read afresh, or null when it cannot be read.
   *
   * The presets come with the layout rather than from a second read: this is the editor's only
   * re-read, so a list fixed at boot would leave Reload refreshing the layout and not the
   * presets, after an export in a terminal that the yellow R has just sent somebody to it.
   */
  readonly readSaved: () => Promise<SavedState | null>;
  /** How a save from here reaches the other panels. */
  readonly announce?: Announcer;
  /** Injected so a test need not wait out the confirmation. */
  readonly wait?: (ms: number) => Promise<void>;
  /** Milliseconds, injected so a test can step past `notice`'s gap. */
  readonly now?: () => number;
}

/** Each read keeps a copy of `registry.js` for the panel's life, so `notice` reads sparingly (D126). */
const NOTICE_GAP_MS = 30_000;

export function createLayoutEditor(options: LayoutEditorOptions): LayoutEditor {
  const { baked, plugins, save, readSaved } = options;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => performance.now());
  let noticed = -Infinity;
  const baseline = store(baked);
  const working = store(baked);
  const view = store<readonly ViewPlace[]>(layoutView(baked, plugins));
  const newer = store(false);
  const tracker = createSaveTracker(readSaved, wait, options.announce);
  const saving = tracker.state;
  const editing = store(false);
  const presets = store<readonly BakedPreset[]>(options.presets ?? []);
  const omitted = store(options.omitted ?? 0);
  const shipped = compactRows(SHIPPED_LAYOUT, plugins);
  working.subscribe(() => view.set(layoutView(working.get(), plugins)));

  /**
   * A move, leaving the rows numbered from one (D122). A save's outcome is about the copy it saved,
   * so it goes once the copy changes.
   */
  function edit(next: Layout): void {
    working.set(compactRows(next, plugins));
    tracker.edited();
  }

  function observe(saved: Layout): void {
    if (sameLayout(working.get(), baseline.get())) {
      if (!sameLayout(saved, baseline.get())) {
        baseline.set(saved);
        working.set(saved);
      }
      newer.set(false);
      return;
    }
    newer.set(!sameLayout(saved, baseline.get()));
  }

  async function check(): Promise<void> {
    // Mid-save the file can hold the copy ahead of the baseline, which is not newer.
    if (saving.get() === "saving") return;
    const saved = await readSaved();
    if (saved !== null) observe(saved.layout);
  }

  return {
    baseline,
    working,
    view,
    newer,
    saving,
    editing,
    presets,
    omitted,
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
      const row = rowOf(place);
      if (row === null) return;
      const groups = view.get();
      const rows = rowNumbers(
        groups.map((g) => g.place),
        row.zone,
      );
      const from = rows.indexOf(row.row);
      const at = Math.max(0, Math.min(to, rows.length - 1));
      if (from === -1 || at === from) return;
      const order = [...rows];
      order.splice(at, 0, ...order.splice(from, 1));
      const shown = (n: number, side: Side): string[] =>
        groups.find((g) => g.place === rowPlace(row.zone, n, side))?.elements.map((e) => e.name) ??
        [];
      let next = working.get();
      order.forEach((moved, i) => {
        const there = rows[i];
        if (there === undefined || moved === there) return;
        // An empty side too, or the row that was here leaves its list behind (D127).
        for (const side of SIDES)
          next = withOrder(next, rowPlace(row.zone, there, side), shown(moved, side));
      });
      edit(next);
    },
    shipped,
    reset() {
      edit(shipped);
    },
    apply(name) {
      const preset = presets.get().find((p) => p.name === name);
      if (preset === undefined || !isApplicable(preset)) return;
      edit(preset.layout);
    },
    async reload() {
      const saved = await readSaved();
      if (saved === null) return;
      baseline.set(saved.layout);
      working.set(saved.layout);
      presets.set(saved.presets);
      omitted.set(saved.omitted);
      newer.set(false);
      saving.set("idle");
    },
    check,
    observe,
    notice() {
      if (newer.get() || now() - noticed < NOTICE_GAP_MS) return;
      noticed = now();
      void check();
    },
    async confirm(copy) {
      const held = await tracker.confirm(
        (saved) => sameLayout(saved.layout, copy),
        (saved) => {
          baseline.set(saved.layout);
          newer.set(false);
        },
        { changed: { layout: copy }, held: (saved) => ({ layout: saved.layout }) },
      );
      // Leaving edit mode is the hold's end (D125); a copy moved since the click is unsaved work,
      // which leaving the mode would hide.
      if (held && sameLayout(working.get(), copy)) editing.set(false);
    },
  };
}
