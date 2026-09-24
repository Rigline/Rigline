import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { EMPTY_USES } from "@rigline/plugin-api";
import { afterEach, describe, expect, it } from "vitest";
import { UserError } from "../errors.ts";
import type { DiscoveredPlugin } from "./discover.ts";
import {
  bakeRegistry,
  capabilityUseNotes,
  declaredPatches,
  discoverPlugins,
  enabledPlugins,
  isPluginOutput,
  readManifest,
} from "./discover.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-plugins-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Writes a minimal, valid plugin directory: rigline.json plus its entry file. */
function writePlugin(
  root: string,
  name: string,
  overrides: Record<string, unknown> = {},
  entrySource = "export default { setup() {} };",
): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const manifest = {
    api: 1,
    name,
    entry: "index.js",
    ...overrides,
  };
  writeFileSync(join(dir, "rigline.json"), JSON.stringify(manifest));
  const entryPath = join(dir, (manifest.entry as string) ?? "index.js");
  mkdirSync(dirname(entryPath), { recursive: true });
  writeFileSync(entryPath, entrySource);
  return dir;
}

describe("readManifest", () => {
  it("reads a well-formed manifest", () => {
    const root = tempDir();
    const dir = writePlugin(root, "sample");
    const manifest = readManifest(dir);
    expect(manifest.name).toBe("sample");
    expect(manifest.entry).toBe("index.js");
    expect(manifest.uses).toEqual(EMPTY_USES);
  });

  it("throws when the directory has no rigline.json", () => {
    const root = tempDir();
    mkdirSync(join(root, "bare"));
    expect(() => readManifest(join(root, "bare"))).toThrow(/no rigline\.json/);
  });

  it("throws UserError on malformed JSON", () => {
    const root = tempDir();
    const dir = join(root, "broken");
    mkdirSync(dir);
    writeFileSync(join(dir, "rigline.json"), "{not json");
    expect(() => readManifest(dir)).toThrow(UserError);
  });

  it("throws listing every shape problem, including a name that does not match its directory", () => {
    const root = tempDir();
    const dir = writePlugin(root, "sample", { name: "other-name" });
    expect(() => readManifest(dir)).toThrow(/must match its directory name|"name" is/);
  });

  it("throws when the entry file does not exist", () => {
    const root = tempDir();
    const dir = join(root, "sample");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "rigline.json"),
      JSON.stringify({ api: 1, name: "sample", entry: "dist/index.js" }),
    );
    expect(() => readManifest(dir)).toThrow(/does not exist/);
  });
});

describe("discoverPlugins", () => {
  it("finds every subdirectory with a manifest, sorted by name, ignoring stray files", () => {
    const root = tempDir();
    writePlugin(root, "zeta");
    writePlugin(root, "alpha");
    writeFileSync(join(root, "README.md"), "not a plugin");
    mkdirSync(join(root, "empty"));

    const found = discoverPlugins([root]);
    expect(found.map((p) => p.name)).toEqual(["alpha", "zeta"]);
  });

  it("returns nothing for a root that does not exist", () => {
    expect(discoverPlugins([join(tempDir(), "nope")])).toEqual([]);
  });

  it("takes roots in the order given", () => {
    const rootA = tempDir();
    const rootB = tempDir();
    writePlugin(rootA, "from-a");
    writePlugin(rootB, "from-b");

    expect(discoverPlugins([rootA, rootB]).map((p) => p.name)).toEqual(["from-a", "from-b"]);
    expect(discoverPlugins([rootB, rootA]).map((p) => p.name)).toEqual(["from-b", "from-a"]);
  });

  it("moves names in `last` to the end, in the order given, regardless of discovery order", () => {
    const root = tempDir();
    writePlugin(root, "probe");
    writePlugin(root, "alpha");
    writePlugin(root, "beta");

    const found = discoverPlugins([root], { last: ["probe"] });
    expect(found.map((p) => p.name)).toEqual(["alpha", "beta", "probe"]);
  });

  it("keeps the first of a name and reports the one it shadowed", () => {
    // Two of a name baked two registry entries and loaded the plugin twice (D56). First root wins,
    // because the root order is the caller's and is already load order.
    const first = tempDir();
    const second = tempDir();
    writePlugin(first, "clock");
    writePlugin(second, "clock");
    writePlugin(second, "other");
    const lines: string[] = [];

    const found = discoverPlugins([first, second], { log: (line) => lines.push(line) });

    expect(found.map((p) => p.dir)).toEqual([join(first, "clock"), join(second, "other")]);
    expect(lines).toEqual([
      `${join(second, "clock")} is shadowed by ${join(first, "clock")}: a plugin called "clock" is already discovered`,
    ]);
  });

  it("records a shadowed bundled plugin on the winner and says nothing (D71)", () => {
    // Every install from this checkout finds all four first-party plugins twice, so a line per
    // collision would be four lines of noise per extension version describing the design working.
    const checkout = tempDir();
    const bundled = tempDir();
    writePlugin(checkout, "session-id");
    writePlugin(bundled, "session-id");
    writePlugin(bundled, "probe");
    const lines: string[] = [];

    const found = discoverPlugins([checkout, bundled], {
      bundledRoot: bundled,
      log: (line) => lines.push(line),
    });

    expect(lines).toEqual([]);
    expect(found.map((p) => p.dir)).toEqual([join(checkout, "session-id"), join(bundled, "probe")]);
    expect(found.map((p) => p.overridesBundled)).toEqual([true, false]);
  });

  it("still reports a collision between two roots neither of which is the bundled one", () => {
    const first = tempDir();
    const second = tempDir();
    const bundled = tempDir();
    writePlugin(first, "clock");
    writePlugin(second, "clock");
    const lines: string[] = [];

    discoverPlugins([first, second, bundled], { bundledRoot: bundled, log: (l) => lines.push(l) });
    expect(lines).toHaveLength(1);
  });
});

