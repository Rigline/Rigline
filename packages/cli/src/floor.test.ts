import { describe, expect, it } from "vitest";
import { nodeFloorProblem } from "../../core/src/engine/floor.ts";
import { belowFloor, enginesNode } from "./floor.ts";

describe("belowFloor", () => {
  it.each(["22.12.0", "22.13.1", "23.0.0", "26.5.1"])("lets %s through a 22.12.0 floor", (node) => {
    expect(belowFloor(node, ">=22.12.0")).toBeNull();
  });

  it.each(["22.11.0", "20.15.1", "18.20.4"])("answers the floor %s falls below", (node) => {
    expect(belowFloor(node, ">=22.12.0")).toBe("22.12.0");
  });

  it("says nothing about a range it does not read, rather than guessing", () => {
    expect(belowFloor("18.0.0", "^22 || >=24")).toBeNull();
    expect(belowFloor("18.0.0", undefined)).toBeNull();
  });

  it.each([
    ["20.15.1", ">=22.12.0"],
    ["22.12.0", ">=22.12.0"],
    ["18.0.0", "^22 || >=24"],
  ])("reads %s against %s as the engine's copy does", (node, range) => {
    expect(belowFloor(node, range) === null).toBe(nodeFloorProblem(node, range) === null);
  });

  it("reads the floor this package declares", () => {
    expect(enginesNode()).toMatch(/^>=\d+\.\d+\.\d+$/);
  });
});
