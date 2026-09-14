/**
 * The update flow, against disposable extension directories only (D39). A failing assertion
 * mid-test must never be able to leave a real install half-patched.
 *
 * The simulated update these tests rest on is the phase 3 acceptance case: a copy of an extension
 * directory with one identifier removed. Removing it from the *bundle* rather than from the tables
 * is what makes it a real rehearsal — the harvest genuinely does not find the class, exactly as it
 * would not after an upstream rename.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { harvestableHostReplies, harvestableWebview } from "../../test/fixtures.ts";
import { generate } from "../codegen/generate.ts";
import { readBundles } from "../extension/bundles.ts";
import { harvestAll } from "../layers/index.ts";
import { readBaseline, readGeneratedScan, writeBaseline } from "./baseline.ts";
import { check, formatFlow, update } from "./flow.ts";

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A disposable extension directory. `drop` removes one class pair from the bundle and its rule. */
function fixture(options: { readonly version?: string; readonly drop?: string } = {}): string {
  const ext = tempDir("rigline-flow-");
  const { js, css } = harvestableWebview();
  const local = options.drop;
  // One pair, from one module, removed the way an upstream rename removes it: gone from the map
  // and gone from the stylesheet, so no module reads as partially harvested either.
  const bundle = local ? js.replace(`${local}:"${local}_f00000",`, "") : js;
  const styles = local ? css.replace(`.${local}_f00000{}`, "") : css;

  mkdirSync(join(ext, "webview"), { recursive: true });
  writeFileSync(join(ext, "webview", "index.js"), bundle);
  writeFileSync(join(ext, "webview", "index.css"), styles);
  writeFileSync(join(ext, "extension.js"), harvestableHostReplies());
  writeFileSync(
    join(ext, "package.json"),
    JSON.stringify({ version: options.version ?? "2.1.270" }),
  );
  return ext;
}

function payload(): string {
  const dir = tempDir("rigline-payload-");
  writeFileSync(join(dir, "pre.js"), "export default 1;\n");
  writeFileSync(join(dir, "post.js"), "export default 2;\n");
  return dir;
}

/** A plugin root holding one plugin, declaring `uses`. */
function pluginRoot(name: string, uses: Record<string, unknown>): string {
  const root = tempDir("rigline-plugins-");
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "rigline.json"),
    JSON.stringify({ api: 1, name, entry: "index.js", uses }),
  );
  writeFileSync(join(dir, "index.js"), "export default { setup() {} };\n");
  return root;
}

function configPath(): string {
  const path = join(tempDir("rigline-config-"), "config.json");
  writeFileSync(path, JSON.stringify({ disabled: [] }));
  return path;
}

function plugins(root: string): { roots: string[]; configPath: string } {
  return { roots: [root], configPath: configPath() };
}

describe("check", () => {
  it("writes nothing, and says so by leaving wrote empty", () => {
    const ext = fixture();
    const home = tempDir("rigline-home-");
    const report = check({
      exts: [ext],
      dir: tempDir("rigline-cwd-"),
      baselinePath: join(home, "baseline.json"),
    });
    expect(report.wrote).toEqual([]);
    expect(report.versions).toHaveLength(1);
    expect(report.versions[0]?.action).toBeNull();
    expect(readFileSync(join(ext, "webview", "index.js"), "utf8")).not.toContain("rigline/pre.js");
  });

  it("names the plugin and the identifier a version would refuse, without refusing the install", () => {
    const ext = fixture({ drop: "local3" });
    const report = check({
      exts: [ext],
      dir: tempDir("rigline-cwd-"),
      baselinePath: join(tempDir("rigline-home-"), "baseline.json"),
      plugins: plugins(pluginRoot("needy", { classes: { f00000: ["local3"] } })),
    });
    const verdict = report.versions[0]?.verdicts[0];
    expect(verdict?.plugin).toBe("needy");
    expect(verdict?.refusal).toBe("unknown class f00000.local3");
    expect(report.attention.some((line) => line.includes('refuses "needy"'))).toBe(true);
  });

  it("reports the same identifier as a degradation when it was declared optional", () => {
    const ext = fixture({ drop: "local3" });
    const report = check({
      exts: [ext],
      dir: tempDir("rigline-cwd-"),
      baselinePath: join(tempDir("rigline-home-"), "baseline.json"),
      plugins: plugins(pluginRoot("relaxed", { optional: { classes: { f00000: ["local3"] } } })),
    });
    const verdict = report.versions[0]?.verdicts[0];
    expect(verdict?.refusal).toBeNull();
    expect(verdict?.missingOptional).toEqual(["unknown class f00000.local3"]);
    expect(report.attention.some((line) => line.includes("loads without"))).toBe(true);
  });

  it("counts raw class pairs, which are the dependencies no anchor-table fix can reach", () => {
    const ext = fixture();
    const report = check({
      exts: [ext],
      dir: tempDir("rigline-cwd-"),
      baselinePath: join(tempDir("rigline-home-"), "baseline.json"),
      plugins: plugins(pluginRoot("raw", { classes: { f00000: ["local1", "local2"] } })),
    });
    expect(report.versions[0]?.verdicts[0]?.rawClasses).toBe(2);
  });

  it("wants nobody when every declaration holds", () => {
    const ext = fixture();
    const report = check({
      exts: [ext],
      dir: tempDir("rigline-cwd-"),
      baselinePath: join(tempDir("rigline-home-"), "baseline.json"),
      plugins: plugins(pluginRoot("fine", { classes: { f00000: ["local1"] } })),
    });
    // The synthetic bundle carries none of the curated anchors, so the anchor table is expected to
    // be missing every one of them; that is the only thing here that should want a person.
    expect(report.attention.filter((line) => !line.includes("anchor table"))).toEqual([]);
  });
});

