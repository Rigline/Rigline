/**
 * `rigline` belongs in no project's dependencies (D69), with one named exception (D80).
 *
 * It is a retrieval layer: a project that can declare dependencies declares `@rigline/core` and
 * spells the bin `rigline-engine`. Declaring the wrapper instead means the project's own `build` or
 * `codegen` reaches for an engine from the registry — which fails slowly, from inside pnpm, with an
 * error about a version rather than about the mistake. It is the payload error one layer down, so
 * this asserts the acceptance criterion rather than leaving it to a build to discover.
 *
 * The companion extension is the case D69 did not anticipate: it wants the *shell* precisely
 * because it must not have the substance. Declaring `@rigline/core` there is the embedding D80
 * rejects, and it never runs the wrapper's bin — it bundles one module for the acquisition code, so
 * nothing reaches a registry at build time and the hazard above does not apply. The allowance is by
 * name and exact, so a second one fails here rather than passing quietly.
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

/** The companion, and nothing else (D80). Exact, so this fails in both directions. */
const ALLOWED = [join("packages", "vscode", "package.json")];

describe("the wrapper as a dependency", () => {
  it("is declared by nothing in the tree or in a generated scaffold, bar the companion", () => {
    const declaring = manifests().filter((path) => {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      return "rigline" in { ...parsed.dependencies, ...parsed.devDependencies };
    });
    expect(declaring.map((p) => p.slice(ROOT.length))).toEqual(ALLOWED);
  });

  it("is what packages/cli is, so nothing above would have been checking itself", () => {
    // The guard is only worth having if it is reading the real manifests: a walk that found none
    // would pass this file and say nothing.
    const found = manifests();
    expect(found).toContain(join(ROOT, "packages", "cli", "package.json"));
    expect(found.length).toBeGreaterThan(8);
  });
});
