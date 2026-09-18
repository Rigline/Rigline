/**
 * The local anchor override (D44), against tables built here rather than the shipped one.
 *
 * `mergeAnchorOverrides` takes the base table as a parameter for exactly this reason: a rule about
 * what an entry may say is a rule about entries, and pinning it to `ANCHORS` would make every one
 * of these assertions a hostage to the next curation. The two tests that do use `ANCHORS` are the
 * ones about merging over a curated entry, which is the whole point of the feature.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANCHORS } from "@rigline/plugin-api";
import { afterEach, describe, expect, it } from "vitest";
import type { Classes } from "../layers/classes.ts";
import {
  anchorOverrideOutcomes,
  mergeAnchorOverrides,
  NO_ANCHOR_OVERRIDES,
  readAnchorOverrides,
} from "./overrides.ts";
import type { AnchorTable } from "./resolve.ts";

const PATH = "/home/tester/.rigline/anchors.json";

const BASE: AnchorTable = {
  pill: {
    module: "aaaaaa",
    local: "pill",
    kind: "singleton",
    refine: '[role="combobox"]',
    description: "The pill.",
  },
  row: { module: "bbbbbb", local: "row", kind: "collection", description: "A row." },
  look: { module: "cccccc", local: "look", kind: "style", description: "A look to borrow." },
};

/** A class map where every named pair exists and is applied `sites` times, default once. */
function classesOf(pairs: readonly [module: string, local: string, sites?: number][]): Classes {
  const map: Record<string, Record<string, string>> = {};
  const counts: Record<string, Record<string, number>> = {};
  for (const [module, local, sites] of pairs) {
    map[module] ??= {};
    counts[module] ??= {};
    map[module][local] = `${local}_${module}`;
    counts[module][local] = sites ?? 1;
  }
  return { map, sites: counts, uncounted: [] };
}

function merge(anchors: Record<string, unknown>, base: AnchorTable = BASE) {
  return mergeAnchorOverrides(base, { anchors }, PATH);
}

