import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { incompleteEngine } from "./incomplete.ts";

const home = join("/users", "someone", ".rigline");
const missing = new Error("Cannot find package 'yaml' imported from index.js");

describe("incompleteEngine", () => {
  it("says to delete the wrapper's engine directory when the bin is inside it", () => {
    const bin = join(
      home,
      "engine",
      "node_modules",
      "@rigline",
      "core",
      "dist",
      "engine",
      "bin.js",
    );
    expect(incompleteEngine(missing, bin, home)).toBe(
      "this engine is missing part of itself: Cannot find package 'yaml' imported from index.js. " +
        `Delete ${join(home, "engine")} and run the command again, which fetches it afresh.`,
    );
  });

  it("never says to delete a directory the wrapper does not own", () => {
    const bin = join("/usr", "lib", "node_modules", "@rigline", "core", "dist", "engine", "bin.js");
    expect(incompleteEngine(missing, bin, home)).toBe(
      "this engine is missing part of itself: Cannot find package 'yaml' imported from index.js. " +
        "Reinstall @rigline/core.",
    );
  });
});
