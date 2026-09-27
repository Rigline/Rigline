/**
 * Plugins from npm, with a fake registry and a real `addPlugin` over temporary directories.
 *
 * What it asserts is that nothing reaches `~/.rigline/plugins` until the version has cleared the
 * age gate and the bytes their integrity hash, and that what lands there records where it came from.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packageTarball } from "../../test/tar.ts";
import { UserError } from "../errors.ts";
import { readSources } from "./config.ts";
import type { PluginListing } from "./list.ts";
import type { AddResult } from "./manage.ts";
import type { FetchLike, RegistryOptions } from "./npm.ts";
import { addFromNpm, formatUpdates, type Placement, updatePlugins } from "./remote.ts";

const REGISTRY = "https://registry.example";
const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const AGES_AGO = "2026-09-01T12:00:00.000Z";
const MINUTES_AGO = "2026-09-18T11:20:00.000Z";
const AT = new Date("2026-09-18T11:00:00.000Z");
const CODE = "export default { setup() {} };";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function home(): Placement {
  const dir = mkdtempSync(join(tmpdir(), "rigline-remote-"));
  made.push(dir);
  const pluginsDir = join(dir, "plugins");
  mkdirSync(pluginsDir);
  return {
    pluginsDir,
    configPath: join(dir, "config.yaml"),
    sourcesPath: join(dir, "sources.json"),
  };
}

function files(name = "clock", version = "1.2.0"): Record<string, string> {
  return {
    "rigline.json": JSON.stringify({ api: 1, name, entry: "dist/index.js", uses: {} }),
    "dist/index.js": `${CODE} // ${version}`,
  };
}

function npm(
  options: {
    readonly versions?: Readonly<Record<string, Record<string, string>>>;
    readonly tags?: Readonly<Record<string, string>>;
    readonly publishedAt?: string;
    readonly corrupt?: boolean;
  } = {},
): RegistryOptions {
  const versions = options.versions ?? {
    "1.1.0": files("clock", "1.1.0"),
    "1.2.0": files("clock", "1.2.0"),
  };
  const tags = options.tags ?? { latest: Object.keys(versions).sort().at(-1) as string };
  const packument = {
    "dist-tags": tags,
    time: Object.fromEntries(
      Object.keys(versions).map((v) => [v, options.publishedAt ?? AGES_AGO]),
    ),
    versions: Object.fromEntries(
      Object.entries(versions).map(([v, f]) => [
        v,
        {
          dist: {
            tarball: `${REGISTRY}/clock/-/${v}.tgz`,
            integrity: `sha512-${createHash("sha512").update(packageTarball(f)).digest("base64")}`,
          },
        },
      ]),
    ),
  };

  const fetchImpl: FetchLike = async (url: string) => {
    if (url === `${REGISTRY}/clock`) return serve(200, packument);
    const match = /-\/([^/]+)\.tgz$/.exec(url);
    const f = match ? versions[match[1] as string] : undefined;
    if (f === undefined) return serve(404, {});
    return serve(200, options.corrupt ? Buffer.from("not the bytes") : packageTarball(f));
  };
  return { registry: REGISTRY, fetchImpl, clock: () => NOW };
}

function serve(status: number, body: unknown) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), "utf8");
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(bytes.toString("utf8")) as unknown,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

/** Staging directories left in the temp directory, which `add` must clean up after itself. */
function staged(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("rigline-add-"));
}

describe("addFromNpm", () => {
  it("adds the unpacked tarball and records the npm source it came from", async () => {
    const add = home();
    const result = await addFromNpm("clock", { add, registry: npm(), now: () => AT });

    expect(result.name).toBe("clock");
    expect(readFileSync(join(add.pluginsDir, "clock", "dist", "index.js"), "utf8")).toContain(
      "1.2.0",
    );
    expect(readSources(add.sourcesPath).clock).toEqual({
      kind: "npm",
      name: "clock",
      version: "1.2.0",
      tag: "latest",
      integrity: expect.stringContaining("sha512-"),
      addedAt: AT.toISOString(),
    });
    expect(result.source).toEqual(readSources(add.sourcesPath).clock);
  });

  it("records no tag when a person named a version, which is how a pin is made (D58)", async () => {
    const add = home();
    await addFromNpm("clock@1.1.0", { add, registry: npm() });
    expect(readSources(add.sourcesPath).clock).toMatchObject({ version: "1.1.0", tag: null });
  });

  it("deletes its staging directory once the plugin is placed", async () => {
    const before = staged();
    await addFromNpm("clock", { add: home(), registry: npm() });
    expect(staged()).toEqual(before);
  });

  it("refuses a version younger than the release-age gate, and places nothing", async () => {
    const add = home();
    await expect(
      addFromNpm("clock", { add, registry: npm({ publishedAt: MINUTES_AGO }) }),
    ).rejects.toThrow(UserError);
    expect(readdirSync(add.pluginsDir)).toEqual([]);
  });

  it("refuses bytes that do not match the integrity hash, and places nothing", async () => {
    const add = home();
    await expect(addFromNpm("clock", { add, registry: npm({ corrupt: true }) })).rejects.toThrow(
      /integrity/i,
    );
    expect(readdirSync(add.pluginsDir)).toEqual([]);
  });

  it("holds a fetched manifest to the rules a directory is held to", async () => {
    // The content is the engine's to judge wherever the bytes came from (D70).
    const add = home();
    const broken = { "rigline.json": JSON.stringify({ api: 1, name: "clock" }) };
    await expect(
      addFromNpm("clock", { add, registry: npm({ versions: { "1.0.0": broken } }) }),
    ).rejects.toThrow(/entry/);
    expect(existsSync(join(add.pluginsDir, "clock"))).toBe(false);
  });
});

