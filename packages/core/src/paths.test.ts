import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { riglineHome, riglinePaths } from "./paths.ts";

describe("riglineHome", () => {
  it("defaults to ~/.rigline and honours RIGLINE_HOME", () => {
    expect(riglineHome({})).toBe(join(homedir(), ".rigline"));
    expect(riglineHome({ RIGLINE_HOME: "/elsewhere" })).toBe("/elsewhere");
    expect(riglineHome({ RIGLINE_HOME: "" })).toBe(join(homedir(), ".rigline"));
  });

  it("lays out the state directory under the home", () => {
    const paths = riglinePaths("/g");
    expect(paths).toEqual({
      home: "/g",
      config: join("/g", "config.json"),
      plugins: join("/g", "plugins"),
      baseline: join("/g", "baseline.json"),
      snapshots: join("/g", "snapshots"),
    });
  });
});
