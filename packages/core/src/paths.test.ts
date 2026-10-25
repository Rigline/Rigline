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
      config: join("/g", "config.yaml"),
      sources: join("/g", "sources.json"),
      anchors: join("/g", "anchors.json"),
      plugins: join("/g", "plugins"),
      presets: join("/g", "presets"),
      previousLayout: join("/g", "previous-layout.yaml"),
      baseline: join("/g", "baseline.json"),
      drift: join("/g", "drift.txt"),
      token: join("/g", "token"),
      injectLock: join("/g", "inject.lock"),
      companionLock: join("/g", "companion.lock"),
      restored: join("/g", "restored"),
    });
  });
});
