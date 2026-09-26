import { describe, expect, it } from "vitest";
import { injectedDir, injectsHere } from "./scope.ts";

describe("injectsHere", () => {
  it("is true for VS Code's own extensions directory", () => {
    expect(injectsHere("/home/leo/.vscode/extensions", "/home/leo", "linux")).toBe(true);
    expect(injectsHere("/home/leo/.vscode/extensions/", "/home/leo", "linux")).toBe(true);
  });

  it("is false for another editor, a remote host or a custom directory", () => {
    expect(injectsHere("/home/leo/.cursor/extensions", "/home/leo", "linux")).toBe(false);
    expect(injectsHere("/home/leo/.vscode-server/extensions", "/home/leo", "linux")).toBe(false);
    expect(injectsHere("/opt/vscode/data/extensions", "/home/leo", "linux")).toBe(false);
  });

  it("ignores case on Windows, where VS Code may hand over a lower-case drive letter", () => {
    const home = "C:\\Users\\lione";
    expect(injectsHere("c:\\users\\lione\\.vscode\\extensions", home, "win32")).toBe(true);
    expect(injectsHere("c:\\users\\lione\\.cursor\\extensions", home, "win32")).toBe(false);
  });

  it("names the directory it compares against", () => {
    expect(injectedDir("/home/leo", "linux")).toBe("/home/leo/.vscode/extensions");
  });
});
