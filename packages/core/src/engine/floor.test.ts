import { describe, expect, it } from "vitest";
import { enginesNode, nodeFloorProblem } from "./floor.ts";

describe("nodeFloorProblem", () => {
  it.each(["22.12.0", "22.13.1", "23.0.0", "26.5.1"])("lets %s through a 22.12.0 floor", (node) => {
    expect(nodeFloorProblem(node, ">=22.12.0")).toBeNull();
  });

  it.each(["22.11.0", "20.18.1", "18.20.4"])(
    "names the floor and the Node found for %s",
    (node) => {
      expect(nodeFloorProblem(node, ">=22.12.0")).toBe(
        `this engine needs Node 22.12.0 or newer, and this is Node ${node}`,
      );
    },
  );

  it("says nothing about a range it does not read, rather than guessing", () => {
    expect(nodeFloorProblem("18.0.0", "^22 || >=24")).toBeNull();
    expect(nodeFloorProblem("18.0.0", undefined)).toBeNull();
  });

  it("reads the floor this package declares", () => {
    expect(enginesNode()).toMatch(/^>=\d+\.\d+\.\d+$/);
  });
});
