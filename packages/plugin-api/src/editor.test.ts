import { describe, expect, it } from "vitest";
import { attachableOf, fileName, readEditorSettings, sameEditorContext } from "./editor.ts";

describe("readEditorSettings", () => {
  it("reads absent as ask, and an unknown value as always, naming it", () => {
    expect(readEditorSettings(undefined)).toEqual({ settings: { attach: "ask" }, unknown: [] });
    expect(readEditorSettings({ attach: "always" })).toEqual({
      settings: { attach: "always" },
      unknown: [],
    });
    expect(readEditorSettings({ attach: "sometimes", later: 1 })).toEqual({
      settings: { attach: "always" },
      unknown: ["editor.later", "editor.attach: sometimes"],
    });
  });

  it("refuses a block or a value of the wrong shape", () => {
    expect(readEditorSettings("ask")).toEqual({
      problem: '"editor" must be a mapping of settings',
    });
    expect(readEditorSettings({ attach: true })).toEqual({
      problem: '"editor.attach" must be one of ask, always',
    });
  });
});

describe("attachableOf", () => {
  it("reads selected text as lines, and anything else as the file alone, as the panel does", () => {
    const base = { filePath: "c:\\work\\notes.md", startLine: 10, endLine: 12 };
    expect(attachableOf({ ...base, selectedText: "a\nb\nc" })).toEqual({
      path: "c:\\work\\notes.md",
      lines: { start: 10, end: 12 },
    });
    expect(attachableOf({ ...base, selectedText: "" })).toEqual({
      path: "c:\\work\\notes.md",
      lines: null,
    });
    expect(attachableOf(base)).toEqual({ path: "c:\\work\\notes.md", lines: null });
    expect(attachableOf({ startLine: 1 })).toBeNull();
    expect(attachableOf(undefined)).toBeNull();
  });

  it("names the file as Claude Code's chip does", () => {
    expect(fileName("c:\\work\\notes.md")).toBe("notes.md");
    expect(fileName("/home/me/app.ts")).toBe("app.ts");
  });
});

describe("sameEditorContext", () => {
  it("compares by what the chip shows", () => {
    const a = { available: { path: "x", lines: { start: 1, end: 2 } }, ticked: false };
    expect(
      sameEditorContext(a, { ...a, available: { path: "x", lines: { start: 1, end: 2 } } }),
    ).toBe(true);
    expect(sameEditorContext(a, { ...a, ticked: true })).toBe(false);
    expect(sameEditorContext(a, { available: null, ticked: false })).toBe(false);
  });
});
