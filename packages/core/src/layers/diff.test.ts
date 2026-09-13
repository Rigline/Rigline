import { describe, expect, it } from "vitest";
import { diffScans, formatDiff, type Scan, scanFromJson, scansDiffer, scanToJson } from "./diff.ts";

const scan = (version: string, views: Record<string, string[]>): Scan => ({
  version,
  views: Object.fromEntries(Object.entries(views).map(([k, v]) => [k, new Set(v)])),
});

describe("diffScans", () => {
  it("names what went and what arrived, per view, sorted", () => {
    const from = scan("1", {
      "classes.classes": ["b_X", "a_X", "c_X"],
      "protocol.messages": ["m"],
    });
    const to = scan("2", { "classes.classes": ["a_X", "c_X", "d_X"], "protocol.messages": ["m"] });
    const diffs = diffScans(from, to);
    expect(diffs.map((d) => d.view)).toEqual(["classes.classes", "protocol.messages"]);
    expect(diffs[0]).toEqual({
      view: "classes.classes",
      gone: ["b_X"],
      added: ["d_X"],
      kept: 2 / 3,
    });
    expect(diffs[1]).toEqual({ view: "protocol.messages", gone: [], added: [], kept: 1 });
  });

  it("reports n/a rather than a percentage of nothing when the old side is empty", () => {
    const diffs = diffScans(scan("1", { v: [] }), scan("2", { v: ["x"] }));
    expect(diffs[0]?.kept).toBeNull();
    expect(diffs[0]?.added).toEqual(["x"]);
  });

  it("treats a view present on one side only as empty on the other", () => {
    const diffs = diffScans(scan("1", { old: ["a"] }), scan("2", { new: ["b"] }));
    expect(diffs).toEqual([
      { view: "new", gone: [], added: ["b"], kept: null },
      { view: "old", gone: ["a"], added: [], kept: 0 },
    ]);
  });

  it("a scan diffed against itself has moved nothing", () => {
    const s = scan("1", { a: ["x", "y"], b: ["z"] });
    expect(scansDiffer(diffScans(s, s))).toBe(false);
  });
});

describe("scan serialisation", () => {
  it("round-trips through sorted JSON", () => {
    const s = scan("1.2.3", { "z.v": ["b", "a"], "a.v": ["q"] });
    const json = scanToJson(s);
    expect(Object.keys(json.views)).toEqual(["a.v", "z.v"]);
    expect(json.views["z.v"]).toEqual(["a", "b"]);
    const back = scanFromJson(json);
    expect(back.version).toBe("1.2.3");
    expect(scansDiffer(diffScans(s, back))).toBe(false);
  });
});

describe("formatDiff", () => {
  it("prints one line per view and names casualties up to the limit", () => {
    const from = scan("1", { v: ["a", "b", "c", "d"] });
    const to = scan("2", { v: ["d", "e"] });
    const text = formatDiff(from, to, diffScans(from, to), 2);
    expect(text).toContain("1 -> 2");
    expect(text).toContain("v");
    expect(text).toContain("25.0%");
    expect(text).toContain("-3  +1");
    expect(text).toContain("gone: a, b, and 1 more");
  });
});
