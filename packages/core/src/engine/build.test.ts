import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPlugin } from "./build.ts";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A workspace holding one plugin at `plugins/sample`, with the files given at its root. */
function workspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "rigline-build-"));
  made.push(root);
  const plugin = join(root, "plugins", "sample");
  mkdirSync(join(plugin, "src"), { recursive: true });
  writeFileSync(join(plugin, "rigline.json"), JSON.stringify({ entry: "dist/index.js" }));
  writeFileSync(join(plugin, "src", "index.ts"), "export default 1;\n");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return plugin;
}

describe("buildPlugin", () => {
  it("builds with the rolldown the plugin's workspace has, which the wrapper's engine lacks", async () => {
    const plugin = workspace({
      "node_modules/rolldown/package.json": JSON.stringify({
        name: "rolldown",
        type: "module",
        exports: "./index.mjs",
      }),
      "node_modules/rolldown/index.mjs": [
        'import { mkdirSync, writeFileSync } from "node:fs";',
        'import { dirname } from "node:path";',
        "export async function build(options) {",
        "  mkdirSync(dirname(options.output.file), { recursive: true });",
        '  writeFileSync(options.output.file, "from the workspace");',
        "}",
      ].join("\n"),
    });
    await buildPlugin({ dir: plugin });
    expect(readFileSync(join(plugin, "dist", "index.js"), "utf8")).toBe("from the workspace");
  });

  it("falls back to the engine's own rolldown where the workspace has none", async () => {
    const plugin = workspace();
    expect(await buildPlugin({ dir: plugin })).toEqual({
      input: join("src", "index.ts"),
      output: join("dist", "index.js"),
    });
    expect(readFileSync(join(plugin, "dist", "index.js"), "utf8")).toContain("export");
  });
});