describe("updatePlugins", () => {
  function listed(source: PluginListing["source"], name = "clock"): PluginListing {
    return {
      name,
      dir: "",
      origin: "home",
      enabled: true,
      source,
      version: null,
      overridesBundled: false,
      description: null,
      can: [],
      patches: [],
    };
  }

  const following = {
    kind: "npm",
    name: "clock",
    version: "1.1.0",
    tag: "latest",
    integrity: "sha512-x",
    addedAt: AT.toISOString(),
  } as const;

  it("moves a plugin its tag has left behind, keeps the tag, and says what it placed", async () => {
    const add = home();
    const placed: AddResult[] = [];
    const updates = await updatePlugins({
      listed: [listed(following)],
      add,
      registry: npm(),
      onAdded: (result) => placed.push(result),
    });

    expect(updates[0]).toEqual({ name: "clock", outcome: "updated", from: "1.1.0", to: "1.2.0" });
    expect(readSources(add.sourcesPath).clock).toMatchObject({ version: "1.2.0", tag: "latest" });
    expect(placed.map((result) => result.name)).toEqual(["clock"]);
  });

  it("leaves a plugin already on what its tag resolves to", async () => {
    const add = home();
    const updates = await updatePlugins({
      listed: [listed({ ...following, version: "1.2.0" })],
      add,
      registry: npm(),
    });
    expect(updates[0]?.outcome).toBe("current");
    expect(readdirSync(add.pluginsDir)).toEqual([]);
  });

  it("leaves a pinned plugin alone and says it is pinned", async () => {
    const updates = await updatePlugins({
      listed: [listed({ ...following, tag: null })],
      add: home(),
      registry: npm(),
    });
    expect(updates[0]).toMatchObject({ outcome: "pinned", from: "1.1.0" });
  });

  it("reports a directory source and a hand-placed plugin as things it cannot move", async () => {
    const updates = await updatePlugins({
      listed: [
        listed({ kind: "path", from: "/tmp/clock", addedAt: AT.toISOString() }, "local"),
        listed(null, "dropped"),
      ],
      add: home(),
      registry: npm(),
    });
    expect(updates.map((u) => u.outcome)).toEqual(["local", "unmanaged"]);
  });

  it("withholds a newer version that is too young, naming it", async () => {
    const updates = await updatePlugins({
      listed: [listed(following)],
      add: home(),
      registry: npm({ publishedAt: MINUTES_AGO }),
    });
    expect(updates[0]).toMatchObject({ outcome: "withheld", from: "1.1.0", to: "1.2.0" });
  });

  it("carries on past a failure rather than stopping at the first", async () => {
    const updates = await updatePlugins({
      listed: [listed(following), listed({ ...following, name: "gone" }, "gone")],
      add: home(),
      registry: npm(),
    });
    expect(updates.map((u) => u.name)).toEqual(["clock", "gone"]);
    expect(updates.map((u) => u.outcome)).toEqual(["updated", "failed"]);
  });

  it("reports a name nothing listed rather than fetching for it", async () => {
    const updates = await updatePlugins({
      listed: [],
      add: home(),
      registry: npm(),
      names: ["ghost"],
    });
    expect(updates[0]).toMatchObject({ name: "ghost", outcome: "failed" });
  });
});

describe("formatUpdates", () => {
  it("says so when there is nothing installed", () => {
    expect(formatUpdates([])).toContain("no plugins to update");
  });

  it("gives one line per plugin, naming both versions when one moved", () => {
    const text = formatUpdates([
      { name: "clock", outcome: "updated", from: "1.1.0", to: "1.2.0" },
      { name: "probe", outcome: "pinned", from: "2.0.0" },
    ]);
    expect(text).toBe("clock: 1.1.0 -> 1.2.0\nprobe: pinned to 2.0.0; add it again to move it");
  });
});
