import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prototypeHome, prototypePaths } from "./paths.ts";

describe("prototypeHome", () => {
  it("defaults to ~/.prototype and honours PROTOTYPE_HOME", () => {
    expect(prototypeHome({})).toBe(join(homedir(), ".prototype"));
    expect(prototypeHome({ PROTOTYPE_HOME: "/elsewhere" })).toBe("/elsewhere");
    expect(prototypeHome({ PROTOTYPE_HOME: "" })).toBe(join(homedir(), ".prototype"));
  });

  it("lays out the state directory under the home", () => {
    const paths = prototypePaths("/g");
    expect(paths).toEqual({
      home: "/g",
      config: join("/g", "config.json"),
      plugins: join("/g", "plugins"),
      baseline: join("/g", "baseline.json"),
      snapshots: join("/g", "snapshots"),
    });
  });
});