describe("mergeAnchorOverrides", () => {
  it("merges an entry field by field, so a repair states only what moved", () => {
    const result = merge({
      pill: { refine: '[data-testid="picker"]', why: "the role went in 2.1.271" },
    });
    expect(result.problems).toEqual([]);
    expect(result.names).toEqual(["pill"]);
    expect(result.added).toEqual([]);
    expect(result.table.pill).toEqual({
      module: "aaaaaa",
      local: "pill",
      kind: "singleton",
      refine: '[data-testid="picker"]',
      description: "The pill.",
    });
  });

  it("merges over the shipped table, which is what a user's file actually does", () => {
    const result = mergeAnchorOverrides(
      ANCHORS,
      { anchors: { modelPill: { module: "zzzzzz", why: "the module split" } } },
      PATH,
    );
    expect(result.problems).toEqual([]);
    expect(result.table.modelPill).toEqual({
      ...ANCHORS.modelPill,
      module: "zzzzzz",
    });
  });

  it("takes a field back out on null, which is how a refinement that stopped refining is undone", () => {
    const result = merge({ pill: { refine: null, why: "the role attribute is gone entirely" } });
    expect(result.problems).toEqual([]);
    expect(result.table.pill).not.toHaveProperty("refine");
  });

  it("refuses to clear a field every anchor needs", () => {
    const result = merge({ pill: { local: null, why: "trying it on" } });
    expect(result.problems).toEqual([
      `${PATH}: "pill" cannot clear "local", which every anchor needs`,
    ]);
    expect(result.table.pill).toEqual(BASE.pill);
    expect(result.names).toEqual([]);
  });

  it("adds a name the table has not got", () => {
    const result = merge({
      agentMap: {
        module: "dddddd",
        local: "agentMap",
        kind: "singleton",
        description: "The agent-map button.",
        why: "wanted before curation catches up",
      },
    });
    expect(result.problems).toEqual([]);
    expect(result.names).toEqual(["agentMap"]);
    expect(result.added).toEqual(["agentMap"]);
    expect(result.table.agentMap?.local).toBe("agentMap");
  });

  it("names what an addition is missing, since there is no shipped entry to fall back on", () => {
    const result = merge({ agentMap: { module: "dddddd", why: "half-written" } });
    expect(result.problems).toEqual([
      `${PATH}: "agentMap" adds an anchor the table has not got, so it needs local, kind, description`,
    ]);
    expect(result.table.agentMap).toBeUndefined();
  });

  it("requires a why, because the entry is the thing that gets pasted into an issue thread", () => {
    const result = merge({ pill: { refine: "[data-x]" } });
    expect(result.problems).toEqual([
      `${PATH}: "pill" needs a "why" saying what this override repairs`,
    ]);
    expect(result.names).toEqual([]);
  });

  it("rejects a field that is not one, rather than letting a misspelling do nothing", () => {
    const result = merge({ pill: { refined: "[data-x]", why: "typo" } });
    expect(result.problems[0]).toContain('has no field "refined"');
    expect(result.names).toEqual([]);
  });

  it("checks each field's own shape, and collects every problem in the entry", () => {
    const result = merge({
      pill: { kind: "elementish", refine: 4, knownSites: { count: 2 }, why: "wrong all through" },
    });
    expect(result.problems).toEqual([
      `${PATH}: "pill".kind must be one of singleton, collection, style`,
      `${PATH}: "pill".refine must be a non-empty string`,
      `${PATH}: "pill".knownSites needs a why saying how the extra application sites were accounted for`,
    ]);
  });

  it("takes knownSites, which is the other discharge for an ambiguous singleton", () => {
    const result = merge({
      pill: {
        refine: null,
        knownSites: { count: 2, why: "the second reference hands the class along as a value" },
        why: "2.1.271 dropped the role and the extra site is not a second control",
      },
    });
    expect(result.problems).toEqual([]);
    expect(result.table.pill?.knownSites).toEqual({
      count: 2,
      why: "the second reference hands the class along as a value",
    });
  });

  it("drops an entry whose within names nothing, and puts the shipped entry back", () => {
    const result = merge({ row: { within: "nowhere", why: "guessing" } });
    expect(result.problems).toEqual([
      `${PATH}: "row" sits within "nowhere", which is not an anchor`,
    ]);
    expect(result.table.row).toEqual(BASE.row);
    expect(result.names).toEqual([]);
  });

  it("drops an entry contained in a style, which is a look rather than an element", () => {
    const result = merge({ row: { within: "look", why: "wrong kind of anchor" } });
    expect(result.problems[0]).toContain("is a style to borrow rather than an element");
    expect(result.table.row).toEqual(BASE.row);
  });

  it("drops an entry whose within loops back to itself", () => {
    const result = merge({ pill: { within: "pill", why: "not thinking it through" } });
    expect(result.problems).toEqual([`${PATH}: "pill" sits within itself, through pill`]);
    expect(result.table.pill).toEqual(BASE.pill);
    expect(result.names).toEqual([]);
  });

  it("accepts a within the same file adds later, since the merge settles before it is checked", () => {
    const result = merge({
      row: { within: "panel", why: "the row moved inside the new panel" },
      panel: {
        module: "eeeeee",
        local: "panel",
        kind: "singleton",
        description: "The panel.",
        why: "not curated yet",
      },
    });
    expect(result.problems).toEqual([]);
    expect(result.table.row?.within).toBe("panel");
  });

  it("drops the bad entry and applies the rest", () => {
    const result = merge({
      pill: { refine: "[data-x]", why: "fine" },
      row: { kind: "nonsense", why: "broken" },
    });
    expect(result.problems).toHaveLength(1);
    expect(result.names).toEqual(["pill"]);
    expect(result.table.row).toEqual(BASE.row);
  });

  it("says so and applies nothing when the document itself is the wrong shape", () => {
    expect(mergeAnchorOverrides(BASE, [], PATH).problems).toEqual([
      `${PATH} must be a JSON object, so no override applies`,
    ]);
    expect(mergeAnchorOverrides(BASE, {}, PATH).problems).toEqual([
      `${PATH} has no "anchors" object, so no override applies`,
    ]);
    expect(mergeAnchorOverrides(BASE, { anchors: [] }, PATH).problems).toEqual([
      `${PATH}: "anchors" must be an object of anchor name to entry`,
    ]);
    expect(merge({ pill: "[data-x]" }).problems).toEqual([`${PATH}: "pill" must be an object`]);
  });
});

