import { describe, expect, it } from "vitest";
import type { ElementSpec } from "./elements.ts";
import {
  compactRows,
  describeElements,
  type Layout,
  layoutCommands,
  layoutProblems,
  layoutView,
  parsePlace,
  placeElement,
  placeName,
  placeTitle,
  rowNumbers,
  rowOf,
  rowPlace,
  sameLayout,
  withElementAt,
  withOrder,
} from "./layout.ts";

const spacer = { anchor: "footerSpacer", at: "before" } as const;
const shortId: ElementSpec = {
  title: "Session id",
  placements: [spacer, "rigRow"],
  default: spacer,
};
const address: ElementSpec = { title: "Messaging address", placements: ["rigRow"], default: null };
const plugins = [{ name: "session-id", elements: { "short-id": shortId, address } }];

describe("places", () => {
  it("spells a place as the file does, and reads it back", () => {
    for (const placement of [
      "rigRow",
      "rigRow 2",
      "rigRow right",
      "rigRow 2 right",
      spacer,
      { anchor: "composerBox", at: "inside" },
      null,
    ]) {
      const name = placeName(placement as never);
      expect(parsePlace(name)).toEqual({ placement });
    }
    expect(placeName(spacer)).toBe("before footerSpacer");
    expect(placeName(null)).toBe("off");
  });

  it("says why a name is not a place, with a word for `default`", () => {
    expect(parsePlace("rigrow")).toEqual({
      problem:
        '"rigrow" is not a place: a place is rigRow, rigRow 2 and on, rigRow right, rigRow 2 right and on, before, after or inside an anchor, or off',
    });
    expect(parsePlace("beside footerSpacer")).toHaveProperty("problem");
    expect(parsePlace("default")).toMatchObject({
      problem: expect.stringContaining("by being in no list"),
    });
  });
});

describe("rows", () => {
  it("numbers a zone's rows from one, the first spelled as the zone", () => {
    expect(rowOf("rigRow")).toEqual({ zone: "rigRow", row: 1, side: "left" });
    expect(rowOf("rigRow 2")).toEqual({ zone: "rigRow", row: 2, side: "left" });
    expect(rowOf("rigRow 10")).toEqual({ zone: "rigRow", row: 10, side: "left" });
    for (const place of ["rigRow 1", "rigRow 0", "rigRow 02", "rigrow 2", "before 2", "off"]) {
      expect(rowOf(place)).toBeNull();
    }
    expect(rowPlace("rigRow", 1)).toBe("rigRow");
    expect(rowPlace("rigRow", 3)).toBe("rigRow 3");
    expect(placeTitle("rigRow")).toBe("Rigline row");
    expect(placeTitle("rigRow 2")).toBe("Rigline row 2");
  });

  it("gives every row a right side, spelled after its number", () => {
    expect(rowOf("rigRow right")).toEqual({ zone: "rigRow", row: 1, side: "right" });
    expect(rowOf("rigRow 3 right")).toEqual({ zone: "rigRow", row: 3, side: "right" });
    for (const place of ["rigRow left", "rigRow 2 left", "rigRow right 2", "rigRow Right"]) {
      expect(rowOf(place)).toBeNull();
    }
    expect(rowPlace("rigRow", 1, "right")).toBe("rigRow right");
    expect(rowPlace("rigRow", 2, "right")).toBe("rigRow 2 right");
    expect(placeTitle("rigRow right")).toBe("Rigline row, right");
    expect(placeTitle("rigRow 2 right")).toBe("Rigline row 2, right");
  });

  it("says the first row is the zone's own name", () => {
    for (const place of ["rigRow 1", "rigRow 0", "rigRow 02", "rigRow 1 right"]) {
      expect(parsePlace(place)).toEqual({
        problem: `"${place}" is not a place: the first row is rigRow, then rigRow 2`,
      });
    }
  });

  it("says a row's left side is the row itself", () => {
    expect(parsePlace("rigRow left")).toEqual({
      problem:
        '"rigRow left" is not a place: a row\'s left side is the row itself, rigRow, and its right side is rigRow right',
    });
    expect(parsePlace("rigRow 2 left")).toMatchObject({
      problem: expect.stringContaining(
        "the row itself, rigRow 2, and its right side is rigRow 2 right",
      ),
    });
  });

  it("counts a row once, whichever sides it has, in number order", () => {
    expect(
      rowNumbers(["rigRow 3 right", "rigRow", "rigRow right", "off", "rigRow 3"], "rigRow"),
    ).toEqual([1, 3]);
    expect(rowNumbers(["before footerSpacer"], "rigRow")).toEqual([]);
  });

  it("puts an element in any row of a zone it offers, and nowhere else", () => {
    const layout = { "rigRow 3": ["session-id/address", "session-id/short-id"] };
    expect(placeElement(layout, "session-id/short-id", shortId)).toEqual({
      placement: "rigRow 3",
      listed: 1,
    });
    expect(
      placeElement({ "rigRow 2 right": ["session-id/address"] }, "session-id/address", address),
    ).toEqual({ placement: "rigRow 2 right", listed: 0 });
    const pinned: ElementSpec = { title: "Clock", placements: [spacer], default: spacer };
    expect(placeElement({ "rigRow 2": ["clock/face"] }, "clock/face", pinned).listed).toBeNull();
    expect(
      layoutProblems({ "rigRow 2": ["clock/face"], "rigRow right": ["clock/hand"] }, [
        { name: "clock", elements: { face: pinned, hand: pinned } },
      ]),
    ).toEqual([
      "clock/face cannot go in rigRow 2; it can go before footerSpacer",
      "clock/hand cannot go in rigRow right; it can go before footerSpacer",
    ]);
  });
});

