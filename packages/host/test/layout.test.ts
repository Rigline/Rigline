/**
 * The layout editor's logic (D93): moves on the working copy, and the re-read of `registry.js` that
 * Reload, the menu opening and a save's confirmation share. The re-read and the wait are injected,
 * so the twenty seconds a confirmation may take cost nothing here.
 */
import type { Layout, LayoutPlugin } from "@rigline/plugin-api";
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

function editor(baked: Layout, saved: () => Layout | null = () => baked) {
  let reads = 0;
  const made = createLayoutEditor({
    baked,
    plugins,
    save: null,
    readSaved: async () => {
      reads++;
      return saved();
    },
    wait: async () => {},
  });
  return { editor: made, reads: () => reads };
}

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

describe("confirming a save", () => {
  it("adopts the copy once the file holds it, and clears the note on the next move", async () => {
    let saved: Layout = {};
    let polls = 0;
    const { editor: e } = editor({}, () => {
      polls++;
      if (polls === 3) saved = { off: ["clock/face"] };
      return saved;
    });
    e.move("clock/face", "off");
    await e.confirm(e.working.get());
    expect(e.saving.get()).toBe("saved");
    expect(e.baseline.get()).toEqual({ off: ["clock/face"] });
    e.move("clock/face", null);
    expect(e.saving.get()).toBe("idle");
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
