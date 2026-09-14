import { describe, expect, it } from "vitest";
import { CORPUS_VERSIONS, corpusBundles, missing } from "../../test/corpus.ts";
import {
  type ClassMap,
  classCount,
  classesLayer,
  collidingLocalNames,
  cssClasses,
  harvestClasses,
  harvestClassMap,
  harvestClassSites,
  serialiseClassMap,
  siteCount,
  unreachableCssClasses,
} from "./classes.ts";
import { HarvestError } from "./types.ts";

/**
 * `harvestClassMap` refuses to trust a result under its floor (30 modules, 300 classes), so any
 * synthetic bundle meant to exercise a successful harvest needs enough bulk to clear it. This
 * builds that bulk: `moduleCount` distinct modules, each with `localsPerModule` distinct locals,
 * none of which collide with each other or with the fixtures the tests inject alongside them.
 */
function fillerBundle(moduleCount: number, localsPerModule: number): string {
  const modules: string[] = [];
  for (let m = 0; m < moduleCount; m++) {
    const hash = `f${m.toString().padStart(5, "0")}`;
    const entries: string[] = [];
    for (let l = 0; l < localsPerModule; l++) {
      const local = `local${l}`;
      entries.push(`${local}:"${local}_${hash}"`);
    }
    modules.push(`{${entries.join(",")}}`);
  }
  return modules.join(";");
}

/**
 * The same bulk, bound to variables and applied through them, for tests that clear the site
 * harvest's reference floor as well as the class floor. `fillerBundle` stays as it is because
 * clearing one floor and not the other is itself worth being able to build.
 */
function appliedFillerBundle(moduleCount: number, localsPerModule: number): string {
  const modules: string[] = [];
  const uses: string[] = [];
  for (let m = 0; m < moduleCount; m++) {
    const hash = `f${m.toString().padStart(5, "0")}`;
    const name = `mod${m}`;
    const entries: string[] = [];
    for (let l = 0; l < localsPerModule; l++) {
      const local = `local${l}`;
      entries.push(`${local}:"${local}_${hash}"`);
      uses.push(`${name}.${local}`);
    }
    modules.push(`var ${name}={${entries.join(",")}}`);
  }
  return `${modules.join(";")};var applied=[${uses.join(",")}]`;
}

describe("harvestClassMap", () => {
  // Real bundles hold roughly 95 modules and 900 classes; 32 x 10 clears the 30/300 floor with
  // margin so the floor check itself is never what these tests are exercising.
  const filler = fillerBundle(32, 10);

  it("throws HarvestError below the floor", () => {
    const tiny = fillerBundle(5, 5);
    expect(() => harvestClassMap(tiny)).toThrow(HarvestError);
    try {
      harvestClassMap(tiny);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HarvestError);
      expect((error as HarvestError).layer).toBe("classes");
    }
  });

  it("groups by module hash rather than flattening (D6)", () => {
    // The same local name, `tab`, is defined by two different modules with two different hashed
    // values. A flat map would let one shadow the other; the grouped map keeps both.
    const bundle = [filler, `{tab:"tab_aaaaaa"}`, `{tab:"tab_bbbbbb"}`].join(";");
    const map = harvestClassMap(bundle);
    expect(map.aaaaaa?.tab).toBe("tab_aaaaaa");
    expect(map.bbbbbb?.tab).toBe("tab_bbbbbb");
  });

  it("matches a quoted key for a local name that cannot be a bare property (a hyphen)", () => {
    const bundle = [filler, `{"mcpStatus_needs-auth":"mcpStatus_needs-auth_yumWmQ"}`].join(";");
    const map = harvestClassMap(bundle);
    expect(map.yumWmQ?.["mcpStatus_needs-auth"]).toBe("mcpStatus_needs-auth_yumWmQ");
  });

  it("skips a string-valued property whose value is not <local>_<hash>", () => {
    // sessionId's value happens to end in six word-ish characters after an underscore, which is
    // exactly the shape a class value has — but it does not start with "sessionId_", so it must
    // not be harvested as a bogus local name in a module called OOQiHg.
    const bundle = [filler, `{sessionId:"abc123_OOQiHg",worktreePill:"worktreePill_OOQiHg"}`].join(
      ";",
    );
    const map = harvestClassMap(bundle);
    expect(map.OOQiHg?.worktreePill).toBe("worktreePill_OOQiHg");
    expect(map.OOQiHg?.sessionId).toBeUndefined();
  });

  it("keeps the last definition when a module repeats a local name", () => {
    // Both values satisfy the "starts with <local>_" guard and end in the same six-character
    // module hash; only the middle differs, standing in for two textual emissions of the same
    // module's map disagreeing (defensively — a real compiler would not actually disagree).
    const bundle = [filler, `{foo:"foo_bar_cccccc"}`, filler, `{foo:"foo_baz_cccccc"}`].join(";");
    const map = harvestClassMap(bundle);
    expect(map.cccccc?.foo).toBe("foo_baz_cccccc");
    // The repeat must not be double-counted: one local name in one module is one class.
    expect(Object.keys(map.cccccc ?? {})).toEqual(["foo"]);
  });
});

