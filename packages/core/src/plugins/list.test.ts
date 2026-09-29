import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_VERSION } from "../version.ts";
import {
  formatPlugins,
  type ListJson,
  type ListOptions,
  listJson,
  listPlugins,
  type PluginListing,
} from "./list.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-list-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writePlugin(root: string, name: string, manifest: Record<string, unknown> = {}): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "rigline.json"),
    JSON.stringify({ api: 1, name, entry: "index.js", ...manifest }),
  );
  writeFileSync(join(dir, "index.js"), "export default { setup() {} };\n");
}

function configWith(disabled: readonly string[]): string {
  const path = join(tempDir(), "config.yaml");
  writeFileSync(path, `disabled: [${disabled.join(", ")}]\n`);
  return path;
}

/** `sources.json` holding `sources`, or a path to none. */
function sourcesWith(sources: Record<string, unknown> = {}): string {
  const path = join(tempDir(), "sources.json");
  if (Object.keys(sources).length > 0) writeFileSync(path, JSON.stringify(sources));
  return path;
}

describe("listPlugins", () => {
  it("says which root each plugin came from, which is the only record of where it is from", () => {
    const mine = tempDir();
    const theirs = tempDir();
    writePlugin(mine, "ours");
    writePlugin(theirs, "somebody-elses");

    const listed = listPlugins({
      roots: [
        { role: "checkout", path: mine },
        { role: "home", path: theirs },
      ],
      configPath: configWith([]),
      sourcesPath: sourcesWith(),
    });
    expect(listed.map((p) => [p.name, p.origin])).toEqual([
      ["ours", "checkout"],
      ["somebody-elses", "home"],
    ]);
    expect(formatPlugins(listed)).toContain("ours — this checkout");
    expect(formatPlugins(listed)).toContain(`somebody-elses — ${theirs}`);
  });

  it("says where add brought a plugin from, and says when nothing knows", () => {
    const managed = tempDir();
    const checkout = tempDir();
    writePlugin(managed, "added");
    writePlugin(managed, "by-hand");
    writePlugin(checkout, "first-party");

    const listed = listPlugins({
      roots: [
        { role: "checkout", path: checkout },
        { role: "home", path: managed },
      ],
      configPath: configWith([]),
      sourcesPath: sourcesWith({
        added: { kind: "path", from: "/src/added", addedAt: "2026-09-18T11:00:00.000Z" },
      }),
    });
    const text = formatPlugins(listed);

    expect(text).toContain("added from /src/added");
    // Only a plugin in the directory `add` owns can have been placed there by hand; a first-party
    // plugin in a checkout was never added and has nothing to be updated from (D49).
    expect(listed.map((p) => [p.name, p.origin, p.source !== null])).toEqual([
      ["first-party", "checkout", false],
      ["added", "home", true],
      ["by-hand", "home", false],
    ]);
    expect(text.split("placed here by hand")).toHaveLength(2);
  });

  it("says why a plugin with a source it cannot read looks placed by hand", () => {
    const managed = tempDir();
    writePlugin(managed, "later");
    const notes: string[] = [];
    const listed = listPlugins({
      roots: [{ role: "home", path: managed }],
      configPath: configWith([]),
      sourcesPath: sourcesWith({ later: { kind: "git", url: "https://example.com/later.git" } }),
      note: (line) => notes.push(line),
    });
    expect(listed[0]?.source).toBeNull();
    expect(notes).toEqual([expect.stringMatching(/the source recorded for "later" is .*ignored/)]);
  });

  it("lists in the order plugins load, `last` included, so it cannot disagree with the registry", () => {
    const root = tempDir();
    writePlugin(root, "alpha");
    writePlugin(root, "probe");
    writePlugin(root, "zulu");

    const listed = listPlugins({
      roots: [{ role: "checkout", path: root }],
      last: ["probe"],
      configPath: configWith([]),
      sourcesPath: sourcesWith(),
    });
    expect(listed.map((p) => p.name)).toEqual(["alpha", "zulu", "probe"]);
  });

  it("marks a plugin switched off in config without dropping it from the list", () => {
    const root = tempDir();
    writePlugin(root, "on");
    writePlugin(root, "off");

    const listed = listPlugins({
      roots: [{ role: "checkout", path: root }],
      configPath: configWith(["off"]),
      sourcesPath: sourcesWith(),
    });
    expect(listed.map((p) => [p.name, p.enabled])).toEqual([
      ["off", false],
      ["on", true],
    ]);
  });

  it("turns the manifest's declarations into the sentences the summary exists to produce", () => {
    const root = tempDir();
    writePlugin(root, "talkative", {
      description: "Does a thing.",
      uses: { messages: ["io_message"], tools: true },
    });

    const listed = listPlugins({
      roots: [{ role: "checkout", path: root }],
      configPath: configWith([]),
      sourcesPath: sourcesWith(),
    });
    expect(listed[0]?.description).toBe("Does a thing.");
    expect(listed[0]?.can).toContain("reads messages: io_message");
    expect(listed[0]?.can.length).toBeGreaterThan(1);
  });

  it("says where the layout moved an element (D92)", () => {
    const root = tempDir();
    const spacer = { anchor: "footerSpacer", at: "before" };
    writePlugin(root, "clock", {
      elements: { face: { title: "Clock", placements: [spacer, "rigRow"], default: spacer } },
    });
    const configPath = join(tempDir(), "config.yaml");
    writeFileSync(configPath, "layout:\n  rigRow: [clock/face]\n");

    const [listing] = listPlugins({
      roots: [{ role: "checkout", path: root }],
      configPath,
      sourcesPath: sourcesWith(),
    });
    expect(listing?.can).toContain('shows "Clock" in rigRow, moved from before footerSpacer');
  });

  it("carries a declared host patch, with what it is for and not what it is", () => {
    const root = tempDir();
    writePlugin(root, "patcher", {
      patches: [{ find: "a:!1", replace: "a:!0", why: "Turns the thing on.", required: true }],
    });

    const listed = listPlugins({
      roots: [{ role: "checkout", path: root }],
      configPath: configWith([]),
      sourcesPath: sourcesWith(),
    });
    expect(listed[0]?.patches).toEqual([{ why: "Turns the thing on.", required: true }]);
  });
});

