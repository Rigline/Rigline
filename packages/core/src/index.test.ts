import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "./index.ts";

describe("@prototype/core", () => {
  it("builds and exports a version", () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