describe("update", () => {
  it("injects every version, records a baseline, and reports what it wrote", () => {
    const older = fixture({ version: "2.1.268" });
    const newer = fixture({ version: "2.1.270" });
    const baselinePath = join(tempDir("rigline-home-"), "baseline.json");

    const report = update({
      exts: [older, newer],
      payloadDir: payload(),
      dir: tempDir("rigline-cwd-"),
      baselinePath,
    });

    expect(report.versions.map((v) => v.version)).toEqual(["2.1.268", "2.1.270"]);
    expect(report.versions.every((v) => v.action === "injected")).toBe(true);
    for (const ext of [older, newer]) {
      expect(readFileSync(join(ext, "webview", "index.js"), "utf8")).toContain("rigline/pre.js");
    }
    expect(report.wrote).toContain(baselinePath);
    expect(report.scan.version).toBe("2.1.270");
  });

  it("injects around a plugin it would refuse rather than blocking on it (D27)", () => {
    const ext = fixture({ drop: "local3" });
    const root = pluginRoot("needy", { classes: { f00000: ["local3"] } });
    const report = update({
      exts: [ext],
      payloadDir: payload(),
      dir: tempDir("rigline-cwd-"),
      baselinePath: join(tempDir("rigline-home-"), "baseline.json"),
      plugins: plugins(root),
    });

    expect(report.versions[0]?.action).toBe("injected");
    expect(readFileSync(join(ext, "webview", "index.js"), "utf8")).toContain("rigline/pre.js");
    expect(report.attention.some((line) => line.includes("unknown class f00000.local3"))).toBe(
      true,
    );
    // Still baked, so the kernel refuses it by name and the probe can say why. A plugin quietly
    // absent from the panel is the outcome this avoids.
    const registry = readFileSync(join(ext, "webview", "rigline", "registry.js"), "utf8");
    expect(registry).toContain('"name":"needy"');
  });

  it("diffs the newest version against the baseline the last run recorded", () => {
    const home = tempDir("rigline-home-");
    const baselinePath = join(home, "baseline.json");
    const before = fixture({ version: "2.1.268" });
    writeBaseline(baselinePath, generate(harvestAll(readBundles(before))).scan);

    const after = fixture({ version: "2.1.270", drop: "local3" });
    const report = update({
      exts: [after],
      payloadDir: payload(),
      dir: tempDir("rigline-cwd-"),
      baselinePath,
    });

    expect(report.baseline?.kind).toBe("recorded");
    const classes = report.diffs.find((d) => d.view === "classes.classes");
    expect(classes?.gone).toEqual(["local3_f00000"]);
    expect(formatFlow(report)).toContain("local3_f00000");
  });

  it("rewrites a generated.ts the directory already has, and tells you to commit it", () => {
    const cwd = tempDir("rigline-cwd-");
    const before = fixture({ version: "2.1.268" });
    writeFileSync(join(cwd, "generated.ts"), generate(harvestAll(readBundles(before))).source);

    const after = fixture({ version: "2.1.270" });
    const report = update({
      exts: [after],
      payloadDir: payload(),
      dir: cwd,
      baselinePath: join(tempDir("rigline-home-"), "baseline.json"),
      codegen: true,
    });

    expect(report.baseline?.kind).toBe("generated");
    expect(report.wrote).toContain(join(cwd, "generated.ts"));
    expect(readFileSync(join(cwd, "generated.ts"), "utf8")).toContain(
      'EXTENSION_VERSION = "2.1.270"',
    );
    expect(report.attention.some((line) => line.includes("commit it"))).toBe(true);
  });

  it("creates no generated.ts for a directory that does not keep one", () => {
    const cwd = tempDir("rigline-cwd-");
    const report = update({
      exts: [fixture()],
      payloadDir: payload(),
      dir: cwd,
      baselinePath: join(tempDir("rigline-home-"), "baseline.json"),
      codegen: true,
    });
    expect(report.wrote.some((p) => p.endsWith("generated.ts"))).toBe(false);
  });
});

describe("the baseline", () => {
  it("prefers the directory's own generated.ts to whatever the last run recorded", () => {
    const cwd = tempDir("rigline-cwd-");
    const home = tempDir("rigline-home-");
    const baselinePath = join(home, "baseline.json");
    writeBaseline(
      baselinePath,
      generate(harvestAll(readBundles(fixture({ version: "2.1.1" })))).scan,
    );
    writeFileSync(
      join(cwd, "generated.ts"),
      generate(harvestAll(readBundles(fixture({ version: "2.1.2" })))).source,
    );

    const baseline = readBaseline(cwd, baselinePath);
    expect(baseline?.kind).toBe("generated");
    expect(baseline?.scan.version).toBe("2.1.2");
  });

  it("round-trips a scan through the generated file it was rendered into", () => {
    const cwd = tempDir("rigline-cwd-");
    const generated = generate(harvestAll(readBundles(fixture({ version: "2.1.9" }))));
    const path = join(cwd, "generated.ts");
    writeFileSync(path, generated.source);
    expect(readGeneratedScan(path)).toEqual(generated.scan);
  });

  it("refuses a file that is not one of ours rather than reading a wrong baseline", () => {
    const cwd = tempDir("rigline-cwd-");
    const path = join(cwd, "generated.ts");
    writeFileSync(path, "export const SOMETHING_ELSE = 1;\n");
    expect(() => readGeneratedScan(path)).toThrow(/carries no SCAN/);
  });

  it("is null on a first run, which is a state and not an error", () => {
    expect(
      readBaseline(tempDir("rigline-cwd-"), join(tempDir("rigline-home-"), "b.json")),
    ).toBeNull();
  });
});