describe("readAnchorOverrides", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function fileWith(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), "rigline-anchors-"));
    dirs.push(dir);
    const path = join(dir, "anchors.json");
    writeFileSync(path, contents);
    return path;
  }

  it("is the shipped table when there is no file, which is almost everybody", () => {
    const result = readAnchorOverrides(join(tmpdir(), "rigline-nothing-here", "anchors.json"));
    expect(result.present).toBe(false);
    expect(result.problems).toEqual([]);
    expect(result.table).toBe(ANCHORS);
  });

  it("reports a file that will not parse and applies none of it, rather than throwing", () => {
    const path = fileWith("{ not json");
    const result = readAnchorOverrides(path);
    expect(result.present).toBe(true);
    expect(result.table).toBe(ANCHORS);
    expect(result.problems[0]).toContain("is not valid JSON, so no override applies");
  });

  it("merges a file over the shipped table", () => {
    const path = fileWith(
      JSON.stringify({
        anchors: {
          composer: { refine: "[data-composer]", why: "two controls wear the class now" },
        },
      }),
    );
    const result = readAnchorOverrides(path);
    expect(result.names).toEqual(["composer"]);
    expect(result.table.composer?.refine).toBe("[data-composer]");
    expect(ANCHORS.composer).not.toHaveProperty("refine");
  });
});

describe("anchorOverrideOutcomes", () => {
  /** `composer` is the shipped singleton with nothing to tell a second application site apart. */
  const composer = ANCHORS.composer;
  const ambiguous = classesOf([[composer.module, composer.local, 3]]);

  it("says nothing at all when there is no override", () => {
    expect(anchorOverrideOutcomes(ambiguous, NO_ANCHOR_OVERRIDES)).toEqual([]);
  });

  it("reports an entry that repairs an anchor this version would not resolve", () => {
    const overrides = mergeAnchorOverrides(
      ANCHORS,
      { anchors: { composer: { refine: "[data-composer]", why: "three sites since 2.1.271" } } },
      PATH,
    );
    expect(anchorOverrideOutcomes(ambiguous, overrides)).toEqual([
      { name: "composer", added: false, resolves: true, resolvedWithout: false },
    ]);
  });

  it("reports an entry the shipped table has caught up with, which is one to delete", () => {
    const overrides = mergeAnchorOverrides(
      ANCHORS,
      { anchors: { composer: { refine: "[data-composer]", why: "no longer needed" } } },
      PATH,
    );
    const unique = classesOf([[composer.module, composer.local]]);
    expect(anchorOverrideOutcomes(unique, overrides)).toEqual([
      { name: "composer", added: false, resolves: true, resolvedWithout: true },
    ]);
  });

  it("reports an entry that stops an anchor resolving, which nothing else would show", () => {
    const overrides = mergeAnchorOverrides(
      ANCHORS,
      { anchors: { composer: { module: "zzzzzz", why: "wrong module" } } },
      PATH,
    );
    const unique = classesOf([[composer.module, composer.local]]);
    expect(anchorOverrideOutcomes(unique, overrides)).toEqual([
      { name: "composer", added: false, resolves: false, resolvedWithout: true },
    ]);
  });

  it("marks an added name as added, resolved or not", () => {
    const overrides = mergeAnchorOverrides(
      ANCHORS,
      {
        anchors: {
          agentMap: {
            module: "dddddd",
            local: "agentMap",
            kind: "singleton",
            description: "The agent-map button.",
            why: "not curated yet",
          },
        },
      },
      PATH,
    );
    expect(anchorOverrideOutcomes(classesOf([["dddddd", "agentMap"]]), overrides)).toEqual([
      { name: "agentMap", added: true, resolves: true, resolvedWithout: false },
    ]);
    expect(anchorOverrideOutcomes(classesOf([["eeeeee", "other"]]), overrides)).toEqual([
      { name: "agentMap", added: true, resolves: false, resolvedWithout: false },
    ]);
  });
});
