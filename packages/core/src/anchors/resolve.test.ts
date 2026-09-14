import { ANCHOR_NAMES, ANCHORS, type AnchorName, type AnchorSpec } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import { CORPUS_VERSIONS, corpusBundles, missing } from "../../test/corpus.ts";
import { type Classes, harvestClasses } from "../layers/classes.ts";
import { anchorViolation, resolveAnchors, uncountedClasses } from "./resolve.ts";

const mapWith = (...pairs: [module: string, local: string][]) => {
  const map: Record<string, Record<string, string>> = {};
  for (const [module, local] of pairs) {
    map[module] ??= {};
    map[module][local] = `${local}_${module}`;
  }
  return map;
};

/** A class map whose every class is applied once, unless `sites` says otherwise. */
const counted = (
  map: Record<string, Record<string, string>>,
  sites: Record<string, Record<string, number>> = {},
): Classes => {
  const counts: Record<string, Record<string, number>> = {};
  for (const [module, locals] of Object.entries(map)) {
    counts[module] = {};
    for (const local of Object.keys(locals)) {
      counts[module][local] = sites[module]?.[local] ?? 1;
    }
  }
  return { map, sites: counts, uncounted: [] };
};

describe("resolveAnchors", () => {
  it("resolves an anchor to the module-scoped class and reports the rest as missing", () => {
    const { module, local } = ANCHORS.modelPill;
    const resolved = resolveAnchors(counted(mapWith([module, local])));
    expect(resolved.classes.modelPill).toBe(`${local}_${module}`);
    expect(resolved.classes.transcriptRow).toBeNull();
    expect(resolved.missing).toContain("transcriptRow");
    expect(resolved.missing).not.toContain("modelPill");
  });

  it("does not resolve a same-named class from another module", () => {
    // `message` is defined in several modules; only the transcript's module counts.
    const resolved = resolveAnchors(counted(mapWith(["ZZZZZZ", "message"])));
    expect(resolved.classes.transcriptRow).toBeNull();
  });

  it("names the pair when an anchor is missing, and rejects a name not in the table", () => {
    const resolved = resolveAnchors(uncountedClasses({}));
    expect(anchorViolation("modelPill", resolved)).toBe(
      'anchor "modelPill" (gGYT1w.modelPill) is not in this extension',
    );
    expect(anchorViolation("nonsense", resolved)).toBe('unknown anchor "nonsense"');
    const ok = resolveAnchors(counted(mapWith(["gGYT1w", "modelPill"])));
    expect(anchorViolation("modelPill", ok)).toBeNull();
  });

  describe("selectors", () => {
    it("appends the spec's refinement to the class", () => {
      const resolved = resolveAnchors(counted(mapWith(["gGYT1w", "modelPill"])));
      expect(resolved.selectors.modelPill).toBe('.modelPill_gGYT1w[role="combobox"]');
    });

    it("leaves a style anchor without one, because a borrowed class is never queried", () => {
      const resolved = resolveAnchors(counted(mapWith(["8RAulQ", "menuPopup"])));
      expect(resolved.classes.footerMenuPopup).toBe("menuPopup_8RAulQ");
      expect(resolved.selectors.footerMenuPopup).toBeNull();
      expect(resolved.missing).not.toContain("footerMenuPopup");
    });

    it("puts an anchor's ancestor in front of it", () => {
      const resolved = resolveAnchors(
        counted(mapWith(["OOQiHg", "sessionItem"], ["OOQiHg", "sessionName"])),
      );
      expect(resolved.selectors.sessionListItemName).toBe(
        ".sessionItem_OOQiHg .sessionName_OOQiHg",
      );
    });

    it("refuses an anchor whose ancestor does not resolve, rather than falling back to the class", () => {
      const resolved = resolveAnchors(counted(mapWith(["OOQiHg", "sessionName"])));
      expect(resolved.classes.sessionListItemName).toBeNull();
      expect(resolved.selectors.sessionListItemName).toBeNull();
      expect(anchorViolation("sessionListItemName", resolved)).toBe(
        'anchor "sessionListItemName" sits within "sessionListItem", which does not resolve in this extension',
      );
    });
  });

  describe("ambiguity", () => {
    /** `composer` is the table's singleton with nothing to tell a second match apart. */
    const composer = ANCHORS.composer;

    it("refuses a singleton the bundle applies at more than one place", () => {
      const resolved = resolveAnchors(
        counted(mapWith([composer.module, composer.local]), {
          [composer.module]: { [composer.local]: 3 },
        }),
      );
      expect(resolved.classes.composer).toBeNull();
      expect(resolved.selectors.composer).toBeNull();
      expect(resolved.ambiguous).toEqual([{ name: "composer", sites: 3 }]);
      expect(anchorViolation("composer", resolved)).toContain("applies its class at 3 places");
    });

    it("exempts a singleton that carries a refinement", () => {
      const { module, local } = ANCHORS.modelPill;
      const resolved = resolveAnchors(
        counted(mapWith([module, local]), { [module]: { [local]: 3 } }),
      );
      expect(resolved.classes.modelPill).toBe("modelPill_gGYT1w");
      expect(resolved.ambiguous).toEqual([]);
    });

    it("exempts a collection, whose many matches are the point", () => {
      const { module, local } = ANCHORS.sessionListItem;
      const resolved = resolveAnchors(
        counted(mapWith([module, local]), { [module]: { [local]: 4 } }),
      );
      expect(resolved.classes.sessionListItem).toBe("sessionItem_OOQiHg");
      expect(resolved.ambiguous).toEqual([]);
    });

    it("exempts a style anchor, for which sharing a class is the whole point", () => {
      const resolved = resolveAnchors(
        counted(mapWith(["8RAulQ", "menuItem"]), { "8RAulQ": { menuItem: 9 } }),
      );
      expect(resolved.classes.footerMenuItem).toBe("menuItem_8RAulQ");
      expect(resolved.ambiguous).toEqual([]);
    });

    it("exempts a singleton up to an acknowledged count, and fails again above it", () => {
      // `knownSites` is the escape from the one trap this check sets: the site count is an upper
      // bound, so a bundle that merely passes a class somewhere as a value reads as a second site
      // and there is nothing to refine against. The acknowledgement is bounded, which is what keeps
      // it from being the `collection` relabel under a politer name.
      const table = {
        composer: {
          ...composer,
          knownSites: { count: 2, why: "the second is a helper argument, not a second control" },
        },
      };
      const withCount = (sites: number) =>
        resolveAnchors(
          counted(mapWith([composer.module, composer.local]), {
            [composer.module]: { [composer.local]: sites },
          }),
          table,
        );

      expect(withCount(2).ambiguous).toEqual([]);
      expect(withCount(2).classes.composer).toBe("inputContainer_07S1Yg");
      expect(withCount(3).ambiguous).toEqual([{ name: "composer", sites: 3 }]);
      expect(withCount(3).reasons.composer).toContain("accounts for 2 references");
      expect(withCount(3).reasons.composer).toContain("helper argument");
    });

    it("reports an uncounted module as unverified and still resolves it", () => {
      const map = mapWith([composer.module, composer.local]);
      const resolved = resolveAnchors({ map, sites: {}, uncounted: [composer.module] });
      expect(resolved.classes.composer).toBe("inputContainer_07S1Yg");
      expect(resolved.unverified).toContain("composer");
      expect(resolved.ambiguous).toEqual([]);
    });
  });
});

