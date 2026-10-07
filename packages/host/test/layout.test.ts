/**
 * The layout editor's logic (D93): moves on the working copy, and the re-read of `registry.js` that
 * Reload, the menu opening and a save's confirmation share. The re-read and the wait are injected,
 * so the twenty seconds a confirmation may take cost nothing here.
 */
import type { Layout, LayoutPlugin } from "@rigline/plugin-api/internal";
import { describe, expect, it } from "vitest";
import { createLayoutEditor } from "../src/kernel/layout.ts";

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

function editor(
  baked: Layout,
  saved: () => Layout | null = () => baked,
  wait: (ms: number) => Promise<void> = async () => {},
  now?: () => number,
) {
  let reads = 0;
  const made = createLayoutEditor({
    baked,
    plugins,
    save: null,
    readSaved: async () => {
      reads++;
      return saved();
    },
    wait,
    now,
  });
  return { editor: made, reads: () => reads };
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

  it("resets the working copy to every plugin's default, and leaves the baseline", () => {
    const baked = { rigRow: ["session-id/address"], off: ["clock/face"] };
    const { editor: e } = editor(baked);
    e.reset();
    expect(e.working.get()).toEqual({});
    expect(e.baseline.get()).toEqual(baked);
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
});

describe("the saved layout", () => {
  it("says a newer one is saved when the file moved since the panel loaded", async () => {
    let saved: Layout = {};
    const { editor: e } = editor({}, () => saved);
    await e.check();
    expect(e.newer.get()).toBe(false);
    saved = { off: ["clock/face"] };
    await e.check();
    expect(e.newer.get()).toBe(true);
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