describe("enabledPlugins", () => {
  it("preserves discovery order, filtering out disabled names", () => {
    const root = tempDir();
    writePlugin(root, "alpha");
    writePlugin(root, "beta");
    writePlugin(root, "gamma");
    const discovered = discoverPlugins([root]);

    const enabled = enabledPlugins(discovered, {
      path: "config.yaml",
      disabled: ["beta"],
      layout: {},
    });
    expect(enabled.map((p) => p.name)).toEqual(["alpha", "gamma"]);
  });

  it("warns through the log callback when a disabled name was never discovered", () => {
    const root = tempDir();
    writePlugin(root, "alpha");
    const discovered = discoverPlugins([root]);
    const lines: string[] = [];

    const path = join(tempDir(), "config.yaml");
    enabledPlugins(discovered, { path, disabled: ["ghost"], layout: {} }, (line) =>
      lines.push(line),
    );

    // Names the file a person has to open, not the shape of its name: a message that says
    // "config.yaml" leaves them looking for which one.
    expect(lines).toEqual([
      `${path} disables "ghost", which was not found among the discovered plugins`,
    ]);
  });
});

describe("declaredPatches", () => {
  it("flattens every enabled plugin's patches, naming the plugin that declared each", () => {
    const root = tempDir();
    writePlugin(root, "a", {
      patches: [{ find: "X", replace: "Y", why: "reason" }],
    });
    writePlugin(root, "b");
    const enabled = discoverPlugins([root]);

    expect(declaredPatches(enabled)).toEqual([
      { plugin: "a", patch: { find: "X", replace: "Y", why: "reason" } },
    ]);
  });
});