describe("formatPlugins", () => {
  it("names the origin, the switch and the patch on lines a person can scan", () => {
    const root = tempDir();
    writePlugin(root, "worktree-prefix", {
      description: "Worktree prefix on the session tab.",
      uses: { tools: true },
      patches: [{ find: "a:!1", replace: "a:!0", why: "Lists worktrees." }],
    });
    writePlugin(root, "quiet");

    const text = formatPlugins(
      listPlugins({
        roots: [{ role: "checkout", path: root }],
        configPath: configWith(["quiet"]),
        sourcesPath: sourcesWith(),
      }),
    );
    expect(text).toContain("quiet — this checkout, switched off in config");
    expect(text).toContain(
      "worktree-prefix — this checkout\n  Worktree prefix on the session tab.",
    );
    expect(text).toContain("- patches extension.js: Lists worktrees.");
    // Required is the half that changes what a failure costs, so it is the half that is marked.
    expect(text).not.toContain("(required)");
  });

  it("says so when there is nothing to list, rather than printing nothing at all", () => {
    expect(formatPlugins([])).toBe("no plugins found");
  });
});

describe("the bundled set", () => {
  it("reports a bundled plugin at the engine's own version, since its manifest carries none", () => {
    const bundled = tempDir();
    writePlugin(bundled, "probe");

    const [listing] = listPlugins({
      roots: [{ role: "bundled", path: bundled }],
      configPath: configWith([]),
      sourcesPath: sourcesWith(),
    });
    expect(listing?.origin).toBe("bundled");
    expect(listing?.version).toBe(CORE_VERSION);
    expect(listing?.overridesBundled).toBe(false);
  });

  it("names the winner of a bundled collision as an override, and lists it once", () => {
    // What every `rigline list` in this checkout looks like: the same four names in `plugins/` and
    // in the engine, the checkout's winning. The bundled copy is shadowed rather than listed twice.
    const checkout = tempDir();
    const bundled = tempDir();
    writePlugin(checkout, "session-id");
    writePlugin(bundled, "session-id");

    const listings = listPlugins({
      roots: [
        { role: "checkout", path: checkout },
        { role: "bundled", path: bundled },
      ],
      configPath: configWith([]),
      sourcesPath: sourcesWith(),
    });
    expect(listings).toHaveLength(1);
    expect(listings[0]?.origin).toBe("checkout");
    expect(listings[0]?.overridesBundled).toBe(true);
    // Not the engine's, because this one is not the engine's: a checkout plugin has no version at
    // all, and inventing one would say the two copies are the same when that is the open question.
    expect(listings[0]?.version).toBeNull();
    expect(formatPlugins(listings)).toContain("overrides the copy bundled in the engine");
  });

  it("takes an installed plugin's version from the source add recorded", () => {
    const plugins = join(tempDir(), "plugins");
    writePlugin(plugins, "clock");

    const [listing] = listPlugins({
      roots: [{ role: "home", path: plugins }],
      configPath: configWith([]),
      sourcesPath: sourcesWith({
        clock: {
          kind: "npm",
          name: "clock",
          version: "2.1.0",
          tag: "latest",
          integrity: "sha512-x",
          addedAt: "2026-09-21T00:00:00.000Z",
        },
      }),
    });
    expect(listing?.version).toBe("2.1.0");
    expect(formatPlugins([listing as PluginListing])).toContain("clock 2.1.0 —");
  });
});