describe("layoutView", () => {
  const row: ElementSpec = { title: "Row", placements: [spacer, "rigRow"], default: spacer };
  const deck = [{ name: "d", elements: { a: row, b: row, c: row, e: row, f: row } }];

  const alsoOf = (layout: Layout) =>
    Object.fromEntries(
      layoutView(layout, deck).flatMap((g) => g.elements.map((e) => [e.name, e.also] as const)),
    );

  it("shows rows in number order, each left side before its right, then slots, then off", () => {
    const layout = {
      off: ["d/e"],
      "rigRow 10": ["d/a"],
      "rigRow 2 right": ["d/f"],
      "rigRow 2": ["d/b"],
      rigRow: ["d/c"],
    };
    expect(layoutView(layout, deck).map((g) => g.place)).toEqual([
      "rigRow",
      "rigRow 2",
      "rigRow 2 right",
      "rigRow 10",
      "off",
    ]);
  });

  it("offers the other side, every other row there is and a new one, unless that would only move an element alone", () => {
    expect(alsoOf({ rigRow: ["d/a", "d/b"], "rigRow 2": ["d/c"], off: ["d/f"] })).toEqual({
      "d/a": ["before footerSpacer", "rigRow right", "rigRow 2", "rigRow 3"],
      "d/b": ["before footerSpacer", "rigRow right", "rigRow 2", "rigRow 3"],
      "d/c": ["before footerSpacer", "rigRow 2 right", "rigRow"],
      "d/e": ["rigRow", "rigRow 2", "rigRow 3"],
      "d/f": ["before footerSpacer", "rigRow", "rigRow 2", "rigRow 3"],
    });
    expect(layoutView({}, deck)[0]?.elements[0]?.also).toEqual(["rigRow"]);
  });

  it("offers the other rows and a new one on the side an element is on", () => {
    expect(
      alsoOf({ rigRow: ["d/a"], "rigRow 2": ["d/b"], "rigRow 2 right": ["d/c"], off: ["d/f"] }),
    ).toMatchObject({
      "d/b": ["before footerSpacer", "rigRow 2 right", "rigRow", "rigRow 3"],
      "d/c": ["before footerSpacer", "rigRow 2", "rigRow right", "rigRow 3 right"],
    });
    // Alone in the last row, a new row would be this one again.
    expect(alsoOf({ rigRow: ["d/a"], "rigRow 2 right": ["d/c"], off: ["d/f"] })).toMatchObject({
      "d/c": ["before footerSpacer", "rigRow 2", "rigRow right"],
    });
  });
});