describe("cssClasses", () => {
  it("groups stylesheet rules by module hash", () => {
    const css = ".tab_aaaaaa{color:red}.tab_bbbbbb{color:blue}";
    const result = cssClasses(css);
    expect(result.get("aaaaaa")).toEqual(new Set(["tab"]));
    expect(result.get("bbbbbb")).toEqual(new Set(["tab"]));
  });

  it("takes the last underscore group as the module hash for a hyphenated local name", () => {
    // A naive parse would land on a phantom module "needs-" with local "mcpStatus". The greedy
    // local-name group must backtrack only as far as leaving a trailing "_<6 chars>".
    const css = ".mcpStatus_needs-auth_yumWmQ{display:none}";
    const result = cssClasses(css);
    expect(result.get("yumWmQ")).toEqual(new Set(["mcpStatus_needs-auth"]));
    expect(result.has("needs-")).toBe(false);
  });
});

describe("collidingLocalNames", () => {
  it("returns local names defined by more than one module, sorted", () => {
    const map: ClassMap = {
      zzzzzz: { shared: "shared_zzzzzz", onlyHere: "onlyHere_zzzzzz" },
      aaaaaa: { shared: "shared_aaaaaa", another: "another_aaaaaa" },
      bbbbbb: { another: "another_bbbbbb" },
    };
    expect(collidingLocalNames(map)).toEqual(["another", "shared"]);
  });

  it("returns nothing when no local name repeats", () => {
    const map: ClassMap = { aaaaaa: { foo: "foo_aaaaaa" }, bbbbbb: { bar: "bar_bbbbbb" } };
    expect(collidingLocalNames(map)).toEqual([]);
  });
});

describe("unreachableCssClasses", () => {
  it("reports a whole missing module as non-partial and a short-changed module as partial", () => {
    const map: ClassMap = { eeeeee: { foo: "foo_eeeeee" } };
    const css = ".foo_eeeeee{}.bar_eeeeee{}.baz_dddddd{}";
    const gaps = unreachableCssClasses(map, css);
    expect(gaps).toEqual([
      { module: "dddddd", locals: ["baz"], partial: false },
      { module: "eeeeee", locals: ["bar"], partial: true },
    ]);
  });

  it("reports nothing when the map already accounts for every stylesheet class", () => {
    const map: ClassMap = { aaaaaa: { foo: "foo_aaaaaa" } };
    const css = ".foo_aaaaaa{}";
    expect(unreachableCssClasses(map, css)).toEqual([]);
  });
});

describe("serialiseClassMap", () => {
  it("sorts keys at both levels, 2-space indents, and ends with a trailing newline", () => {
    const map: ClassMap = {
      b: { y: "y_b", x: "x_b" },
      a: { z: "z_a" },
    };
    const expected = `${JSON.stringify({ a: { z: "z_a" }, b: { x: "x_b", y: "y_b" } }, null, 2)}\n`;
    expect(serialiseClassMap(map)).toBe(expected);
  });
});