describe("bakeRegistry", () => {
  it("renders a valid, importable ES module for zero plugins", async () => {
    const source = bakeRegistry([], []);
    expect(source).toMatch(/export const plugins = \[\s*\];/);
    const path = join(tempDir(), "registry.mjs");
    writeFileSync(path, source);
    const mod = (await import(pathToFileURL(path).href)) as {
      plugins: unknown[];
      patches: unknown[];
      layout: unknown;
      save: unknown;
    };
    expect(mod.plugins).toEqual([]);
    expect(mod.patches).toEqual([]);
    expect(mod.layout).toEqual({});
    expect(mod.save).toBeNull();
  });

  it("carries what the panel's Save needs (D93)", async () => {
    const save = { token: "ABCDEFGHIJKLMNOPQRSTUV", companion: true, scheme: "vscode" };
    const path = join(tempDir(), "registry.mjs");
    writeFileSync(path, bakeRegistry([], [], {}, save));
    const mod = (await import(pathToFileURL(path).href)) as { save: object };
    expect(mod.save).toEqual(save);
  });

  it("carries the layout in the order the file wrote its places (D92)", async () => {
    const layout = { rigRow: ["a/x"], off: ["b/y"], "before footerSpacer": ["a/z"] };
    const path = join(tempDir(), "registry.mjs");
    writeFileSync(path, bakeRegistry([], [], layout));
    const mod = (await import(pathToFileURL(path).href)) as { layout: object };
    expect(Object.keys(mod.layout)).toEqual(["rigRow", "off", "before footerSpacer"]);
    expect(mod.layout).toEqual(layout);
  });

  it("rewrites each entry's path relative to the plugins directory and carries surfaces and uses", () => {
    const root = tempDir();
    writePlugin(root, "sample", { entry: "dist/index.js", surfaces: ["sidebar"] });
    const enabled = discoverPlugins([root]);

    const source = bakeRegistry(enabled, []);
    expect(source).toContain('"entry":"./plugins/sample/dist/index.js"');
    expect(source).toContain('"surfaces":["sidebar"]');
    expect(source).toContain('"patchRefusal":null');
  });

  it("excludes disabled plugins from the rendered source once enabledPlugins has filtered them", () => {
    const root = tempDir();
    writePlugin(root, "alpha");
    writePlugin(root, "beta");
    const discovered = discoverPlugins([root]);
    const enabled = enabledPlugins(discovered, {
      path: "config.yaml",
      disabled: ["beta"],
      layout: {},
    });

    const source = bakeRegistry(enabled, []);
    expect(source).toContain('"name":"alpha"');
    expect(source).not.toContain('"name":"beta"');
  });

  it("records a patch refusal for a plugin whose required patch failed", () => {
    const root = tempDir();
    writePlugin(root, "sample");
    const enabled = discoverPlugins([root]);

    const source = bakeRegistry(enabled, [
      { plugin: "sample", why: "why", required: true, applied: false, reason: "anchor gone" },
    ]);
    expect(source).toContain('"patchRefusal":"required host patch did not apply: anchor gone"');
  });
});

describe("isPluginOutput", () => {
  it("keeps ordinary shipped files", () => {
    expect(isPluginOutput("index.js")).toBe(true);
    expect(isPluginOutput("dist/index.js")).toBe(true);
  });

  it("excludes test files", () => {
    expect(isPluginOutput("index.test.js")).toBe(false);
    expect(isPluginOutput("src/index.test.ts")).toBe(false);
  });

  it("excludes node_modules and dotfiles or dot-directories at any depth", () => {
    expect(isPluginOutput("node_modules/dep/index.js")).toBe(false);
    expect(isPluginOutput(".git/HEAD")).toBe(false);
    expect(isPluginOutput("src/.cache/x.js")).toBe(false);
  });
});

describe("capabilityUseNotes", () => {
  function plugin(name: string, uses: Record<string, unknown>, source: string): DiscoveredPlugin {
    const root = tempDir();
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.js"), source);
    // A capability call appearing only in a test file beside the plugin must not count: it is
    // never shipped, so drift found there cannot exist.
    writeFileSync(join(dir, "index.test.js"), "ctx.onToolUse(() => {}); ctx.decorateTranscript();");
    return {
      name,
      dir,
      root,
      overridesBundled: false,
      manifest: {
        api: 1,
        name,
        description: null,
        entry: "index.js",
        surfaces: ["editor", "sidebar", "sessionList"],
        uses: { ...EMPTY_USES, ...uses } as never,
        elements: {},
        patches: [],
      },
    };
  }

  it("is quiet when the manifest and the shipped source agree", () => {
    const p = plugin("agrees", { session: true }, "ctx.onSessionId(() => {});");
    expect(capabilityUseNotes([p])).toEqual([]);
  });

  it("reports a capability used but not declared", () => {
    const p = plugin("undeclared", {}, "ctx.onToolUse(() => {});");
    expect(capabilityUseNotes([p])).toEqual([
      'undeclared: calls onToolUse/onToolResult() without declaring "tools": it will throw and disable the plugin',
    ]);
  });

  it("reports a capability declared but never used", () => {
    const p = plugin("unused", { session: true }, "// no calls in here");
    expect(capabilityUseNotes([p])).toEqual([
      'unused: declares "session" but never calls onSessionId()',
    ]);
  });
});
