/**
 * The panel's layout editor (D93): the saved layout the panel shows, a working copy every move
 * changes, and one re-read of `registry.js` shared by Reload, the menu opening and a save's
 * confirmation. Nothing can push into a panel, so everything it learns about the file it pulls.
 */
import {
  type Layout,
  type LayoutPlugin,
  layoutView,
  type SaveRecord,
  type Store,
  sameLayout,
  store,
  type ViewPlace,
  withElementAt,
  withOrder,
} from "@rigline/plugin-api";

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
  /** What Save goes through, or null where `install` baked nothing. */
  readonly save: SaveRecord | null;
  /** Moves `name` last into `place`, or back to its default where `place` is null. */
  move(name: string, place: string | null): void;
  /** Swaps `name` with its neighbour in the order its place shows. */
  shift(name: string, by: -1 | 1): void;
  /** Reads the saved layout afresh and shows it, dropping unsaved changes. */
  reload(): Promise<void>;
  /** Reads the saved layout afresh and says whether it moved since this panel's baseline. */
  check(): Promise<void>;
  /** After a Save click: waits for `registry.js` to hold `copy`, then makes it the baseline. */
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
}

/** A save is the engine starting, one edit and a re-inject: a few seconds, rarely more. */
const CONFIRM_EVERY_MS = 500;
const CONFIRM_FOR_MS = 20_000;

export function createLayoutEditor(options: LayoutEditorOptions): LayoutEditor {
  const { baked, plugins, save, readSaved } = options;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseline = store(baked);
  const working = store(baked);
  const view = store(layoutView(baked, plugins));
  const newer = store(false);
  const saving = store<SaveState>("idle");
  working.subscribe(() => view.set(layoutView(working.get(), plugins)));

  /** A move: a save's outcome is about the copy it saved, so it goes once the copy changes. */
  function edit(next: Layout): void {
    working.set(next);
    if (saving.get() !== "saving") saving.set("idle");
  }

  return {
    baseline,
    working,
    view,
    newer,
    saving,
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
    async reload() {
      const saved = await readSaved();
      if (saved === null) return;
      baseline.set(saved);
      working.set(saved);
      newer.set(false);
      saving.set("idle");
    },
    async check() {
      const saved = await readSaved();
      newer.set(saved !== null && !sameLayout(saved, baseline.get()));
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
          return;
        }
      }
      saving.set("unconfirmed");
    },
  };
}
