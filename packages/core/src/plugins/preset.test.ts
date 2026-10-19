import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  layoutProblems,
  MAX_BAKED_PRESET_BYTES,
  MAX_BAKED_PRESETS,
  SHIPPED_LAYOUT,
  withRigline,
} from "@rigline/plugin-api/internal";
import { afterEach, describe, expect, it } from "vitest";
import { bundledPresetsDir } from "../assets.ts";
import { readConfig } from "./config.ts";
import { type DiscoveredPlugin, discoverPlugins } from "./discover.ts";
import {
  applyPreset,
  bakePresets,
  isPresetPath,
  listPresets,
  MAX_PRESET_BYTES,
  type PresetDirs,
  type PresetListing,
  type PresetOrigin,
  presetFromConfig,
  presetTarget,
  readPreset,
  resolvePreset,
  undoLayout,
  writePreset,
} from "./preset.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-preset-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A preset file in a fresh directory, named `name.yaml`. */
function presetFile(text: string, name = "p"): string {
  const path = join(tempDir(), `${name}.yaml`);
  writeFileSync(path, text);
  return path;
}

/** The two directories a name resolves against, both empty until something is written to them. */
function emptyDirs(): PresetDirs {
  return { yours: join(tempDir(), "presets"), shipped: join(tempDir(), "shipped") };
}

