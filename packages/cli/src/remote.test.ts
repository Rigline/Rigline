/**
 * The wrapper's remote half, with a fake registry and a fake engine.
 *
 * What it asserts is the boundary D70 draws: the wrapper stages vetted bytes and hands over a
 * directory and a source record, and never opens a manifest or writes `sources.json`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageTarball } from "../test/tar.ts";
import { UserError } from "./errors.ts";
import type { FetchLike, RegistryOptions } from "./registry.ts";
import {
  addFromNpm,
  formatUpdates,
  type ListedPlugin,
  type NpmSourceRecord,
  type RunEngine,
  updatePlugins,
} from "./remote.ts";

const REGISTRY = "https://registry.example";
const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const AGES_AGO = "2026-09-01T12:00:00.000Z";
const MINUTES_AGO = "2026-09-18T11:20:00.000Z";
const AT = new Date("2026-09-18T11:00:00.000Z");
const CODE = "export default { setup() {} };";

function files(name = "clock"): Record<string, string> {
  return {
    "rigline.json": JSON.stringify({ api: 1, name, entry: "dist/index.js", uses: { mount: true } }),
    "dist/index.js": CODE,
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
  const versions = options.versions ?? { "1.1.0": files(), "1.2.0": files() };
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

/**
 * An engine that records what it was handed and copies the staged directory somewhere durable.
 *
 * The copy matters: the wrapper deletes its staging directory as soon as the engine returns, which
 * is the behaviour under test — a test that looked afterwards would find nothing either way.
 */
function fakeEngine(code = 0): {
  readonly run: RunEngine;
  readonly calls: { argv: readonly string[]; staged: Record<string, string> }[];
} {
  const calls: { argv: readonly string[]; staged: Record<string, string> }[] = [];
  return {
    calls,
    run: async (argv) => {
      const dir = argv[1] as string;
      const staged: Record<string, string> = {};
      for (const path of ["rigline.json", join("dist", "index.js"), "README.md"]) {
        const full = join(dir, path);
        if (existsSync(full)) staged[path.replace(/\\/g, "/")] = readFileSync(full, "utf8");
      }
      calls.push({ argv, staged });
      return code;
    },
  };
}

/** The source record the wrapper handed over, parsed back out of the argv. */
function sourceOf(argv: readonly string[]): NpmSourceRecord {
  const at = argv.indexOf("--source");
  return JSON.parse(argv[at + 1] as string) as NpmSourceRecord;
}

describe("addFromNpm", () => {
  it("stages the unpacked tarball and hands the engine a path and a source", async () => {
    const engine = fakeEngine();
    const code = await addFromNpm({
      spec: "clock",
      engine: engine.run,
      registry: npm(),
      now: () => AT,
    });

    expect(code).toBe(0);
    const call = engine.calls[0];
    expect(call?.argv[0]).toBe("add");
    expect(call?.staged["rigline.json"]).toContain('"name":"clock"');
    expect(call?.staged["dist/index.js"]).toBe(CODE);
    expect(sourceOf(call?.argv ?? [])).toEqual({
      kind: "npm",
      name: "clock",
      version: "1.2.0",
      tag: "latest",
      integrity: expect.stringContaining("sha512-"),
      addedAt: AT.toISOString(),
    });
  });

  it("records no tag when a person named a version, which is how a pin is made (D58)", async () => {
    const engine = fakeEngine();
    await addFromNpm({ spec: "clock@1.1.0", engine: engine.run, registry: npm() });
    expect(sourceOf(engine.calls[0]?.argv ?? []).tag).toBeNull();
    expect(sourceOf(engine.calls[0]?.argv ?? []).version).toBe("1.1.0");
  });

  it("deletes its staging directory once the engine has had it", async () => {
    const engine = fakeEngine();
    await addFromNpm({ spec: "clock", engine: engine.run, registry: npm() });
    expect(existsSync(engine.calls[0]?.argv[1] as string)).toBe(false);
  });

  it("refuses a version younger than the release-age gate, before fetching anything", async () => {
    const engine = fakeEngine();
    await expect(
      addFromNpm({
        spec: "clock",
        engine: engine.run,
        registry: npm({ publishedAt: MINUTES_AGO }),
      }),
    ).rejects.toThrow(UserError);
    expect(engine.calls).toHaveLength(0);
  });

  it("refuses bytes that do not match the integrity hash, and stages nothing", async () => {
    const engine = fakeEngine();
    await expect(
      addFromNpm({ spec: "clock", engine: engine.run, registry: npm({ corrupt: true }) }),
    ).rejects.toThrow(/integrity/i);
    expect(engine.calls).toHaveLength(0);
  });

  it("passes the engine's exit code back rather than inventing one", async () => {
    const engine = fakeEngine(1);
    expect(await addFromNpm({ spec: "clock", engine: engine.run, registry: npm() })).toBe(1);
  });
});

