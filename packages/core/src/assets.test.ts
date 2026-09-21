/**
 * Where core finds what it ships (D71).
 *
 * These run inside this workspace, which is the only place the workspace marker holds — so they
 * assert the checkout's answers directly and the published one by what the rule is made of. There
 * is a fourth tier for the published case, and it installs a tarball and runs it
 * (docs/verification.md).
 */
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundledDir,
  bundledPluginsDir,
  checkoutPluginsDir,
  corePackageDir,
  workspaceRoot,
} from "./assets.ts";

describe("resolving core's own package", () => {
  it("walks up to the nearest package.json rather than counting directories", () => {
    // The whole point of the walk: `src` under vitest's alias, `dist` when built, and
    // `node_modules/@rigline/core` when published all land on the same package root, where a fixed
    // offset from `import.meta.url` is a different answer in each.
    const dir = corePackageDir();
    expect(existsSync(join(dir, "package.json"))).toBe(true);
    expect(basename(dir)).toBe("core");
  });

  it("recognises this workspace by its root manifest's name", () => {
    const root = workspaceRoot();
    expect(root).not.toBeNull();
    expect(existsSync(join(root as string, "pnpm-workspace.yaml"))).toBe(true);
  });
});

describe("the discovery roots core owns", () => {
  it("finds the checkout's plugins, which are the ones that outrank the bundled set", () => {
    const dir = checkoutPluginsDir();
    expect(dir).not.toBeNull();
    expect(existsSync(join(dir as string, "probe", "rigline.json"))).toBe(true);
  });

  it("carries the payload and every first-party plugin in dist/bundled", () => {
    // What a published install gets, and the reason `npm i -g rigline && rigline install` injects
    // at all: before this, no published package carried the payload or a plugin.
    const bundled = bundledDir();
    for (const file of ["pre.js", "post.js"]) {
      expect(existsSync(join(bundled, file))).toBe(true);
    }
    for (const name of ["probe", "session-id", "time-marks", "worktree-prefix"]) {
      const dir = join(bundledPluginsDir(), name);
      // Its manifest's own `entry`, never rewritten, so the bytes a user's engine validates are
      // the bytes this repository tested.
      expect(existsSync(join(dir, "rigline.json"))).toBe(true);
      expect(existsSync(join(dir, "dist", "index.js"))).toBe(true);
    }
  });

  it("puts the bundled plugins under the resolved core package, not beside this test", () => {
    expect(dirname(dirname(bundledPluginsDir()))).toBe(join(corePackageDir(), "dist"));
  });
});
