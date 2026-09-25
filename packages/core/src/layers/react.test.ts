import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORPUS_VERSIONS, corpusBundles, missing } from "../../test/corpus.ts";
import { REACT_BODY } from "../../test/fixtures.ts";
import { bundledDir } from "../assets.ts";
import { DEVTOOLS_HOOK, harvestReact } from "./react.ts";

describe("the pre hook's own spelling", () => {
  it("is the one this layer asserts, in the pre.js a user's install carries", () => {
    const pre = readFileSync(join(bundledDir(), "pre.js"), "utf8");
    expect(pre).toContain(DEVTOOLS_HOOK);
  });
});

describe("harvestReact", () => {
  for (const version of CORPUS_VERSIONS) {
    it.skipIf(missing(version))(`resolves the React anchors on ${version}`, () => {
      const anchors = harvestReact(corpusBundles(version).webview);
      expect(anchors.hook).toBe(DEVTOOLS_HOOK);
      expect(anchors.version).toMatch(/^18\./);
      expect(anchors.missing).toEqual([]);
    });
  }

  it("returns the version from a complete fixture, with nothing missing", () => {
    expect(harvestReact(REACT_BODY)).toEqual({
      hook: DEVTOOLS_HOOK,
      version: "18.3.1",
      missing: [],
    });
  });

  it("names the devtools hook when it is missing, and still reads the version", () => {
    const anchors = harvestReact(
      REACT_BODY.replaceAll(DEVTOOLS_HOOK, "REACT_DEVTOOLS_HOOK_REMOVED"),
    );
    expect(anchors.version).toBe("18.3.1");
    expect(anchors.missing).toEqual([
      {
        needs: `"${DEVTOOLS_HOOK}"`,
        breaks:
          "the pre hook would install a hook react-dom never looks for, so no commit is ever seen",
      },
    ]);
  });

  it("names the fiber accessor when it is missing", () => {
    const anchors = harvestReact(REACT_BODY.replace("findFiberByHostInstance", "somethingElse"));
    expect(anchors.missing).toEqual([
      {
        needs: '"findFiberByHostInstance"',
        breaks: "the host could not get from a row element to its fiber",
      },
    ]);
  });

  it("names the renderer descriptor distinctly, and has no version without it", () => {
    const anchors = harvestReact(REACT_BODY.replace(',rendererPackageName:"react-dom"', ""));
    expect(anchors.version).toBeNull();
    expect(anchors.missing.map((gap) => gap.needs)).toEqual(["renderer descriptor"]);
  });

  it("names a version that has moved away from its descriptor", () => {
    const anchors = harvestReact(REACT_BODY.replace('version:"18.3.1",', ""));
    expect(anchors.version).toBeNull();
    expect(anchors.missing.map((gap) => gap.needs)).toEqual([
      "version beside its renderer descriptor",
    ]);
  });
});
