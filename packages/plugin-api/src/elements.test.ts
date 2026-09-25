import { describe, expect, it } from "vitest";
import {
  type Elements,
  elementGaps,
  elementsOf,
  placementLabel,
  samePlacement,
} from "./elements.ts";
import { validateManifest } from "./manifest.ts";
import type { IdentifierTables } from "./tables.ts";

const tables: IdentifierTables = {
  version: "9.9.9",
  moduleClasses: {},
  messageTypes: [],
  inboundResponses: [],
  outboundFields: {},
  partialFieldTypes: [],
  anchors: { footerSpacer: "spacer_gGYT1w", composerBox: "inputContainer_cKsPxg", modelPill: null },
  anchorSelectors: {
    footerSpacer: ".spacer_gGYT1w",
    composerBox: ".inputContainer_cKsPxg",
    modelPill: null,
  },
  unresolvedAnchors: {
    modelPill: 'anchor "modelPill" (gGYT1w.modelPill) is not in this extension',
  },
  react: { hook: "__REACT_DEVTOOLS_GLOBAL_HOOK__", version: "18.3.1", missing: [] },
};

const spacer = { anchor: "footerSpacer", at: "before" } as const;

function problemsOf(elements: unknown): string[] {
  const problems: string[] = [];
  elementsOf(elements, problems);
  return problems;
}

describe("elementsOf", () => {
  it("keeps a well-formed element, with a default or with none", () => {
    const problems: string[] = [];
    const elements = elementsOf(
      {
        "short-id": { title: "Session id", placements: [spacer, "rigRow"], default: spacer },
        address: { title: "Messaging address", placements: ["rigRow"], default: null },
      },
      problems,
    );
    expect(problems).toEqual([]);
    expect(Object.keys(elements)).toEqual(["short-id", "address"]);
  });

  it("requires a default, so off is a choice rather than an omission", () => {
    expect(problemsOf({ a: { title: "A", placements: ["rigRow"] } })).toEqual([
      '"elements.a.default" is required: one of its placements, or null for off',
    ]);
  });

  it("refuses a default the element does not offer", () => {
    expect(problemsOf({ a: { title: "A", placements: ["rigRow"], default: spacer } })).toEqual([
      '"elements.a.default" must be one of its placements, or null for off',
    ]);
  });

  it("refuses an anchor that is not one element", () => {
    const at = { anchor: "transcriptRow", at: "after" };
    expect(problemsOf({ a: { title: "A", placements: [at], default: at } })).toEqual([
      '"elements.a.placements[0]" names "transcriptRow", which is a collection; an element goes at one element',
    ]);
  });

  it("names every other malformed field", () => {
    expect(
      problemsOf({
        "Bad Id": { title: "x", placements: ["rigRow"], default: null },
        a: { title: "", placements: [], default: null, colour: "red" },
        b: { title: "B", placements: [{ anchor: "footerSpacer", at: "under" }], default: null },
        c: { title: "C", placements: ["rigRow", "rigRow"], default: null },
      }),
    ).toEqual([
      '"elements.Bad Id": an element id is lowercase letters, digits and hyphens',
      '"elements.a.colour" is not an element field',
      '"elements.a.title" must be a non-empty string',
      '"elements.a.placements" must be a non-empty array',
      '"elements.b.placements[0]" needs "at", one of before, after, inside',
      '"elements.c.placements[1]" repeats an earlier placement',
    ]);
  });

  it("is what validateManifest reads, and absent means none", () => {
    expect(validateManifest({ api: 1, name: "p", entry: "i.js" }, "p").manifest?.elements).toEqual(
      {},
    );
    expect(
      validateManifest({ api: 1, name: "p", entry: "i.js", elements: [] }, "p").problems,
    ).toEqual(['"elements" must be an object']);
  });
});

describe("elementGaps", () => {
  const elements: Elements = {
    fine: { title: "Fine", placements: [spacer, "rigRow"], default: spacer },
    gone: { title: "Gone", placements: [{ anchor: "modelPill", at: "after" }], default: null },
    later: { title: "Later", placements: ["someZone"], default: "someZone" },
  };

  it("names each placement this extension or engine cannot provide, and nothing else", () => {
    expect(elementGaps(elements, tables)).toEqual([
      'element "gone" cannot go after modelPill: anchor "modelPill" (gGYT1w.modelPill) is not in this extension',
      'element "later" cannot go in someZone: "someZone" is not a zone this version of Rigline has',
    ]);
  });

  it("reads a zone through the anchor it is placed in", () => {
    const withoutBox = { ...tables, anchors: { ...tables.anchors, composerBox: null } };
    expect(elementGaps({ fine: elements.fine } as Elements, withoutBox)).toEqual([
      'element "fine" cannot go in rigRow: anchor "composerBox" (cKsPxg.inputContainer) is not in this extension',
    ]);
  });
});

describe("placements", () => {
  it("compares placements by value", () => {
    expect(samePlacement(spacer, { anchor: "footerSpacer", at: "before" })).toBe(true);
    expect(samePlacement(spacer, { anchor: "footerSpacer", at: "after" })).toBe(false);
    expect(samePlacement("rigRow", spacer)).toBe(false);
    expect(placementLabel("rigRow")).toBe("in rigRow");
  });
});