describe("listJson, which is `rigline list --json`", () => {
  const npmSource = {
    kind: "npm",
    name: "@someone/clock",
    version: "2.1.0",
    tag: "latest",
    integrity: "sha512-x",
    addedAt: "2026-09-21T00:00:00.000Z",
  };

  function listedAsJson(roots: ListOptions["roots"], sources: Record<string, unknown> = {}) {
    return JSON.parse(
      JSON.stringify(
        listJson(
          listPlugins({ roots, configPath: configWith([]), sourcesPath: sourcesWith(sources) }),
        ),
      ),
    ) as ListJson;
  }

  it("is versioned at the top, with every field a person reads and nothing else", () => {
    const plugins = tempDir();
    writePlugin(plugins, "clock", {
      description: "A clock.",
      patches: [{ find: "a:!1", replace: "a:!0", why: "Turns it on." }],
    });

    const json = listedAsJson([{ role: "home", path: plugins }], { clock: npmSource });
    expect(json).toEqual({
      v: 1,
      plugins: [
        {
          name: "clock",
          version: "2.1.0",
          origin: "home",
          dir: join(plugins, "clock"),
          enabled: true,
          overridesBundled: false,
          source: { kind: "npm", name: "@someone/clock", version: "2.1.0", tag: "latest" },
          description: "A clock.",
          can: expect.any(Array),
          patches: [{ why: "Turns it on.", required: false }],
        },
      ],
    });
  });

  it("names each origin by its role, never by a label or a path", () => {
    const checkout = tempDir();
    const home = tempDir();
    const bundled = tempDir();
    writePlugin(checkout, "mine");
    writePlugin(home, "dropped");
    writePlugin(bundled, "probe");

    const json = listedAsJson([
      { role: "checkout", path: checkout },
      { role: "home", path: home },
      { role: "bundled", path: bundled },
    ]);
    expect(json.plugins.map((p) => [p.name, p.origin, p.source])).toEqual([
      ["mine", "checkout", null],
      ["dropped", "home", null],
      ["probe", "bundled", null],
    ]);
  });

  it("keeps where a directory was added from, and a pinned plugin's null tag", () => {
    const home = tempDir();
    writePlugin(home, "local");
    writePlugin(home, "pinned");

    const json = listedAsJson([{ role: "home", path: home }], {
      local: { kind: "path", from: "/src/local", addedAt: "2026-09-21T00:00:00.000Z" },
      pinned: { ...npmSource, name: "pinned", tag: null },
    });
    expect(json.plugins.map((p) => p.source)).toEqual([
      { kind: "path", from: "/src/local" },
      { kind: "npm", name: "pinned", version: "2.1.0", tag: null },
    ]);
  });
});