describe("classCount", () => {
  it("sums locals across every module", () => {
    const map: ClassMap = { a: { x: "x_a", y: "y_a" }, b: { z: "z_b" } };
    expect(classCount(map)).toBe(3);
  });
});

describe("harvestClassSites", () => {
  it("counts a class once per property access on its module's variable", () => {
    const bundle = [
      appliedFillerBundle(32, 10),
      `var A={tab:"tab_aaaaaa",row:"row_aaaaaa"}`,
      `x(A.tab);y(A.tab);z(A.row)`,
    ].join(";");
    const classes = harvestClasses(bundle);
    expect(siteCount(classes, "aaaaaa", "tab")).toBe(2);
    expect(siteCount(classes, "aaaaaa", "row")).toBe(1);
  });

  it("counts a class the bundle defines and never applies as zero, not as absent", () => {
    const bundle = [
      appliedFillerBundle(32, 10),
      `var A={tab:"tab_aaaaaa",dead:"dead_aaaaaa"}`,
      `x(A.tab)`,
    ].join(";");
    const classes = harvestClasses(bundle);
    expect(classes.map.aaaaaa?.dead).toBe("dead_aaaaaa");
    expect(siteCount(classes, "aaaaaa", "dead")).toBe(0);
  });

  it("finds the variable of a lazily initialised module, which carries no declaration keyword", () => {
    const bundle = [
      appliedFillerBundle(32, 10),
      `var qS;var init=(()=>{qS={copyButton:"copyButton_aaaaaa"}})`,
      `F("button",{className:qS.copyButton})`,
    ].join(";");
    expect(siteCount(harvestClasses(bundle), "aaaaaa", "copyButton")).toBe(1);
  });

  it("does not count a longer identifier that starts with a module variable's name", () => {
    const bundle = [
      appliedFillerBundle(32, 10),
      `var A={tab:"tab_aaaaaa"}`,
      `var A1={other:1}`,
      `x(A.tab);y(A1.tab)`,
    ].join(";");
    expect(siteCount(harvestClasses(bundle), "aaaaaa", "tab")).toBe(1);
  });

  it("does not count a property access on something that merely ends in a module variable's name", () => {
    const bundle = [appliedFillerBundle(32, 10), `var A={tab:"tab_aaaaaa"}`, `x(q.A.tab)`].join(
      ";",
    );
    expect(siteCount(harvestClasses(bundle), "aaaaaa", "tab")).toBe(0);
  });

  it("reports a module whose variable it cannot find as uncounted rather than as zeroes", () => {
    // A map literal passed straight into a call is bound to no name, so nothing can refer to it.
    const bundle = [appliedFillerBundle(32, 10), `use({tab:"tab_aaaaaa"})`].join(";");
    const classes = harvestClasses(bundle);
    expect(classes.map.aaaaaa?.tab).toBe("tab_aaaaaa");
    expect(classes.uncounted).toContain("aaaaaa");
    expect(siteCount(classes, "aaaaaa", "tab")).toBeNull();
  });

  it("throws below the reference floor, because that is the access pattern having drifted", () => {
    const map = harvestClassMap(fillerBundle(32, 10));
    expect(() => harvestClassSites(fillerBundle(32, 10), map)).toThrow(HarvestError);
  });
});

