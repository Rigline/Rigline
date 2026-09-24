import { describe, expect, it } from "vitest";
import type { ElementSpec } from "./elements.ts";
import {
  describeElements,
  layoutCommands,
  layoutProblems,
  parsePlace,
  placeElement,
  placeName,
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
    for (const placement of ["rigRow", spacer, { anchor: "composerBox", at: "inside" }, null]) {
      const name = placeName(placement as never);
      expect(parsePlace(name)).toEqual({ placement });
    }
    expect(placeName(spacer)).toBe("before footerSpacer");
    expect(placeName(null)).toBe("off");
  });

  it("says why a name is not a place, with a word for `default`", () => {
    expect(parsePlace("rigrow")).toMatchObject({ problem: expect.stringContaining('"rigrow"') });
    expect(parsePlace("beside footerSpacer")).toHaveProperty("problem");
    expect(parsePlace("default")).toMatchObject({
      problem: expect.stringContaining("by being in no list"),
    });
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
  });
});