describe("updatePlugins", () => {
  function listing(source: ListedPlugin["source"], name = "clock"): ListedPlugin {
    return { name, managed: true, source };
  }

  const following = {
    kind: "npm",
    name: "clock",
    version: "1.1.0",
    tag: "latest",
    integrity: "sha512-x",
    addedAt: AT.toISOString(),
  };

  it("moves a plugin its tag has left behind, and keeps the tag", async () => {
    const engine = fakeEngine();
    const updates = await updatePlugins({
      listed: [listing(following)],
      engine: engine.run,
      registry: npm(),
    });

    expect(updates[0]).toEqual({ name: "clock", outcome: "updated", from: "1.1.0", to: "1.2.0" });
    expect(sourceOf(engine.calls[0]?.argv ?? []).tag).toBe("latest");
  });

  it("leaves a plugin already on what its tag resolves to", async () => {
    const engine = fakeEngine();
    const updates = await updatePlugins({
      listed: [listing({ ...following, version: "1.2.0" })],
      engine: engine.run,
      registry: npm(),
    });
    expect(updates[0]?.outcome).toBe("current");
    expect(engine.calls).toHaveLength(0);
  });

  it("leaves a pinned plugin alone and says it is pinned", async () => {
    const updates = await updatePlugins({
      listed: [listing({ ...following, tag: null })],
      engine: fakeEngine().run,
      registry: npm(),
    });
    expect(updates[0]).toMatchObject({ outcome: "pinned", from: "1.1.0" });
  });

  it("reports a directory source and a hand-placed plugin as things it cannot move", async () => {
    const updates = await updatePlugins({
      listed: [
        listing({ kind: "path", from: "/tmp/clock" } as ListedPlugin["source"], "local"),
        listing(null, "dropped"),
      ],
      engine: fakeEngine().run,
      registry: npm(),
    });
    expect(updates.map((u) => u.outcome)).toEqual(["local", "unmanaged"]);
  });

  it("leaves a source kind it does not know rather than guessing at it", async () => {
    // The mirror of the engine's own skip (D74): a config written by a newer wrapper.
    const updates = await updatePlugins({
      listed: [listing({ kind: "git" } as ListedPlugin["source"])],
      engine: fakeEngine().run,
      registry: npm(),
    });
    expect(updates[0]).toMatchObject({ outcome: "unmanaged", reason: 'source kind "git"' });
  });

  it("withholds a newer version that is too young, naming it", async () => {
    const updates = await updatePlugins({
      listed: [listing(following)],
      engine: fakeEngine().run,
      registry: npm({ publishedAt: MINUTES_AGO }),
    });
    expect(updates[0]).toMatchObject({ outcome: "withheld", from: "1.1.0", to: "1.2.0" });
  });

  it("carries on past a failure rather than stopping at the first", async () => {
    const updates = await updatePlugins({
      listed: [listing(following), listing({ ...following, name: "gone" }, "gone")],
      engine: fakeEngine().run,
      registry: npm(),
    });
    expect(updates.map((u) => u.name)).toEqual(["clock", "gone"]);
    expect(updates[1]?.outcome).toBe("failed");
  });

  it("skips a name nothing listed rather than fetching for it", async () => {
    const updates = await updatePlugins({
      listed: [],
      engine: fakeEngine().run,
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
