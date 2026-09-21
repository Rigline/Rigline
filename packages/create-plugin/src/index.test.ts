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
import { defaultTemplateDir, riglineRange, ScaffoldError, scaffold } from "./index.ts";

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

  it("scaffolds the release workflow, at the path a trusted publisher names", () => {
    // D50: an author gets the good path by generating a repository, not by reading a guide. The
    // path is load-bearing rather than decorative — npm's trusted publisher names the workflow file
    // by path, so a scaffold that puts it anywhere else produces a repository whose publisher
    // entry can never match. Unlike `.gitignore`, npm does not rename a `.github` directory inside
    // a tarball, which was checked rather than assumed.
    const result = into("clock");
    expect(result.files).toContain(".github/workflows/release.yml");
    const workflow = read(result, ".github/workflows/release.yml");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("pnpm stage publish -r");
  });

  it("scaffolds CI beside the release workflow, so a push is checked before a publish is", () => {
    // The repository this template comes from ran its tests only at release for a while, which is
    // tolerable in private and not once anybody else can open a pull request. A scaffold inherits
    // the answer rather than the lesson.
    const result = into("clock");
    expect(result.files).toContain(".github/workflows/ci.yml");
    const ci = read(result, ".github/workflows/ci.yml");
    expect(ci).toContain("pull_request:");
    expect(ci).toContain("pnpm test");
  });

  it("carries the publishable metadata a scaffold can know, and none that it cannot", () => {
    // `repository` is deliberately absent. A scaffold cannot know it, npm binds a provenance
    // attestation to it, and a placeholder would put a URL that resolves to nothing into the
    // registry — absent beats wrong (P8), so the release workflow refuses instead. What a
    // scaffold does know is here: the keyword a plugin is found by, and the access setting a
    // scoped name would otherwise need somebody to discover.
    const result = into("clock");
    const manifest = JSON.parse(read(result, "plugins/clock/package.json"));
    expect(manifest.keywords).toContain("rigline-plugin");
    expect(manifest.publishConfig).toEqual({ access: "public" });
    expect(manifest.repository).toBeUndefined();
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
    // Deliberately a pattern rather than the three keys by name: a new substitution that the
    // template uses and `scaffold` does not supply would otherwise ship as literal `__FOO__` with
    // every existing test still green, which is how `__RIGLINE_RANGE__` could have arrived broken.
    const result = into("clock");
    for (const file of result.files) {
      expect(read(result, file), file).not.toMatch(/__[A-Z][A-Z0-9_]*__/);
    }
  });

  it("depends on Rigline by a range that admits the version actually published", () => {
    // A caret range admits a prerelease only when it names one with the same major, minor and
    // patch, so a hand-written `^1.0.0` in the template does not match `1.0.0-alpha.0` and the
    // `pnpm install` the README opens with fails outright. The first published scaffold had
    // exactly that (D50), so the range is derived from this package's own version instead.
    const own = JSON.parse(readFileSync(join(defaultTemplateDir(), "..", "package.json"), "utf8"));
    expect(riglineRange()).toBe(`^${own.version}`);

    const result = into("clock");
    for (const file of ["package.json", "plugins/clock/package.json"]) {
      const { devDependencies } = JSON.parse(read(result, file));
      expect(devDependencies["@rigline/core"], file).toBe(`^${own.version}`);
      expect(devDependencies["@rigline/plugin-api"], file).toBe(`^${own.version}`);
    }

    // While we are on a prerelease, the range has to carry one too, or it matches nothing at all.
    if (own.version.includes("-")) expect(riglineRange()).toContain("-");
  });

  it("exempts every Rigline dependency it declares from the release-age gate, by version", () => {
    // The gate resolves to the newest version in range that is old enough, and a range whose floor
    // is the newest published version has nothing older in it — so a workspace scaffolded on
    // release day could not install the release that scaffolded it (D50). Asserted over whatever
    // the template declares rather than against two names, so a third Rigline package added to the
    // template fails here rather than shipping ungated.
    const result = into("clock");
    const workspace = read(result, "pnpm-workspace.yaml");
    const declared = new Set<string>();
    for (const file of ["package.json", "plugins/clock/package.json"]) {
      const { devDependencies } = JSON.parse(read(result, file));
      for (const [name, range] of Object.entries(devDependencies as Record<string, string>)) {
        if (name.startsWith("@rigline/")) declared.add(`${name}@${range.replace(/^\^/, "")}`);
      }
    }

    expect(declared.size).toBeGreaterThan(0);
    for (const entry of declared) expect(workspace).toContain(`"${entry}"`);
  });

  it("declares rolldown, which `rigline-engine build` no longer brings with it", () => {
    // The engine stopped depending on rolldown when it became a lazy import, so a scaffold that
    // does not declare its own has no bundler at all and `pnpm build` fails on the first command
    // the README tells an author to run. Hand-written rather than derived: the range is the
    // bundler's, and `__RIGLINE_RANGE__` is this package's own version (D50).
    const { devDependencies } = JSON.parse(read(into("clock"), "package.json"));
    expect(devDependencies.rolldown.startsWith("^")).toBe(true);
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