function write(dir: string, name: string, text: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

/** A plugin as discovery hands one over, with the elements a layout can name. */
function plugin(
  name: string,
  elements: Record<string, unknown>,
  extra: Partial<DiscoveredPlugin> = {},
): DiscoveredPlugin {
  return {
    name,
    dir: join("/plugins", name),
    root: "/plugins",
    overridesBundled: false,
    ...extra,
    manifest: { api: 1, name, entry: "index.js", elements } as DiscoveredPlugin["manifest"],
  };
}

/** Bundled, as the first-party plugins are: nothing says where one of those comes from. */
const METER = plugin(
  "usage-meter",
  { cost: { title: "Session cost", placements: ["rigRow"], default: "rigRow" } },
  { root: "/bundled" },
);
const SESSION = plugin("session-id", {
  "short-id": {
    title: "Session id",
    placements: [{ anchor: "footerSpacer", at: "before" }, "rigRow"],
    default: { anchor: "footerSpacer", at: "before" },
  },
});

/** A home with a config holding `layout`, and the paths `applyPreset` needs. */
function home(layout = ""): { config: string; previousLayout: string } {
  const dir = tempDir();
  const config = join(dir, "config.yaml");
  writeFileSync(config, layout === "" ? "disabled: []\n" : layout);
  return { config, previousLayout: join(dir, "previous-layout.yaml") };
}

describe("readPreset", () => {
  it("reads the layout, the description and the file's claim about a plugin", () => {
    const path = presetFile(
      "preset:\n" +
        "  description: Two rows.\n" +
        "  plugins:\n" +
        "    3dflow:\n" +
        "      npm: rigline-plugin-3dflow\n" +
        "layout:\n" +
        "  rigRow:\n" +
        "    - 3dflow/panel\n",
      "two-rows",
    );
    expect(readPreset(path)).toEqual({
      path,
      name: "two-rows",
      description: "Two rows.",
      plugins: { "3dflow": { npm: "rigline-plugin-3dflow" } },
      layout: { rigRow: ["3dflow/panel"] },
    });
  });

  it("takes a plugin the file names without saying where it comes from", () => {
    const path = presetFile("preset:\n  plugins:\n    mine:\nlayout:\n  off:\n    - mine/pill\n");
    expect(readPreset(path).plugins).toEqual({ mine: { npm: null } });
  });

  it("takes an empty layout, which says every element is where its plugin puts it", () => {
    expect(readPreset(presetFile("layout: {}\n")).layout).toEqual({});
    expect(readPreset(presetFile("layout:\n")).layout).toEqual({});
  });

  it("refuses a file with no layout rather than applying an empty one (D132)", () => {
    expect(() => readPreset(presetFile("preset:\n  description: oops\n"))).toThrow(
      /has no "layout", so it is not a preset/,
    );
    // The shape this is really guarding: a misspelt key would otherwise read as a reset.
    expect(() => readPreset(presetFile("layouts:\n  rigRow:\n    - a/b\n"))).toThrow(
      /"layouts".*which a preset does not carry/s,
    );
  });

  it("refuses an unknown key rather than carrying it forward, and names `update` (D132)", () => {
    expect(() => readPreset(presetFile("layout: {}\ndisabled:\n  - time-marks\n"))).toThrow(
      /"disabled".*a preset holds preset and layout.*rigline update/s,
    );
    expect(() => readPreset(presetFile("preset:\n  colour: red\nlayout: {}\n"))).toThrow(
      /"colour" in "preset"/,
    );
    expect(() =>
      readPreset(presetFile("preset:\n  plugins:\n    x:\n      git: u\nlayout: {}\n")),
    ).toThrow(/"git" in "preset.plugins.x"/);
  });

  it("refuses a place this engine cannot read, which would park the companion (D132)", () => {
    expect(() => readPreset(presetFile("layout:\n  rigRow 1:\n    - a/b\n"))).toThrow(
      /the first row is rigRow/,
    );
    expect(() => readPreset(presetFile("layout:\n  nowhere:\n    - a/b\n"))).toThrow(
      /"nowhere" is not a place/,
    );
    expect(() => readPreset(presetFile("layout:\n  default:\n    - a/b\n"))).toThrow(
      /"default" is not a place/,
    );
  });

  it("refuses a file that is not YAML, a mapping, or a layout of lists", () => {
    expect(() => readPreset(presetFile("layout: {\n"))).toThrow(/is not valid YAML/);
    expect(() => readPreset(presetFile("- one\n- two\n"))).toThrow(
      /must be a mapping of preset keys to values/,
    );
    expect(() => readPreset(presetFile("layout:\n  rigRow: a/b\n"))).toThrow(
      /"layout.rigRow" must be a list/,
    );
  });

  it("refuses a hostile file: too big, a control character, too many entries", () => {
    const big = presetFile(`layout: {}\n# ${"x".repeat(MAX_PRESET_BYTES)}\n`);
    expect(() => readPreset(big)).toThrow(/and a preset may be/);
    expect(() => readPreset(presetFile('layout:\n  "rig\\u0007Row":\n    - a/b\n'))).toThrow(
      /names a place that is empty, over 256 characters, or not text/,
    );
    const names = Array.from({ length: 1100 }, (_, i) => `    - p/e${i}`).join("\n");
    expect(() => readPreset(presetFile(`layout:\n  off:\n${names}\n`))).toThrow(
      /more than 1024 places and names/,
    );
  });
});

describe("a name or a path", () => {
  it("decides by shape, the same rule for reading and writing", () => {
    expect(isPresetPath("mine")).toBe(false);
    expect(isPresetPath("mine.yaml")).toBe(true);
    expect(isPresetPath("./mine")).toBe(true);
    expect(isPresetPath("sub/mine")).toBe(true);
    const dirs = emptyDirs();
    expect(presetTarget("mine", dirs)).toBe(join(dirs.yours, "mine.yaml"));
    expect(presetTarget("./out.yaml", dirs)).toBe("./out.yaml");
  });

  it("finds yours before a shipped one of the same name", () => {
    const dirs = emptyDirs();
    const mine = write(dirs.yours, "rows.yaml", "layout:\n  off:\n    - a/b\n");
    write(dirs.shipped, "rows.yaml", "layout: {}\n");
    expect(resolvePreset("rows", dirs)).toBe(mine);
  });

  it("refuses a name that is not there, naming what is", () => {
    const dirs = emptyDirs();
    expect(() => resolvePreset("rows", dirs)).toThrow(/there is no preset called "rows", and none/);
    write(dirs.shipped, "minimal.yaml", "layout: {}\n");
    expect(() => resolvePreset("rows", dirs)).toThrow(/there is minimal/);
  });

  it("refuses a name that could reach outside the presets directory", () => {
    const dirs = emptyDirs();
    for (const name of ["..", "-x", "a b"]) {
      expect(() => resolvePreset(name, dirs)).toThrow(/is not a preset name/);
    }
    expect(() => resolvePreset("../../etc/passwd", dirs)).toThrow(/does not exist/);
  });

  it("refuses a path that is not there", () => {
    expect(() => resolvePreset("./nope.yaml", emptyDirs())).toThrow(/does not exist/);
  });
});

describe("listPresets", () => {
  it("lists both directories, marks what a name of yours hides, and names a bad file", () => {
    const dirs = emptyDirs();
    write(dirs.yours, "rows.yaml", "preset:\n  description: Mine.\nlayout: {}\n");
    write(dirs.yours, "broken.yaml", "nonsense:\n");
    write(dirs.shipped, "rows.yaml", "preset:\n  description: Ours.\nlayout: {}\n");
    write(dirs.shipped, "minimal.yaml", "preset:\n  description: Small.\nlayout: {}\n");
    expect(listPresets(dirs).map((p) => [p.name, p.origin, p.description, p.shadows])).toEqual([
      ["broken", "yours", null, false],
      ["minimal", "shipped", "Small.", false],
      ["rows", "yours", "Mine.", true],
    ]);
    expect(listPresets(dirs)[0]?.problem).toMatch(/"nonsense".*does not carry/s);
  });

  it("is empty for directories that do not exist", () => {
    expect(listPresets(emptyDirs())).toEqual([]);
  });
});

describe("writePreset", () => {
  it("round-trips through readPreset, with the header and no empty block", () => {
    const path = join(tempDir(), "out.yaml");
    writePreset(path, {
      description: "Mine.",
      plugins: { "3dflow": { npm: "pkg" }, mine: { npm: null } },
      layout: { rigRow: ["usage-meter/cost"] },
    });
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/^# A Rigline layout preset/);
    expect(readPreset(path)).toMatchObject({
      description: "Mine.",
      plugins: { "3dflow": { npm: "pkg" }, mine: { npm: null } },
      layout: { rigRow: ["usage-meter/cost"] },
    });

    writePreset(path, { description: null, plugins: {}, layout: {} });
    expect(readFileSync(path, "utf8")).not.toMatch(/preset:/);
    expect(readPreset(path).layout).toEqual({});
  });

  it("makes the directory it writes into", () => {
    const path = join(tempDir(), "presets", "out.yaml");
    writePreset(path, { description: null, plugins: {}, layout: {} });
    expect(readPreset(path).layout).toEqual({});
  });
});

describe("presetFromConfig", () => {
  const sourcesPath = () => {
    const path = join(tempDir(), "sources.json");
    writeFileSync(
      path,
      JSON.stringify({
        "3dflow": {
          kind: "npm",
          name: "rigline-plugin-3dflow",
          version: "1.2.0",
          tag: "latest",
          integrity: "sha512-x",
          addedAt: "2026-10-01T00:00:00.000Z",
        },
        mine: { kind: "path", from: "/somewhere", addedAt: "2026-10-01T00:00:00.000Z" },
      }),
      "utf8",
    );
    return path;
  };

  it("writes the layout as it stands, with a claim only for a plugin you could install", () => {
    const paths = home(
      "layout:\n  rigRow:\n    - 3dflow/panel\n    - usage-meter/cost\n  off:\n    - mine/pill\n",
    );
    const preset = presetFromConfig(readConfig(paths.config), {
      discovered: [METER, plugin("3dflow", {}), plugin("mine", {})],
      bundledRoot: "/bundled",
      sourcesPath: sourcesPath(),
    });
    expect(preset.layout).toEqual({
      rigRow: ["3dflow/panel", "usage-meter/cost"],
      off: ["mine/pill"],
    });
    // usage-meter is not here: it is bundled. `mine` is, with nothing to say about it.
    expect(preset.plugins).toEqual({
      "3dflow": { npm: "rigline-plugin-3dflow" },
      mine: { npm: null },
    });
  });

  it("counts a bundled plugin this checkout shadows as bundled (D71)", () => {
    const paths = home("layout:\n  off:\n    - usage-meter/cost\n");
    const shadowing = plugin("usage-meter", {}, { root: "/checkout", overridesBundled: true });
    const preset = presetFromConfig(readConfig(paths.config), {
      discovered: [shadowing],
      bundledRoot: "/bundled",
      sourcesPath: sourcesPath(),
    });
    expect(preset.plugins).toEqual({});
  });

  it("never claims Rigline's own elements come from a plugin (D97)", () => {
    const paths = home("layout:\n  rigRow right:\n    - rigline/edit\n");
    const preset = presetFromConfig(readConfig(paths.config), {
      discovered: [],
      bundledRoot: "/bundled",
      sourcesPath: sourcesPath(),
    });
    expect(preset.plugins).toEqual({});
  });
});

describe("applyPreset", () => {
  it("replaces the layout rather than merging, so an element can move back", () => {
    const paths = home("layout:\n  rigRow:\n    - session-id/short-id\n");
    const preset = readPreset(presetFile("layout:\n  off:\n    - usage-meter/cost\n"));
    const result = applyPreset(paths, [METER, SESSION], preset);
    expect(result.changed).toBe(true);
    expect(readConfig(paths.config).layout).toEqual({ off: ["usage-meter/cost"] });
  });

  it("names what moved, including what it sent back to a plugin's default", () => {
    const paths = home("layout:\n  rigRow:\n    - session-id/short-id\n");
    const preset = readPreset(presetFile("layout:\n  off:\n    - usage-meter/cost\n"));
    expect(applyPreset(paths, [METER, SESSION], preset).moved).toEqual([
      "usage-meter/cost: in rigRow to off",
      "session-id/short-id: in rigRow to before footerSpacer",
    ]);
  });

  it("says nothing changed when the config already held that layout", () => {
    const paths = home("layout:\n  off:\n    - usage-meter/cost\n");
    const preset = readPreset(presetFile("layout:\n  off:\n    - usage-meter/cost\n"));
    const result = applyPreset(paths, [METER], preset);
    expect(result.changed).toBe(false);
    expect(result.moved).toEqual([]);
  });

  it("keeps an entry for a plugin you do not have, and names it with the file's claim (D92)", () => {
    const paths = home();
    const preset = readPreset(
      presetFile(
        "preset:\n" +
          "  plugins:\n" +
          "    3dflow:\n" +
          "      npm: rigline-plugin-3dflow\n" +
          "    other:\n" +
          "layout:\n" +
          "  rigRow 2:\n" +
          "    - 3dflow/panel\n" +
          "    - other/pill\n",
      ),
    );
    const result = applyPreset(paths, [METER], preset);
    // Kept, so `rigline add` lands the plugin's element where the preset put it.
    expect(readConfig(paths.config).layout).toEqual({ "rigRow 2": ["3dflow/panel", "other/pill"] });
    expect(result.needs).toEqual([
      '3dflow is not installed; the preset says it comes from the npm package "rigline-plugin-3dflow"',
      "other is not installed, and the preset does not say where it comes from",
    ]);
  });

  it("keeps the layout it replaced, and undo puts it back and then says there is nothing to do", () => {
    const paths = home("layout:\n  rigRow:\n    - usage-meter/cost\n");
    const preset = readPreset(presetFile("layout:\n  off:\n    - usage-meter/cost\n"));
    expect(applyPreset(paths, [METER], preset).stashed).toBe(paths.previousLayout);
    expect(readConfig(paths.config).layout).toEqual({ off: ["usage-meter/cost"] });

    expect(undoLayout(paths)).toEqual({ changed: true, from: paths.previousLayout });
    expect(readConfig(paths.config).layout).toEqual({ rigRow: ["usage-meter/cost"] });
    expect(undoLayout(paths).changed).toBe(false);
  });

  it("keeps the comments in the config it writes through (D93)", () => {
    const paths = home(
      "# Mine, and mine to keep.\ndisabled:\n  - time-marks\nlayout:\n  rigRow:\n    - usage-meter/cost\n",
    );
    applyPreset(
      paths,
      [METER],
      readPreset(presetFile("layout:\n  off:\n    - usage-meter/cost\n")),
    );
    const text = readFileSync(paths.config, "utf8");
    expect(text).toContain("# Mine, and mine to keep.");
    // A preset carries no `disabled`, so applying one never switches a plugin off (D131).
    expect(readConfig(paths.config).disabled).toEqual(["time-marks"]);
  });
});

describe("undoLayout", () => {
  it("refuses when no apply has kept anything, naming where it would be", () => {
    const paths = home();
    expect(() => undoLayout(paths)).toThrow(/there is no layout to go back to/);
  });
});

describe("the shipped presets", () => {
  it("every one resolves against the plugins bundled beside them", () => {
    const shipped = listPresets({ yours: join(tempDir(), "none"), shipped: bundledPresetsDir() });
    expect(shipped.length).toBeGreaterThan(0);
    const discovered = discoverPlugins([join(bundledPresetsDir(), "..", "plugins")], {
      bundledRoot: join(bundledPresetsDir(), "..", "plugins"),
    });
    for (const listing of shipped) {
      expect(listing.problem, `${listing.name} cannot be read`).toBe(null);
      expect(listing.description, `${listing.name} has no description`).not.toBe(null);
      const paths = home();
      const result = applyPreset(paths, discovered, readPreset(listing.path));
      expect(result.needs, `${listing.name} names a plugin that is not bundled`).toEqual([]);
    }
  });

  it("the shipped layout resolves against them too, and places every element it names (D142)", () => {
    const discovered = discoverPlugins([join(bundledPresetsDir(), "..", "plugins")], {
      bundledRoot: join(bundledPresetsDir(), "..", "plugins"),
    });
    const plugins = withRigline(
      discovered.map((p) => ({ name: p.name, elements: p.manifest.elements })),
    );
    expect(layoutProblems(SHIPPED_LAYOUT, plugins)).toEqual([]);
  });
});

describe("bakePresets", () => {
  /** A listing as `listPresets` returns one, with a layout of `size` places to grow it. */
  function listing(name: string, origin: PresetOrigin, places = 1): PresetListing {
    const layout: Record<string, string[]> = {};
    for (let i = 0; i < places; i++) layout[`rigRow ${i + 2}`] = [`p${i}/element`];
    return {
      name,
      origin,
      path: `/presets/${name}.yaml`,
      description: `About ${name}.`,
      shadows: false,
      problem: null,
      preset: { path: `/presets/${name}.yaml`, name, description: null, plugins: {}, layout },
    };
  }

  it("carries name, origin, description, problem and layout, and nothing a terminal owns", () => {
    const one = listing("rows", "yours");
    const baked = bakePresets([one]);
    expect(baked).toEqual({
      presets: [
        {
          name: "rows",
          origin: "yours",
          description: "About rows.",
          problem: null,
          layout: { "rigRow 2": ["p0/element"] },
        },
      ],
      omitted: 0,
    });
    // The file's npm claim is a terminal's business: only a terminal can add a plugin (D131).
    expect(JSON.stringify(baked)).not.toContain("plugins");
  });

  it("bakes an unreadable file as a row with its reason, and an empty layout", () => {
    const broken: PresetListing = {
      name: "broken",
      origin: "yours",
      path: "/presets/broken.yaml",
      description: null,
      shadows: false,
      problem: '/presets/broken.yaml has no "layout", so it is not a preset',
      preset: null,
    };
    expect(bakePresets([broken]).presets).toEqual([
      {
        name: "broken",
        origin: "yours",
        description: null,
        problem: broken.problem,
        layout: {},
      },
    ]);
  });

  it("keeps every shipped preset, and counts a person's own past the bound", () => {
    const shipped = ["minimal", "two-rows", "everything"].map((n) => listing(n, "shipped"));
    const mine = Array.from({ length: MAX_BAKED_PRESETS + 5 }, (_, i) =>
      listing(`mine-${i}`, "yours"),
    );
    const baked = bakePresets([...shipped, ...mine]);
    expect(baked.presets.filter((p) => p.origin === "shipped")).toHaveLength(3);
    expect(baked.presets.filter((p) => p.origin === "yours")).toHaveLength(MAX_BAKED_PRESETS);
    expect(baked.omitted).toBe(5);
  });

  it("stops on the byte bound too, which one legal file could otherwise fill", () => {
    // `MAX_PRESET_BYTES` is per file and larger than this total was in the first draft, so a single
    // preset `apply` accepts must not be able to push out everything else a person owns.
    const big = Array.from({ length: 6 }, (_, i) => listing(`big-${i}`, "yours", 900));
    const baked = bakePresets(big);
    expect(JSON.stringify(baked.presets).length).toBeLessThanOrEqual(MAX_BAKED_PRESET_BYTES);
    expect(baked.presets.length).toBeGreaterThan(0);
    expect(baked.presets.length + baked.omitted).toBe(6);
  });

  it("is empty for no listings", () => {
    expect(bakePresets([])).toEqual({ presets: [], omitted: 0 });
  });
});
