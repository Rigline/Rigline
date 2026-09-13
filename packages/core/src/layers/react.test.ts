import { describe, expect, it } from "vitest";
import { CORPUS_VERSIONS, corpusBundles, missing } from "../../test/corpus.ts";
import { REACT_BODY } from "../../test/fixtures.ts";
import { DEVTOOLS_HOOK, harvestReact } from "./react.ts";

describe("harvestReact", () => {
  for (const version of CORPUS_VERSIONS) {
    it.skipIf(missing(version))(`resolves the React anchors on ${version}`, () => {
      const anchors = harvestReact(corpusBundles(version).webview);
      expect(anchors.hook).toBe(DEVTOOLS_HOOK);
      expect(anchors.version).toMatch(/^18\./);
    });
  }

  it("returns the version from a complete fixture", () => {
    expect(harvestReact(REACT_BODY)).toEqual({ hook: DEVTOOLS_HOOK, version: "18.3.1" });
  });

  it("throws naming the devtools hook when it is missing", () => {
    const bundle = REACT_BODY.replaceAll(DEVTOOLS_HOOK, "REACT_DEVTOOLS_HOOK_REMOVED");
    expect(() => harvestReact(bundle)).toThrow(/__REACT_DEVTOOLS_GLOBAL_HOOK__/);
  });

  it("throws naming the fiber accessor when it is missing", () => {
    const bundle = REACT_BODY.replace("findFiberByHostInstance", "somethingElse");
    expect(() => harvestReact(bundle)).toThrow(/row element to its fiber/);
  });

  it("throws distinctly when the renderer descriptor is gone", () => {
    const bundle = REACT_BODY.replace(',rendererPackageName:"react-dom"', "");
    expect(() => harvestReact(bundle)).toThrow(/renderer descriptor has moved/);
  });
});
