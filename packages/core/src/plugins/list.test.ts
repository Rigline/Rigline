import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_VERSION } from "../version.ts";
import { formatPlugins, listPlugins, type PluginListing } from "./list.ts";

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
  const path = join(tempDir(), "config.json");
  writeFileSync(path, JSON.stringify({ disabled }));
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
        { label: "this checkout", path: mine },
        { label: "~/.rigline/plugins", path: theirs },
      ],
      configPath: configWith([]),
    });
    expect(listed.map((p) => [p.name, p.origin])).toEqual([
      ["ours", "this checkout"],
      ["somebody-elses", "~/.rigline/plugins"],
    ]);
  });

  it("says where add brought a plugin from, and says when nothing knows", () => {
    const managed = tempDir();
    const checkout = tempDir();
    writePlugin(managed, "added");
    writePlugin(managed, "by-hand");
    writePlugin(checkout, "first-party");
    const configPath = join(tempDir(), "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        sources: {
          added: { kind: "path", from: "/src/added", addedAt: "2026-09-18T11:00:00.000Z" },
        },
      }),
    );

    const listed = listPlugins({
      roots: [
        { label: "this checkout", path: checkout },
        { label: "~/.rigline/plugins", path: managed, managed: true },
      ],
      configPath,
    });
    const text = formatPlugins(listed);

    expect(text).toContain("added from /src/added");
    // Only a plugin in the directory `add` owns can have been placed there by hand; a first-party
    // plugin in a checkout was never added and has nothing to be updated from (D49).
    expect(listed.map((p) => [p.name, p.managed, p.source !== null])).toEqual([
      ["first-party", false, false],
      ["added", true, true],
      ["by-hand", true, false],
    ]);
    expect(text.split("placed here by hand")).toHaveLength(2);
  });

  it("lists in the order plugins load, `last` included, so it cannot disagree with the registry", () => {
    const root = tempDir();
    writePlugin(root, "alpha");
    writePlugin(root, "probe");
    writePlugin(root, "zulu");

    const listed = listPlugins({
      roots: [{ label: "root", path: root }],
      last: ["probe"],
      configPath: configWith([]),
    });
    expect(listed.map((p) => p.name)).toEqual(["alpha", "zulu", "probe"]);
  });

  it("marks a plugin switched off in config without dropping it from the list", () => {
    const root = tempDir();
    writePlugin(root, "on");
    writePlugin(root, "off");

    const listed = listPlugins({
      roots: [{ label: "root", path: root }],
      configPath: configWith(["off"]),
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
      roots: [{ label: "root", path: root }],
      configPath: configWith([]),
    });
    expect(listed[0]?.description).toBe("Does a thing.");
    expect(listed[0]?.can).toContain("reads messages: io_message");
    expect(listed[0]?.can.length).toBeGreaterThan(1);
  });

  it("carries a declared host patch, with what it is for and not what it is", () => {
    const root = tempDir();
    writePlugin(root, "patcher", {
      patches: [{ find: "a:!1", replace: "a:!0", why: "Turns the thing on.", required: true }],
    });

    const listed = listPlugins({
      roots: [{ label: "root", path: root }],
      configPath: configWith([]),
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
        roots: [{ label: "this checkout", path: root }],
        configPath: configWith(["quiet"]),
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
      roots: [{ label: "bundled", path: bundled, bundled: true }],
      configPath: configWith([]),
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
        { label: "this checkout", path: checkout },
        { label: "bundled", path: bundled, bundled: true },
      ],
      configPath: configWith([]),
    });
    expect(listings).toHaveLength(1);
    expect(listings[0]?.origin).toBe("this checkout");
    expect(listings[0]?.overridesBundled).toBe(true);
    // Not the engine's, because this one is not the engine's: a checkout plugin has no version at
    // all, and inventing one would say the two copies are the same when that is the open question.
    expect(listings[0]?.version).toBeNull();
    expect(formatPlugins(listings)).toContain("overrides the copy bundled in the engine");
  });

  it("takes an installed plugin's version from the source add recorded", () => {
    const home = tempDir();
    const plugins = join(home, "plugins");
    writePlugin(plugins, "clock");
    const configPath = join(home, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        sources: {
          clock: {
            kind: "npm",
            name: "clock",
            version: "2.1.0",
            tag: "latest",
            integrity: "sha512-x",
            addedAt: "2026-09-21T00:00:00.000Z",
          },
        },
      }),
    );

    const [listing] = listPlugins({
      roots: [{ label: plugins, path: plugins, managed: true }],
      configPath,
    });
    expect(listing?.version).toBe("2.1.0");
    expect(formatPlugins([listing as PluginListing])).toContain("clock 2.1.0 —");
  });
});

describe("the shape `rigline list --json` emits", () => {
  it("carries the fields the wrapper's `update` reads (D74)", () => {
    // The wrapper cannot read `config.json`, so this listing is how it learns what it can move.
    const plugins = tempDir();
    writePlugin(plugins, "clock");
    const configPath = join(tempDir(), "config.json");
    const source = {
      kind: "npm",
      name: "clock",
      version: "2.1.0",
      tag: "latest",
      integrity: "sha512-x",
      addedAt: "2026-09-21T00:00:00.000Z",
    };
    writeFileSync(configPath, JSON.stringify({ sources: { clock: source } }));

    const [listing] = JSON.parse(
      JSON.stringify(
        listPlugins({
          roots: [{ label: plugins, path: plugins, managed: true }],
          configPath,
        }),
      ),
    ) as { name: string; managed: boolean; source: Record<string, unknown> | null }[];

    expect(listing?.name).toBe("clock");
    expect(listing?.managed).toBe(true);
    expect(listing?.source).toEqual(source);
  });

  it("reports a plugin with no record as managed with a null source", () => {
    const plugins = tempDir();
    writePlugin(plugins, "dropped");
    const [listing] = listPlugins({
      roots: [{ label: plugins, path: plugins, managed: true }],
      configPath: configWith([]),
    });
    expect(listing?.managed).toBe(true);
    expect(listing?.source).toBeNull();
  });
});
