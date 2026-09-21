/**
 * `rigline` belongs in no project's dependencies (D69).
 *
 * It is a retrieval layer: a project that can declare dependencies declares `@rigline/core` and
 * spells the bin `rigline-engine`. Declaring the wrapper instead means the project's own `build` or
 * `codegen` reaches for an engine from the registry — which fails slowly, from inside pnpm, with an
 * error about a version rather than about the mistake. It is the payload error one layer down, so
 * this asserts the acceptance criterion rather than leaving it to a build to discover.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TEMPLATE = join(ROOT, "packages", "create-plugin", "template");

/** Every manifest in this workspace, and the two the scaffolder emits. */
function manifests(): string[] {
  const found = [join(ROOT, "package.json"), join(TEMPLATE, "package.json")];
  for (const group of ["packages", "plugins"]) {
    for (const entry of readdirSync(join(ROOT, group), { withFileTypes: true })) {
      const path = join(ROOT, group, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(path)) found.push(path);
    }
  }
  for (const entry of readdirSync(join(TEMPLATE, "plugins"), { withFileTypes: true })) {
    const path = join(TEMPLATE, "plugins", entry.name, "package.json");
    if (entry.isDirectory() && existsSync(path)) found.push(path);
  }
  return found;
}

describe("the wrapper as a dependency", () => {
  it("is declared by nothing in the tree or in a generated scaffold", () => {
    const declaring = manifests().filter((path) => {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      return "rigline" in { ...parsed.dependencies, ...parsed.devDependencies };
    });
    expect(declaring.map((p) => p.slice(ROOT.length))).toEqual([]);
  });

  it("is what packages/cli is, so nothing above would have been checking itself", () => {
    // The guard is only worth having if it is reading the real manifests: a walk that found none
    // would pass this file and say nothing.
    const found = manifests();
    expect(found).toContain(join(ROOT, "packages", "cli", "package.json"));
    expect(found.length).toBeGreaterThan(8);
  });
});