describe("classesLayer", () => {
  it("harvests from bundles.webview and projects every view", () => {
    const bundle = [
      appliedFillerBundle(32, 10),
      `var A={tab:"tab_aaaaaa"}`,
      `var B={tab:"tab_bbbbbb"}`,
      `x(A.tab);y(A.tab);z(B.tab)`,
    ].join(";");
    const classes = classesLayer.harvest({
      version: "0.0.0",
      webview: bundle,
      host: "",
      css: "",
    });
    expect(classes.map.aaaaaa?.tab).toBe("tab_aaaaaa");

    expect(classesLayer.views.classes?.(classes).has("tab_aaaaaa")).toBe(true);
    expect(classesLayer.views.modules?.(classes).has("aaaaaa")).toBe(true);
    expect(classesLayer.views.locals?.(classes).has("tab")).toBe(true);
    // Two sites for one, one for the other: `reused` is the whole ambiguity signal (D7).
    expect(classesLayer.views.reused?.(classes).has("tab_aaaaaa")).toBe(true);
    expect(classesLayer.views.reused?.(classes).has("tab_bbbbbb")).toBe(false);
  });
});

/**
 * The corpus tests below are the only guard against the regexes above drifting from what a real
 * bundle actually looks like; they skip with a reason rather than failing when the corpus is
 * absent, so a fresh clone is never blocked on a multi-megabyte download.
 */
describe("corpus", () => {
  for (const version of CORPUS_VERSIONS) {
    describe(`${version}`, () => {
      it.skipIf(missing(version))("harvests the known anchor classes", () => {
        const bundles = corpusBundles(version);
        const map = harvestClassMap(bundles.webview);

        expect(map.gGYT1w?.modelPill).toBe("modelPill_gGYT1w");
        expect(map.gGYT1w?.modelPillRow).toBe("modelPillRow_gGYT1w");
        expect(map.OOQiHg?.sessionItem).toBe("sessionItem_OOQiHg");
        expect(map.OOQiHg?.worktreePill).toBe("worktreePill_OOQiHg");
        expect(map["07S1Yg"]?.message).toBe("message_07S1Yg");
        expect(map["07S1Yg"]?.timelineMessage).toBeDefined();
        expect(map["07S1Yg"]?.userMessageContainer).toBeDefined();
        expect(map.aqhumA?.worktreeBannerName).toBe("worktreeBannerName_aqhumA");
        expect(map.yumWmQ?.["mcpStatus_needs-auth"]).toBe("mcpStatus_needs-auth_yumWmQ");
      });

      it.skipIf(missing(version))(
        "finds a module count and class count in the observed range",
        () => {
          const bundles = corpusBundles(version);
          const map = harvestClassMap(bundles.webview);
          const modules = Object.keys(map).length;
          const classes = classCount(map);

          expect(modules).toBeGreaterThanOrEqual(60);
          expect(modules).toBeLessThanOrEqual(200);
          expect(classes).toBeGreaterThanOrEqual(600);
          expect(classes).toBeLessThanOrEqual(2000);
        },
      );

      it.skipIf(missing(version))("reports colliding local names, including tab", () => {
        const bundles = corpusBundles(version);
        const map = harvestClassMap(bundles.webview);
        const colliding = collidingLocalNames(map);

        expect(colliding.length).toBeGreaterThan(0);
        expect(colliding).toContain("tab");
      });

      it.skipIf(missing(version))("reports no partial unreachable module", () => {
        const bundles = corpusBundles(version);
        const map = harvestClassMap(bundles.webview);
        const gaps = unreachableCssClasses(map, bundles.css);

        expect(gaps.every((gap) => !gap.partial)).toBe(true);
      });
    });
  }

  // The module hash is the module's identity (decisions.md, D6) and is not expected to churn
  // between adjacent releases. 2.1.268 to 2.1.269 is not a fair test of that: it carries real
  // product changes (a confirm dialog removed, several panels added), so the hash sets genuinely
  // differ there. 2.1.269 and 2.1.270 carry no such change and are the pair this invariant holds
  // for in the current corpus.
  it.skipIf(missing("2.1.269") || missing("2.1.270"))(
    "the module hash set is identical between 2.1.269 and 2.1.270",
    () => {
      const modules269 = new Set(Object.keys(harvestClassMap(corpusBundles("2.1.269").webview)));
      const modules270 = new Set(Object.keys(harvestClassMap(corpusBundles("2.1.270").webview)));
      expect(modules270).toEqual(modules269);
    },
  );
});
