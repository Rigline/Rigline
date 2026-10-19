/**
 * The layout editor's logic (D93): moves on the working copy, and the re-read of `registry.js` that
 * Reload, the menu opening and a save's confirmation share. The re-read and the wait are injected,
 * so the twenty seconds a confirmation may take cost nothing here.
 */
import {
  type BakedPreset,
  type Layout,
  type LayoutPlugin,
  NO_MODEL_SETTINGS,
  SHIPPED_LAYOUT,
} from "@rigline/plugin-api/internal";
import { describe, expect, it } from "vitest";
import { createLayoutEditor } from "../src/kernel/layout.ts";
import type { Changed } from "../src/kernel/saving.ts";

const spacer = { anchor: "footerSpacer", at: "before" } as const;
const plugins: LayoutPlugin[] = [
  {
    name: "session-id",
    elements: {
      "short-id": { title: "Session id", placements: [spacer, "rigRow"], default: spacer },
      address: { title: "Messaging address", placements: ["rigRow"], default: null },
    },
  },
  {
    name: "clock",
    elements: { face: { title: "Clock", placements: ["rigRow"], default: "rigRow" } },
  },
];

/**
 * `saved` yields the layout a re-read finds, as every test before presets wrote it; `presets` is
 * what the same read carries beside it, which is how Reload refreshes the list (D133).
 */
function editor(
  baked: Layout,
  saved: () => Layout | null = () => baked,
  wait: (ms: number) => Promise<void> = async () => {},
  now?: () => number,
  presets: readonly BakedPreset[] = [],
  savedPresets: () => readonly BakedPreset[] = () => presets,
) {
  let reads = 0;
  const made = createLayoutEditor({
    baked,
    plugins,
    save: null,
    presets,
    readSaved: async () => {
      reads++;
      const layout = saved();
      return layout === null
        ? null
        : {
            layout,
            presets: savedPresets(),
            omitted: 0,
            settings: {},
            rigline: { model: NO_MODEL_SETTINGS },
          };
    },
    wait,
    now,
  });
  return { editor: made, reads: () => reads };
}

