/**
 * The scaffold, against the template this package actually ships.
 *
 * Deliberately not against a template the test builds: what is worth pinning is that the files in
 * `template/` hold up — that the manifest validates, that every JSON file parses, that the
 * substitution reached the paths as well as the contents, and that the placeholder harvest is
 * there. A scaffold that produces a workspace nobody can build is the failure this catches, and it
 * is a failure of the template rather than of the copying.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateManifest } from "@rigline/plugin-api";
import { afterEach, describe, expect, it } from "vitest";
import { defaultTemplateDir, ScaffoldError, scaffold } from "./index.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-create-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function into(name = "clock", extra: { readonly description?: string } = {}) {
  const target = join(tempDir(), name);
  return scaffold({ target, description: extra.description });
}

const read = (result: { dir: string }, path: string) =>
  readFileSync(join(result.dir, path), "utf8");

describe("scaffold", () => {
  it("writes a workspace whose plugin directory is named after the plugin", () => {
    const result = into("clock");
    expect(result.name).toBe("clock");
    expect(result.files).toContain("plugins/clock/rigline.json");
    expect(result.files).toContain("plugins/clock/src/index.ts");
    expect(result.files).not.toContain("plugins/__NAME__/rigline.json");
  });

  it("ships a manifest that validates, which is the one file an install refuses over", () => {
    const result = into("clock");
    const { manifest, problems } = validateManifest(
      JSON.parse(read(result, "plugins/clock/rigline.json")),
      "clock",
    );
    expect(problems).toEqual([]);
    expect(manifest?.name).toBe("clock");
    expect(manifest?.entry).toBe("dist/index.js");
    expect(manifest?.uses.anchors).toEqual(["footerSpacer"]);
  });

  it("writes JSON that parses, in every file that claims to be JSON", () => {
    const result = into("clock");
    for (const file of result.files.filter((f) => f.endsWith(".json"))) {
      expect(() => JSON.parse(read(result, file)), file).not.toThrow();
    }
  });

  it("carries a placeholder harvest, so the workspace typechecks before codegen has run", () => {
    // D40's promise, at the one moment it is easiest to break: `tsconfig.plugin.json` names
    // `generated.ts` in `files`, and tsc fails outright on a `files` entry that is not there.
    const result = into("clock");
    expect(result.files).toContain("generated.ts");
    expect(JSON.parse(read(result, "tsconfig.plugin.json")).files).toEqual(["generated.ts"]);
    expect(read(result, "generated.ts")).toContain("pnpm codegen");
  });

  it("puts the dot back on the gitignore npm would have renamed", () => {
    const result = into("clock");
    expect(result.files).toContain(".gitignore");
    expect(result.files).not.toContain("gitignore");
    expect(read(result, ".gitignore")).toContain("node_modules/");
  });

  it("substitutes the description everywhere it lands, and defaults it", () => {
    const described = into("clock", { description: "Shows the time." });
    expect(read(described, "plugins/clock/rigline.json")).toContain("Shows the time.");
    expect(read(described, "plugins/clock/package.json")).toContain("Shows the time.");
    expect(read(into("clock"), "plugins/clock/rigline.json")).toContain(
      "A Rigline plugin called clock.",
    );
  });

  it("leaves no placeholder behind in any file it wrote", () => {
    const result = into("clock");
    for (const file of result.files) {
      expect(read(result, file), file).not.toContain("__NAME__");
      expect(read(result, file), file).not.toContain("__DESCRIPTION__");
    }
  });

  it("names the plugin after the workspace directory, or after --name", () => {
    const target = join(tempDir(), "my-plugins");
    expect(scaffold({ target, name: "clock" }).files).toContain("plugins/clock/rigline.json");
  });

  it("refuses a name a manifest would refuse, before writing anything", () => {
    const target = join(tempDir(), "Clock");
    expect(() => scaffold({ target })).toThrow(ScaffoldError);
    expect(existsSync(target)).toBe(false);
  });

  it("refuses a directory with anything in it, because a scaffold is not a merge", () => {
    const target = join(tempDir(), "clock");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "README.md"), "mine");
    expect(() => scaffold({ target })).toThrow(/is not empty/);
    expect(read({ dir: target }, "README.md")).toBe("mine");
  });

  it("says so rather than scaffolding half a workspace when the template is gone", () => {
    expect(() =>
      scaffold({ target: join(tempDir(), "clock"), templateDir: join(tempDir(), "nowhere") }),
    ).toThrow(/template is missing/);
  });

  it("ships the template beside this module, where the published package will find it", () => {
    expect(existsSync(join(defaultTemplateDir(), "package.json"))).toBe(true);
  });
});
