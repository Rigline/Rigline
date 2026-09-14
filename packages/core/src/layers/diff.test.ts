import { describe, expect, it } from "vitest";
import {
  diffScans,
  formatDiff,
  type Scan,
  scanFromJson,
  scansDiffer,
  scanToJson,
  successorSuggestions,
} from "./diff.ts";

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

describe("successorSuggestions", () => {
  it("names a rename when a module lost and gained exactly one name each", () => {
    const diff = diffScans(
      scan("1", { "classes.classes": ["navTabOld_hONcXw", "unrelated_ZZZZZZ"] }),
      scan("2", { "classes.classes": ["navTabNew_hONcXw", "unrelated_ZZZZZZ"] }),
    )[0];
    expect(diff).toBeDefined();
    expect(successorSuggestions(diff as NonNullable<typeof diff>)).toEqual([
      { module: "hONcXw", kind: "rename", gone: "navTabOld_hONcXw", added: "navTabNew_hONcXw" },
    ]);
  });

  it("names a group, not a guessed pair, when a module changed by more than one name on either side", () => {
    const diff = diffScans(
      scan("1", { "classes.classes": ["a_ABC123", "b_ABC123"] }),
      scan("2", { "classes.classes": ["c_ABC123", "d_ABC123"] }),
    )[0];
    expect(diff).toBeDefined();
    expect(successorSuggestions(diff as NonNullable<typeof diff>)).toEqual([
      { module: "ABC123", kind: "group", goneCount: 2, addedCount: 2 },
    ]);
  });

  it("suggests nothing for a module that only lost names, or only gained them", () => {
    const diff = diffScans(
      scan("1", { "classes.classes": ["gone_ONLY01", "kept_SHARED"] }),
      scan("2", { "classes.classes": ["kept_SHARED", "added_ONLY02"] }),
    )[0];
    expect(diff).toBeDefined();
    expect(successorSuggestions(diff as NonNullable<typeof diff>)).toEqual([]);
  });

  it("is silent on views with no module scoping, even when an identifier coincidentally shape-matches", () => {
    // `__REACT_DEVTOOLS_GLOBAL_HOOK__` ends in `_HOOK__`, six characters after an underscore — the
    // exact false positive the view check exists to refuse (see diff.ts).
    const diff = diffScans(
      scan("1", { "react.anchors": ["__REACT_DEVTOOLS_GLOBAL_HOOK__"] }),
      scan("2", { "react.anchors": ["__REACT_DEVTOOLS_GLOBAL_HOOK_V2__"] }),
    )[0];
    expect(diff).toBeDefined();
    expect(successorSuggestions(diff as NonNullable<typeof diff>)).toEqual([]);
  });

  it("orders suggestions by module", () => {
    const diff = diffScans(
      scan("1", { "classes.classes": ["x_ZZZZZZ", "y_AAAAAA"] }),
      scan("2", { "classes.classes": ["x2_ZZZZZZ", "y2_AAAAAA"] }),
    )[0];
    expect(diff).toBeDefined();
    expect(successorSuggestions(diff as NonNullable<typeof diff>).map((s) => s.module)).toEqual([
      "AAAAAA",
      "ZZZZZZ",
    ]);
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

  it("names a successor under the gone: line it belongs to", () => {
    const from = scan("1", { "classes.classes": ["navTabOld_hONcXw"] });
    const to = scan("2", { "classes.classes": ["navTabNew_hONcXw"] });
    const text = formatDiff(from, to, diffScans(from, to));
    const lines = text.split("\n");
    const goneIndex = lines.findIndex((l) => l.includes("gone:"));
    expect(goneIndex).toBeGreaterThan(-1);
    expect(lines[goneIndex + 1]).toContain("successor: navTabOld_hONcXw -> navTabNew_hONcXw");
  });

  it("names a group rather than a guessed pair when a module changed by more than one name", () => {
    const from = scan("1", { "classes.classes": ["a_ABC123", "b_ABC123"] });
    const to = scan("2", { "classes.classes": ["c_ABC123", "d_ABC123"] });
    const text = formatDiff(from, to, diffScans(from, to));
    expect(text).toContain("candidates: module ABC123 lost 2 and gained 2");
  });

  it("truncates successor lines under the same nameLimit as gone, with a count of the rest", () => {
    const from = scan("1", {
      "classes.classes": ["a_111111", "b_222222", "c_333333"],
    });
    const to = scan("2", {
      "classes.classes": ["a2_111111", "b2_222222", "c2_333333"],
    });
    const text = formatDiff(from, to, diffScans(from, to), 2);
    expect(text).toContain("and 1 more module(s) with both");
  });

  it("suggests nothing, and adds no line, for a view with no module scoping", () => {
    const from = scan("1", { "protocol.messages": ["old_request"] });
    const to = scan("2", { "protocol.messages": ["new_request"] });
    const text = formatDiff(from, to, diffScans(from, to));
    expect(text).not.toContain("successor:");
    expect(text).not.toContain("candidates:");
  });
});
