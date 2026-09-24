import { describe, expect, it } from "vitest";
import type { ElementSpec } from "./elements.ts";
import { layoutProblems, parsePlace, placeElement, placeName } from "./layout.ts";

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