/** A preset as the registry carries it. */
function preset(name: string, layout: Layout, extra: Partial<BakedPreset> = {}): BakedPreset {
  return {
    name,
    origin: "yours",
    description: `About ${name}.`,
    problem: null,
    layout,
    ...extra,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("moves", () => {
  it("changes the working copy and the view, and leaves the baseline", () => {
    const { editor: e } = editor({});
    e.move("session-id/address", "rigRow");
    expect(e.working.get()).toEqual({ rigRow: ["session-id/address"] });
    expect(e.baseline.get()).toEqual({});
    const rigRow = e.view.get().find((p) => p.place === "rigRow");
    expect(rigRow?.elements.map((el) => el.name)).toEqual(["session-id/address", "clock/face"]);
  });

  it("shifts an element within the order its place shows, listing that place", () => {
    const { editor: e } = editor({ rigRow: ["session-id/address"] });
    e.shift("clock/face", -1);
    expect(e.working.get()).toEqual({ rigRow: ["clock/face", "session-id/address"] });
    e.shift("clock/face", -1);
    expect(e.working.get()).toEqual({ rigRow: ["clock/face", "session-id/address"] });
  });

  it("resets the working copy to the shipped layout, and leaves the baseline", () => {
    const baked = { rigRow: ["session-id/address"], off: ["clock/face"] };
    const { editor: e } = editor(baked);
    e.reset();
    // These plugins show nothing in the second row, so it goes, as any empty row does (D122).
    const { rigRow, "rigRow right": right } = SHIPPED_LAYOUT;
    expect(e.working.get()).toEqual({ rigRow, "rigRow right": right });
    expect(e.working.get()).toEqual(e.shipped);
    expect(e.baseline.get()).toEqual(baked);
    // A plugin the shipped layout does not name is at its default, after the listed elements.
    const first = e.view.get().find((p) => p.place === "rigRow");
    expect(first?.elements.map((el) => el.name)).toEqual([
      "session-id/short-id",
      "session-id/address",
      "clock/face",
    ]);
  });

  it("puts an element back at its default", () => {
    const { editor: e } = editor({ off: ["session-id/short-id"] });
    e.move("session-id/short-id", null);
    expect(e.working.get()).toEqual({});
  });
});

describe("dropping", () => {
  it("writes the whole order of the place, listing the elements there at their default", () => {
    const { editor: e } = editor({});
    e.drop("session-id/short-id", "rigRow", 0);
    expect(e.working.get()).toEqual({ rigRow: ["session-id/short-id", "clock/face"] });
    e.drop("session-id/short-id", "rigRow", 2);
    expect(e.working.get()).toEqual({ rigRow: ["clock/face", "session-id/short-id"] });
  });

  it("counts the element's own position when it moves within its place", () => {
    const { editor: e } = editor({ rigRow: ["session-id/address"] });
    e.drop("session-id/address", "rigRow", 2);
    expect(e.working.get()).toEqual({ rigRow: ["clock/face", "session-id/address"] });
  });

  it("changes nothing when dropped where it started", () => {
    const baked = { rigRow: ["session-id/address"] };
    const { editor: e } = editor(baked);
    e.drop("session-id/address", "rigRow", 0);
    e.drop("session-id/address", "rigRow", 1);
    expect(e.working.get()).toBe(baked);
  });

  it("switches off, and leaves an element that is off already", () => {
    const { editor: e } = editor({});
    e.drop("session-id/address", "off", 0);
    expect(e.working.get()).toEqual({});
    e.drop("clock/face", "off", 0);
    expect(e.working.get()).toEqual({ off: ["clock/face"] });
  });
});

describe("rows", () => {
  it("makes a row of a drop on the next one, and takes away a row a move empties", () => {
    const { editor: e } = editor({});
    e.drop("session-id/short-id", "rigRow 2", 0);
    expect(e.working.get()).toEqual({ "rigRow 2": ["session-id/short-id"] });
    e.drop("clock/face", "rigRow 2", 0);
    expect(e.working.get()).toEqual({ rigRow: ["clock/face", "session-id/short-id"] });
  });

  it("numbers the rows left from one", () => {
    const { editor: e } = editor({ "rigRow 2": ["session-id/address"] });
    e.move("clock/face", "off");
    expect(e.working.get()).toEqual({ rigRow: ["session-id/address"], off: ["clock/face"] });
  });

  it("moves a row, listing the elements there at their default", () => {
    const baked = { "rigRow 2": ["session-id/address"] };
    const { editor: e } = editor(baked);
    e.moveRow("rigRow 2", 0);
    expect(e.working.get()).toEqual({
      rigRow: ["session-id/address"],
      "rigRow 2": ["clock/face"],
    });
    e.moveRow("rigRow", 5);
    expect(e.working.get()).toEqual({
      rigRow: ["clock/face"],
      "rigRow 2": ["session-id/address"],
    });
    const now = e.working.get();
    e.moveRow("rigRow 2", 1);
    e.moveRow("off", 0);
    expect(e.working.get()).toBe(now);
  });

  it("moves a row with both its sides, named by either", () => {
    const { editor: e } = editor({
      "rigRow right": ["session-id/address"],
      "rigRow 2": ["session-id/short-id"],
    });
    e.moveRow("rigRow 2", 0);
    expect(e.working.get()).toEqual({
      rigRow: ["session-id/short-id"],
      "rigRow 2": ["clock/face"],
      "rigRow 2 right": ["session-id/address"],
    });
    e.moveRow("rigRow 2 right", 0);
    expect(e.working.get()).toEqual({
      rigRow: ["clock/face"],
      "rigRow right": ["session-id/address"],
      "rigRow 2": ["session-id/short-id"],
    });
  });

  it("keeps a row that shows only its right side, and drops one a move leaves empty", () => {
    const { editor: e } = editor({});
    e.drop("session-id/short-id", "rigRow 2 right", 0);
    expect(e.working.get()).toEqual({ "rigRow 2 right": ["session-id/short-id"] });
    e.move("session-id/short-id", "rigRow right");
    expect(e.working.get()).toEqual({ "rigRow right": ["session-id/short-id"] });
  });
});

describe("the saved layout", () => {
  it("is shown when the file moved and nothing here is unsaved (D141)", async () => {
    let saved: Layout = {};
    const { editor: e } = editor({}, () => saved);
    await e.check();
    expect(e.newer.get()).toBe(false);
    saved = { off: ["clock/face"] };
    await e.check();
    expect(e.newer.get()).toBe(false);
    expect(e.baseline.get()).toEqual(saved);
    expect(e.working.get()).toEqual(saved);
  });

  it("is only said to be newer behind unsaved changes, which it leaves alone", async () => {
    let saved: Layout = {};
    const { editor: e } = editor({}, () => saved);
    e.move("session-id/address", "rigRow");
    const copy = e.working.get();
    saved = { off: ["clock/face"] };
    await e.check();
    expect(e.newer.get()).toBe(true);
    expect(e.baseline.get()).toEqual({});
    expect(e.working.get()).toEqual(copy);

    // And no longer once the file is back where the copy started.
    e.observe({});
    expect(e.newer.get()).toBe(false);
  });

  it("from another panel is taken as a read is", () => {
    const { editor: e } = editor({});
    e.observe({ off: ["clock/face"] });
    expect(e.working.get()).toEqual({ off: ["clock/face"] });
    e.move("session-id/address", "rigRow");
    e.observe({ off: ["session-id/short-id"] });
    expect(e.newer.get()).toBe(true);
    expect(e.baseline.get()).toEqual({ off: ["clock/face"] });
  });

  it("reloads it over unsaved changes", async () => {
    const saved = { rigRow: ["session-id/short-id"] };
    const { editor: e } = editor({}, () => saved);
    e.move("clock/face", "off");
    await e.reload();
    expect(e.baseline.get()).toEqual(saved);
    expect(e.working.get()).toEqual(saved);
  });

  it("keeps what it shows when the file cannot be read", async () => {
    const { editor: e } = editor({ off: ["clock/face"] }, () => null);
    await e.reload();
    expect(e.working.get()).toEqual({ off: ["clock/face"] });
  });
});

describe("noticing a newer layout", () => {
  it("checks on coming back, at most once a gap, and stops once it knows", async () => {
    let t = 0;
    let saved: Layout = {};
    const { editor: e, reads } = editor(
      {},
      () => saved,
      undefined,
      () => t,
    );
    // Unsaved, so a newer layout is one to know about rather than one to show.
    e.move("session-id/address", "rigRow");
    e.notice();
    e.notice();
    await settle();
    expect(reads()).toBe(1);
    expect(e.newer.get()).toBe(false);

    saved = { off: ["clock/face"] };
    t += 29_999;
    e.notice();
    t += 1;
    e.notice();
    await settle();
    expect(reads()).toBe(2);
    expect(e.newer.get()).toBe(true);

    t += 30_000;
    e.notice();
    await settle();
    expect(reads()).toBe(2);
  });

  it("does not call a save in flight newer", async () => {
    const { editor: e } = editor({}, () => ({ off: ["clock/face"] }));
    e.move("clock/face", "off");
    const confirming = e.confirm(e.working.get());
    await e.check();
    expect(e.newer.get()).toBe(false);
    await confirming;
  });
});

describe("confirming a save", () => {
  it("adopts the copy once the file holds it, and says so for a moment", async () => {
    let saved: Layout = {};
    let polls = 0;
    const { editor: e } = editor({}, () => {
      polls++;
      if (polls === 3) saved = { off: ["clock/face"] };
      return saved;
    });
    const seen: string[] = [];
    e.saving.subscribe(() => seen.push(e.saving.get()));
    e.move("clock/face", "off");
    await e.confirm(e.working.get());
    expect(seen).toEqual(["saving", "saved", "idle"]);
    expect(e.baseline.get()).toEqual({ off: ["clock/face"] });
  });

  it("leaves editing in place once it has said so, unless the copy moved since", async () => {
    const saved: Layout = { off: ["clock/face"] };
    const { editor: e } = editor({}, () => saved);
    e.editing.set(true);
    e.move("clock/face", "off");
    await e.confirm(e.working.get());
    expect(e.editing.get()).toBe(false);

    const { editor: f } = editor({}, () => saved);
    f.editing.set(true);
    f.move("clock/face", "off");
    const confirming = f.confirm(f.working.get());
    f.move("session-id/address", "rigRow");
    await confirming;
    expect(f.saving.get()).toBe("idle");
    expect(f.editing.get()).toBe(true);
  });

  it("stays in edit mode for a move made while it says so", async () => {
    const saved: Layout = { off: ["clock/face"] };
    let waits = 0;
    const { editor: e } = editor(
      {},
      () => saved,
      async () => {
        // The first wait is the poll; the second is the hold.
        if (++waits === 2) e.move("clock/face", null);
      },
    );
    e.editing.set(true);
    e.move("clock/face", "off");
    await e.confirm(e.working.get());
    expect(e.saving.get()).toBe("idle");
    expect(e.editing.get()).toBe(true);
  });

  it("says it could not confirm when the file never holds the copy", async () => {
    const { editor: e, reads } = editor({});
    e.move("clock/face", "off");
    await e.confirm(e.working.get());
    expect(e.saving.get()).toBe("unconfirmed");
    expect(e.baseline.get()).toEqual({});
    expect(reads()).toBe(40);
  });
});

describe("telling the other panels (D141)", () => {
  function told(saved: () => Layout) {
    const said: [string, Changed][] = [];
    const e = createLayoutEditor({
      baked: {},
      plugins,
      save: null,
      readSaved: async () => ({
        layout: saved(),
        presets: [],
        omitted: 0,
        settings: {},
        rigline: { model: NO_MODEL_SETTINGS },
      }),
      announce: {
        saving: (changed) => said.push(["saving", changed]),
        saved: (changed) => said.push(["saved", changed]),
      },
      wait: async () => {},
    });
    return { e, said };
  }

  it("says what a save writes as it starts, and what the file holds once it lands", async () => {
    const copy: Layout = { off: ["clock/face"] };
    const { e, said } = told(() => copy);
    e.move("clock/face", "off");
    await e.confirm(e.working.get());
    expect(said).toEqual([
      ["saving", { layout: copy }],
      ["saved", { layout: copy }],
    ]);
  });

  it("says what the file still holds when a save never lands", async () => {
    const { e, said } = told(() => ({}));
    e.move("clock/face", "off");
    await e.confirm(e.working.get());
    expect(said).toEqual([
      ["saving", { layout: { off: ["clock/face"] } }],
      ["saved", { layout: {} }],
    ]);
  });
});

describe("presets (D133)", () => {
  it("shows the preset's layout in the working copy and leaves the baseline", () => {
    const rows = preset("rows", { rigRow: ["session-id/address"] });
    const { editor: e } = editor({ rigRow: ["clock/face"] }, undefined, undefined, undefined, [
      rows,
    ]);
    e.apply("rows");
    expect(e.working.get()).toEqual({ rigRow: ["session-id/address"] });
    // Revert is what drops it, so the baseline must still be what the file holds.
    expect(e.baseline.get()).toEqual({ rigRow: ["clock/face"] });
  });

  it("numbers the rows from one, as every other edit does (D122)", () => {
    // The preset names row 3 and leaves nothing showing in the two above it, so the one row it
    // does show is row one. `clock/face` has to go off for that: its default is row one.
    const rows = preset("rows", {
      "rigRow 3": ["session-id/address"],
      off: ["clock/face"],
    });
    const { editor: e } = editor({}, undefined, undefined, undefined, [rows]);
    e.apply("rows");
    expect(e.working.get()).toEqual({ rigRow: ["session-id/address"], off: ["clock/face"] });
  });

  it("does nothing for a name that is not there, or one that could not be read", () => {
    const broken = preset("broken", {}, { problem: 'has no "layout"' });
    const { editor: e } = editor({ rigRow: ["clock/face"] }, undefined, undefined, undefined, [
      broken,
    ]);
    e.apply("broken");
    e.apply("nothing-like-this");
    expect(e.working.get()).toEqual({ rigRow: ["clock/face"] });
  });

  it("refreshes the list on Reload, which is the editor's only re-read", async () => {
    const mine = preset("mine", { rigRow: ["session-id/address"] });
    const exported = preset("exported", { off: ["clock/face"] });
    let there: readonly BakedPreset[] = [mine];
    const { editor: e } = editor(
      {},
      () => ({}),
      undefined,
      undefined,
      [mine],
      () => there,
    );
    expect(e.presets.get().map((p) => p.name)).toEqual(["mine"]);
    // `rigline layout export exported` in a terminal, which re-injects behind the panel.
    there = [mine, exported];
    await e.reload();
    expect(e.presets.get().map((p) => p.name)).toEqual(["mine", "exported"]);
  });

  it("carries how many a bound left out", async () => {
    const rows = preset("rows", { rigRow: ["session-id/address"] });
    const { editor: e } = editor({}, () => ({}), undefined, undefined, [rows]);
    e.apply("rows");
    await e.reload();
    expect(e.omitted.get()).toBe(0);
  });

  it("is not what `newer` is about: a list that moved is not a layout that moved (D126)", async () => {
    const mine = preset("mine", { rigRow: ["session-id/address"] });
    let there: readonly BakedPreset[] = [];
    const { editor: e } = editor(
      {},
      () => ({}),
      undefined,
      undefined,
      [],
      () => there,
    );
    there = [mine];
    await e.check();
    expect(e.newer.get()).toBe(false);
  });
});