describe("compactRows", () => {
  const row: ElementSpec = { title: "Row", placements: [spacer, "rigRow"], default: spacer };
  const deck = [{ name: "d", elements: { a: row, b: row, c: row } }];

  it("numbers the rows from one, each list moving whole", () => {
    expect(compactRows({ rigRow: ["d/a"], "rigRow 3": ["d/b", "gone/x"] }, deck)).toEqual({
      rigRow: ["d/a"],
      "rigRow 2": ["d/b", "gone/x"],
    });
    expect(compactRows({ "rigRow 2": ["d/b"], off: ["d/a"] }, deck)).toEqual({
      rigRow: ["d/b"],
      off: ["d/a"],
    });
  });

  it("drops a row that shows nothing, and leaves every other place", () => {
    const layout = {
      rigRow: ["d/c"],
      "rigRow 2": ["gone/x"],
      "rigRow 3": ["d/b"],
      "before footerSpacer": ["d/a"],
    };
    expect(compactRows(layout, deck)).toEqual({
      rigRow: ["d/c"],
      "rigRow 2": ["d/b"],
      "before footerSpacer": ["d/a"],
    });
  });

  it("hands back the same layout where the rows are numbered already", () => {
    const layout = { rigRow: ["d/a"], "rigRow 2": ["d/b"], off: ["gone/x"] };
    expect(compactRows(layout, deck)).toBe(layout);
  });

  it("moves both sides with their row, and keeps a row that shows only its right side", () => {
    expect(
      compactRows(
        { "rigRow 2 right": ["d/a"], "rigRow 4": ["d/b"], "rigRow 4 right": ["d/c"] },
        deck,
      ),
    ).toEqual({ "rigRow right": ["d/a"], "rigRow 2": ["d/b"], "rigRow 2 right": ["d/c"] });
  });

  it("keeps a side that shows nothing where its row stays, and drops it with a row that goes", () => {
    expect(
      compactRows(
        {
          "rigRow 2": ["gone/x"],
          "rigRow 2 right": ["gone/y"],
          "rigRow 3": ["d/a"],
          "rigRow 3 right": ["gone/z"],
        },
        deck,
      ),
    ).toEqual({ rigRow: ["d/a"], "rigRow right": ["gone/z"] });
  });
});

describe("placeElement", () => {
  it("is the default where the layout does not list it", () => {
    expect(placeElement({}, "session-id/short-id", shortId)).toEqual({
      placement: spacer,
      listed: null,
    });
    expect(placeElement({}, "session-id/address", address)).toEqual({
      placement: null,
      listed: null,
    });
  });

  it("is the listed place, with its position in the list", () => {
    const layout = { rigRow: ["session-id/address", "session-id/short-id"] };
    expect(placeElement(layout, "session-id/short-id", shortId)).toEqual({
      placement: "rigRow",
      listed: 1,
    });
  });

  it("switches off anything, whatever it offers", () => {
    expect(placeElement({ off: ["session-id/short-id"] }, "session-id/short-id", shortId)).toEqual({
      placement: null,
      listed: 0,
    });
  });

  it("stays at its default where the list's place is not one it offers, or not a place", () => {
    for (const place of ["before modelPill", "rigrow"]) {
      expect(
        placeElement({ [place]: ["session-id/short-id"] }, "session-id/short-id", shortId),
      ).toEqual({ placement: spacer, listed: null });
    }
  });

  it("takes the first list that names it", () => {
    const layout = { off: ["session-id/short-id"], rigRow: ["session-id/short-id"] };
    expect(placeElement(layout, "session-id/short-id", shortId).placement).toBeNull();
  });
});

describe("describeElements", () => {
  const elements = { "short-id": shortId, address };

  it("says where each goes by default, or that it is off", () => {
    expect(describeElements(elements)).toEqual([
      'shows "Session id" before footerSpacer',
      'offers "Messaging address", off by default',
    ]);
  });

  it("says what the layout changed, and nothing where it only ordered", () => {
    const moved = { rigRow: ["session-id/short-id", "session-id/address"] };
    expect(describeElements(elements, "session-id", moved)).toEqual([
      'shows "Session id" in rigRow, moved from before footerSpacer',
      'shows "Messaging address" in rigRow, switched on',
    ]);
    const off = { off: ["session-id/short-id"] };
    expect(describeElements(elements, "session-id", off)[0]).toBe(
      'offers "Session id", switched off',
    );
    const pinned = { "before footerSpacer": ["session-id/short-id"] };
    expect(describeElements(elements, "session-id", pinned)[0]).toBe(
      'shows "Session id" before footerSpacer',
    );
  });
});

