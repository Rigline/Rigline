import { describe, expect, it } from "vitest";
import { EMPTY_USES, patchShapeProblem, SURFACES, validateManifest } from "./manifest.ts";

const minimal = { api: 1, name: "demo", entry: "dist/index.js" };

describe("validateManifest", () => {
  it("fills every uses key and all surfaces for a minimal manifest", () => {
    const result = validateManifest(minimal, "demo");
    expect(result.problems).toEqual([]);
    expect(result.manifest).toEqual({
      api: 1,
      name: "demo",
      description: null,
      entry: "dist/index.js",
      surfaces: SURFACES,
      uses: EMPTY_USES,
      patches: [],
    });
  });

  it("keeps a full declaration as written", () => {
    const result = validateManifest(
      {
        ...minimal,
        description: "d",
        surfaces: ["sidebar"],
        uses: { anchors: ["modelPill"], rewrites: { rename_tab: ["title"] }, session: true },
        patches: [{ find: "ab", replace: "cd", why: "because", required: true }],
      },
      "demo",
    );
    expect(result.problems).toEqual([]);
    expect(result.manifest?.uses).toEqual({
      ...EMPTY_USES,
      anchors: ["modelPill"],
      rewrites: { rename_tab: ["title"] },
      session: true,
    });
    expect(result.manifest?.surfaces).toEqual(["sidebar"]);
    expect(result.manifest?.patches).toHaveLength(1);
  });

  it("collects every problem rather than stopping at the first", () => {
    const { manifest, problems } = validateManifest(
      {
        api: 2,
        name: "Demo",
        entry: "",
        surfaces: ["popup"],
        uses: { anchors: ["nonsense"], tools: "yes", bogus: true },
        patches: [{ find: "abc", replace: "ab", why: "" }],
      },
      "demo",
    );
    expect(manifest).toBeNull();
    expect(problems).toEqual([
      '"api" must be 1, got 2',
      '"name" must be a lowercase package-name segment, got "Demo"',
      '"entry" must be a non-empty relative path',
      '"surfaces" contains "popup"; expected editor, sidebar, sessionList',
      '"uses.bogus" is not a capability',
      '"uses.anchors" names anchors that do not exist: nonsense',
      '"uses.tools" must be true or false, got "yes"',
      '"patches[0]" needs a non-empty string "why"',
    ]);
  });

  it("requires the name to match the directory and the entry to stay inside it", () => {
    expect(validateManifest(minimal, "other").problems).toEqual([
      '"name" is "demo" but the directory is "other"',
    ]);
    expect(validateManifest({ ...minimal, entry: "../x.js" }, "demo").problems).toEqual([
      '"entry" must stay inside the plugin directory',
    ]);
    expect(validateManifest({ ...minimal, entry: "C:/x.js" }, "demo").problems).toEqual([
      '"entry" must be relative to the manifest',
    ]);
  });

  it("rejects a non-object outright", () => {
    expect(validateManifest("nope", "demo").problems).toEqual([
      "rigline.json must be a JSON object",
    ]);
  });
});

describe("patchShapeProblem", () => {
  it("holds a patch to equal byte length, non-identity and non-empty strings", () => {
    expect(patchShapeProblem({ find: "!1", replace: "!0", why: "w" })).toBeNull();
    expect(patchShapeProblem({ find: "ab", replace: "abc", why: "w" })).toMatch(/same byte length/);
    // Byte length, not code units: a two-byte character is two bytes.
    expect(patchShapeProblem({ find: "ab", replace: "\u00e9", why: "w" })).toBeNull();
    expect(patchShapeProblem({ find: "ab", replace: "ab", why: "w" })).toMatch(/patches nothing/);
    expect(patchShapeProblem({ find: "", replace: "", why: "w" })).toMatch(/"find"/);
    expect(patchShapeProblem({ find: "a", replace: "b", why: "w", required: "yes" })).toMatch(
      /"required"/,
    );
    expect(patchShapeProblem(null)).toBe("must be an object");
  });
});