/**
 * The corpus is the only thing that can say whether a refinement actually refines anything: the
 * synthetic maps above prove the resolution rules, and only a real bundle proves the table is
 * true about the extension. Skips with a reason rather than failing when the corpus is absent.
 */
describe("corpus", () => {
  for (const version of CORPUS_VERSIONS) {
    describe(`${version}`, () => {
      it.skipIf(missing(version))("resolves every curated anchor, with none ambiguous", () => {
        const resolved = resolveAnchors(harvestClasses(corpusBundles(version).webview));
        expect(resolved.missing).toEqual([]);
        expect(resolved.ambiguous).toEqual([]);
        expect(resolved.unverified).toEqual([]);
      });

      it.skipIf(missing(version))("gives every element anchor a selector and no style one", () => {
        const resolved = resolveAnchors(harvestClasses(corpusBundles(version).webview));
        for (const name of ANCHOR_NAMES) {
          const spec: AnchorSpec = ANCHORS[name];
          const selector = resolved.selectors[name];
          if (spec.kind === "style") {
            expect(selector, name).toBeNull();
            continue;
          }
          expect(selector, name).toContain(`.${resolved.classes[name]}`);
          if (spec.refine !== undefined) expect(selector, name).toContain(spec.refine);
          if (spec.within !== undefined) {
            expect(selector, name).toBe(
              `${resolved.selectors[spec.within as AnchorName]} .${resolved.classes[name]}${spec.refine ?? ""}`,
            );
          }
        }
      });

      it.skipIf(missing(version))(
        "refines the five anchors whose class names more than one thing",
        () => {
          const classes = harvestClasses(corpusBundles(version).webview);
          const resolved = resolveAnchors(classes);
          expect(resolved.selectors.modelPill).toBe('.modelPill_gGYT1w[role="combobox"]');
          expect(resolved.selectors.transcriptRow).toBe(".message_07S1Yg[data-transcript-message]");
          expect(resolved.selectors.assistantRow).toBe(
            '.timelineMessage_07S1Yg[data-testid="assistant-message"]',
          );
          expect(resolved.selectors.userRow).toBe(
            ".userMessageContainer_07S1Yg[data-transcript-message]",
          );
          expect(resolved.selectors.sessionListItemName).toBe(
            ".sessionItem_OOQiHg .sessionName_OOQiHg",
          );
        },
      );

      it.skipIf(missing(version))("counts the application sites D7 measured", () => {
        const { sites } = harvestClasses(corpusBundles(version).webview);
        // modelPill was applied twice until the agent-map button arrived in 2.1.269, which is the
        // drift `classes.reused` exists to report; the rest have held across the corpus.
        expect(sites.gGYT1w?.modelPill).toBe(version === "2.1.268" ? 2 : 3);
        expect(sites["07S1Yg"]?.message).toBe(3);
        expect(sites["07S1Yg"]?.userMessageContainer).toBe(3);
        expect(sites.OOQiHg?.sessionName).toBe(2);
        expect(sites["07S1Yg"]?.timelineMessage).toBe(version === "2.1.268" ? 6 : 8);
      });
    });
  }
});