describe("layoutProblems", () => {
  it("is quiet about a layout that resolves", () => {
    const layout = { rigRow: ["session-id/address"], off: ["session-id/short-id"] };
    expect(layoutProblems(layout, plugins)).toEqual([]);
  });

  it("names every entry that does not resolve, one line each", () => {
    const layout = {
      rigrow: ["session-id/address"],
      "before footerSpacer": ["session-id/address", "session-id/gone", "clock/face", "bare"],
      "before modelPill": ["session-id/short-id"],
    };
    expect(layoutProblems(layout, plugins)).toEqual([
      expect.stringContaining('"rigrow" is not a place'),
      'session-id/address is under both "rigrow" and "before footerSpacer"; the first is used',
      'session-id/gone: session-id declares no element "gone"',
      'clock/face: no plugin "clock" is installed',
      '"bare" is not plugin/element',
      "session-id/short-id cannot go before modelPill; it can go before footerSpacer or in rigRow",
    ]);
  });

  it("says nothing about a switched-off plugin's entries, which are kept for when it is back", () => {
    expect(layoutProblems({ rigRow: ["clock/face"] }, plugins, ["clock"])).toEqual([]);
  });
});

describe("sameLayout", () => {
  it("ignores the order of places and a place that lists nothing", () => {
    expect(
      sameLayout({ rigRow: ["a/b"], off: ["c/d"] }, { off: ["c/d"], rigRow: ["a/b"], x: [] }),
    ).toBe(true);
    expect(sameLayout({}, { rigRow: [] })).toBe(true);
  });

  it("counts the order within a place, and every name", () => {
    expect(sameLayout({ rigRow: ["a/b", "c/d"] }, { rigRow: ["c/d", "a/b"] })).toBe(false);
    expect(sameLayout({ rigRow: ["a/b"] }, { rigRow: ["a/b", "c/d"] })).toBe(false);
    expect(sameLayout({ rigRow: ["a/b"] }, { off: ["a/b"] })).toBe(false);
  });
});

describe("moves", () => {
  const layout = { rigRow: ["a/x", "b/y"], off: ["c/z"] };

  it("puts an element last in a place, out of every other list, and drops a list left empty", () => {
    expect(withElementAt(layout, "c/z", "rigRow")).toEqual({ rigRow: ["a/x", "b/y", "c/z"] });
    expect(withElementAt(layout, "a/x", "off")).toEqual({ rigRow: ["b/y"], off: ["c/z", "a/x"] });
  });

  it("puts an element back at its default by taking it out of every list", () => {
    expect(withElementAt(layout, "c/z", null)).toEqual({ rigRow: ["a/x", "b/y"] });
  });

  it("sets a place's order, taking each name out of any other list", () => {
    expect(withOrder(layout, "rigRow", ["b/y", "c/z", "a/x"])).toEqual({
      rigRow: ["b/y", "c/z", "a/x"],
    });
    expect(withOrder(layout, "rigRow", [])).toEqual({ off: ["c/z"] });
  });

  it("keeps a place called __proto__ an ordinary key", () => {
    const moved = withElementAt({}, "a/x", "__proto__");
    expect(Object.hasOwn(moved, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(moved)).toBe(Object.prototype);
  });
});

describe("layoutCommands", () => {
  it("names only the places that changed, and orders each one that still lists something", () => {
    const from = { rigRow: ["a/x"], "before footerSpacer": ["gone/away"] };
    const to = { rigRow: ["b/y", "a/x"], "before footerSpacer": ["gone/away"] };
    expect(layoutCommands(from, to)).toEqual(["rigline layout order rigRow b/y a/x"]);
  });

  it("puts back at its default an element whose place is left empty, unless it moved", () => {
    const from = { rigRow: ["a/x", "b/y"] };
    const to = { off: ["b/y"] };
    expect(layoutCommands(from, to)).toEqual([
      "rigline layout order off b/y",
      "rigline layout place a/x default",
    ]);
  });

  it("says nothing when nothing changed", () => {
    expect(layoutCommands({ rigRow: ["a/x"] }, { rigRow: ["a/x"], off: [] })).toEqual([]);
    expect(layoutCommands({}, { off: [] })).toEqual([]);
  });

  it("resets a copy with nothing listed, unresolved entries and all, as Save writes it", () => {
    const from = { rigRow: ["a/x"], off: ["gone/away"] };
    expect(layoutCommands(from, {})).toEqual(["rigline layout reset"]);
  });
});
