/**
 * `add` and `remove`, against disposable directories.
 *
 * The interesting cases are the ones where a copy alone would be wrong: a source directory whose
 * name is not the plugin's, a name already taken somewhere `add` does not own, a `config.json`
 * carrying something this code has never heard of, and a `remove` pointed at a checkout.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packageTarball } from "../../test/tar.ts";
import { UserError } from "../errors.ts";
import { readConfig } from "./discover.ts";
import { addFromNpm, addPlugin, removePlugin, setPluginEnabled, updatePlugins } from "./manage.ts";
import type { FetchLike, RegistryOptions } from "./registry.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-manage-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A plugin source directory. `dirName` differs from `name` where the two are worth telling apart. */
function source(options: {
  readonly name: string;
  readonly dirName?: string;
  readonly uses?: Record<string, unknown>;
  readonly extra?: Readonly<Record<string, string>>;
}): string {
  const dir = join(tempDir(), options.dirName ?? options.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "rigline.json"),
    JSON.stringify({
      api: 1,
      name: options.name,
      description: `The ${options.name} plugin.`,
      entry: "dist/index.js",
      uses: options.uses ?? {},
    }),
  );
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "index.js"), "export default { setup() {} };");
  for (const [path, contents] of Object.entries(options.extra ?? {})) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

/** A user home with a plugins directory and a config path, as the CLI hands them over. */
function home(): { pluginsDir: string; configPath: string } {
  const dir = tempDir();
  const pluginsDir = join(dir, "plugins");
  mkdirSync(pluginsDir, { recursive: true });
  return { pluginsDir, configPath: join(dir, "config.json") };
}

const AT = new Date("2026-09-18T11:00:00.000Z");

/**
 * A registry serving one package, built from these tarballs. The `fetch` is the whole of the
 * network: no test in this file reaches one.
 */
const REGISTRY = "https://registry.example";
const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const AGES_AGO = "2026-09-01T12:00:00.000Z";
const MINUTES_AGO = "2026-09-18T11:20:00.000Z";
const CODE = "export default { setup() {} };";

interface PublishedVersion {
  readonly files: Readonly<Record<string, string>>;
}

/** A published version carrying a valid plugin, unless told to carry something else. */
function plugin(
  options: { readonly name?: string; readonly extra?: Readonly<Record<string, string>> } = {},
): PublishedVersion {
  return {
    files: {
      "rigline.json": JSON.stringify({
        api: 1,
        name: options.name ?? "clock",
        description: "Clock.",
        entry: "dist/index.js",
        uses: { mount: true },
      }),
      "dist/index.js": CODE,
      ...options.extra,
    },
  };
}

const published: Record<string, PublishedVersion> = {
  "1.1.0": plugin(),
  "1.2.0": plugin(),
};

function tarballOf(version: PublishedVersion): Buffer {
  return packageTarball(version.files);
}

function integrityOf(version: PublishedVersion): string {
  return `sha512-${createHash("sha512").update(tarballOf(version)).digest("base64")}`;
}

interface NpmOptions {
  readonly name?: string;
  readonly versions?: Readonly<Record<string, PublishedVersion>>;
  readonly tags?: Readonly<Record<string, string>>;
  readonly publishedAt?: string;
  /** Serve bytes that are not the ones the packument described. */
  readonly corrupt?: boolean;
}

function npm(options: NpmOptions = {}): RegistryOptions {
  const name = options.name ?? "clock";
  const versions = options.versions ?? published;
  const tags = options.tags ?? { latest: Object.keys(versions).sort().at(-1) as string };
  const time = Object.fromEntries(
    Object.keys(versions).map((v) => [v, options.publishedAt ?? AGES_AGO]),
  );
  const packument = {
    "dist-tags": tags,
    time,
    versions: Object.fromEntries(
      Object.entries(versions).map(([v, release]) => [
        v,
        { dist: { tarball: `${REGISTRY}/${name}/-/${v}.tgz`, integrity: integrityOf(release) } },
      ]),
    ),
  };

  const fetchImpl: FetchLike = async (url: string) => {
    if (url === `${REGISTRY}/${name.replace("/", "%2F")}`) return serve(200, packument);
    const match = /-\/([^/]+)\.tgz$/.exec(url);
    const release = match ? versions[match[1] as string] : undefined;
    if (release === undefined) return serve(404, {});
    return serve(200, options.corrupt ? Buffer.from("not the bytes") : tarballOf(release));
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

/** A plugin directory on disk, for the cases that mix a local source in with a registry one. */
function localPlugin(name: string): string {
  return source({ name });
}

describe("addPlugin", () => {
  it("copies the plugin in, records where it came from, and says what it can do", () => {
    const paths = home();
    const from = source({ name: "clock", uses: { anchors: ["footerSpacer"], style: true } });

    const result = addPlugin({ from, ...paths, now: () => AT });

    expect(result.name).toBe("clock");
    expect(result.replaced).toBe(false);
    expect(result.disabled).toBe(false);
    expect(result.can).toContain("attaches to footerSpacer");
    expect(existsSync(join(paths.pluginsDir, "clock", "dist", "index.js"))).toBe(true);
    expect(readConfig(paths.configPath).sources.clock).toEqual({
      kind: "path",
      from,
      addedAt: "2026-09-18T11:00:00.000Z",
    });
  });

  it("takes the name from the manifest, not from the directory it was found in", () => {
    // The shape a cloned repository has, and the shape a tarball will have: the directory is named
    // for the package and the plugin is named for itself.
    const paths = home();
    const from = source({ name: "clock", dirName: "rigline-plugin-clock" });

    const result = addPlugin({ from, ...paths });

    expect(result.name).toBe("clock");
    expect(result.dir).toBe(join(paths.pluginsDir, "clock"));
  });

  it("excludes tests, node_modules and dotfiles, as the installer's own copy does", () => {
    const paths = home();
    const from = source({
      name: "clock",
      extra: {
        "src/index.test.ts": "test",
        "node_modules/x/index.js": "dep",
        ".env": "SECRET=1",
        "README.md": "docs",
      },
    });

    addPlugin({ from, ...paths });

    const dir = join(paths.pluginsDir, "clock");
    expect(existsSync(join(dir, "README.md"))).toBe(true);
    expect(existsSync(join(dir, "src", "index.test.ts"))).toBe(false);
    expect(existsSync(join(dir, "node_modules"))).toBe(false);
    expect(existsSync(join(dir, ".env"))).toBe(false);
  });

  it("replaces a plugin of the same name it already installed, leaving nothing of the old one", () => {
    const paths = home();
    addPlugin({ from: source({ name: "clock", extra: { "old.js": "gone" } }), ...paths });
    const result = addPlugin({ from: source({ name: "clock" }), ...paths });

    expect(result.replaced).toBe(true);
    expect(existsSync(join(paths.pluginsDir, "clock", "old.js"))).toBe(false);
  });

  it("refuses a name already discovered somewhere it does not own", () => {
    const paths = home();
    const checkout = tempDir();
    source({ name: "clock" });
    mkdirSync(join(checkout, "clock"), { recursive: true });
    writeFileSync(join(checkout, "clock", "rigline.json"), "{}");

    expect(() =>
      addPlugin({ from: source({ name: "clock" }), ...paths, otherRoots: [checkout] }),
    ).toThrow(UserError);
    expect(existsSync(join(paths.pluginsDir, "clock"))).toBe(false);
  });

  it("leaves a name switched off switched off, and says so", () => {
    // `disabled` is the one thing in config a person chose rather than a command wrote, and `add`
    // over a plugin already here is also how you update one.
    const paths = home();
    writeFileSync(paths.configPath, JSON.stringify({ disabled: ["clock"] }));

    const result = addPlugin({ from: source({ name: "clock" }), ...paths });

    expect(result.disabled).toBe(true);
    expect(readConfig(paths.configPath).disabled).toEqual(["clock"]);
  });

  it("keeps keys in config.json that nothing here knows about", () => {
    const paths = home();
    writeFileSync(
      paths.configPath,
      JSON.stringify({ disabled: [], settings: { clock: { format: "24h" } } }),
    );

    addPlugin({ from: source({ name: "clock" }), ...paths });

    expect(JSON.parse(readFileSync(paths.configPath, "utf8")).settings).toEqual({
      clock: { format: "24h" },
    });
  });

  it("writes nothing when the manifest does not hold up", () => {
    const paths = home();
    const from = source({ name: "clock" });
    writeFileSync(join(from, "rigline.json"), JSON.stringify({ api: 1, name: "clock" }));

    expect(() => addPlugin({ from, ...paths })).toThrow(UserError);
    expect(existsSync(join(paths.pluginsDir, "clock"))).toBe(false);
    expect(existsSync(paths.configPath)).toBe(false);
  });

  it("refuses a path that is not a directory", () => {
    const paths = home();
    expect(() => addPlugin({ from: join(tempDir(), "nowhere"), ...paths })).toThrow(UserError);
  });
});

describe("removePlugin", () => {
  it("deletes the directory and forgets the source", () => {
    const paths = home();
    addPlugin({ from: source({ name: "clock" }), ...paths });

    const result = removePlugin({ name: "clock", ...paths });

    expect(result.hadSource).toBe(true);
    expect(existsSync(join(paths.pluginsDir, "clock"))).toBe(false);
    expect(readConfig(paths.configPath).sources).toEqual({});
  });

  it("drops a name from disabled too, since the rule is now about nothing", () => {
    const paths = home();
    addPlugin({ from: source({ name: "clock" }), ...paths });
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        ...JSON.parse(readFileSync(paths.configPath, "utf8")),
        disabled: ["clock"],
      }),
    );

    const result = removePlugin({ name: "clock", ...paths });

    expect(result.wasDisabled).toBe(true);
    expect(readConfig(paths.configPath).disabled).toEqual([]);
  });

  it("says a plugin was placed by hand rather than added", () => {
    const paths = home();
    mkdirSync(join(paths.pluginsDir, "clock"), { recursive: true });
    writeFileSync(join(paths.pluginsDir, "clock", "rigline.json"), "{}");

    expect(removePlugin({ name: "clock", ...paths }).hadSource).toBe(false);
  });

  it("will not delete a plugin it did not install, and says where it is", () => {
    const paths = home();
    const checkout = tempDir();
    mkdirSync(join(checkout, "clock"), { recursive: true });
    writeFileSync(join(checkout, "clock", "rigline.json"), "{}");

    expect(() => removePlugin({ name: "clock", ...paths, otherRoots: [checkout] })).toThrow(
      /which rigline did not install and will not delete/,
    );
    expect(existsSync(join(checkout, "clock"))).toBe(true);
  });

  it("refuses a name that is nowhere at all", () => {
    const paths = home();
    expect(() => removePlugin({ name: "ghost", ...paths })).toThrow(UserError);
  });
});

describe("addFromNpm", () => {
  it("unpacks, validates and records the version and the tag it followed", async () => {
    const paths = home();
    const result = await addFromNpm({
      spec: "clock",
      ...paths,
      registry: npm(),
      now: () => AT,
    });

    expect(result.name).toBe("clock");
    expect(result.from).toBe("clock@1.2.0");
    expect(readFileSync(join(paths.pluginsDir, "clock", "dist", "index.js"), "utf8")).toBe(CODE);
    expect(readConfig(paths.configPath).sources.clock).toEqual({
      kind: "npm",
      name: "clock",
      version: "1.2.0",
      tag: "latest",
      integrity: integrityOf(published["1.2.0"] as PublishedVersion),
      addedAt: AT.toISOString(),
    });
  });

  it("records no tag when a person named the version, which is how they pin it", async () => {
    const paths = home();
    await addFromNpm({ spec: "clock@1.1.0", ...paths, registry: npm() });
    const source = readConfig(paths.configPath).sources.clock;
    expect(source).toMatchObject({ kind: "npm", version: "1.1.0", tag: null });
  });

  it("takes the plugin's name from its manifest, not from the package it shipped in", async () => {
    // An npm package is named for a registry and a plugin is named for itself (D58).
    const paths = home();
    const result = await addFromNpm({
      spec: "rigline-plugin-clock",
      ...paths,
      registry: npm({
        name: "rigline-plugin-clock",
        versions: { "1.0.0": plugin({ name: "clock" }) },
        tags: { latest: "1.0.0" },
      }),
    });
    expect(result.name).toBe("clock");
    expect(result.dir).toBe(join(paths.pluginsDir, "clock"));
    expect(readConfig(paths.configPath).sources.clock).toMatchObject({
      name: "rigline-plugin-clock",
    });
  });

  it("writes nothing when the version is too young (D48)", async () => {
    const paths = home();
    await expect(
      addFromNpm({
        spec: "clock",
        ...paths,
        registry: npm({ publishedAt: MINUTES_AGO }),
      }),
    ).rejects.toThrow(/was published 40 minutes ago/);
    expect(existsSync(join(paths.pluginsDir, "clock"))).toBe(false);
    expect(existsSync(paths.configPath)).toBe(false);
  });

  it("takes a young version on --now, having said what it is", async () => {
    const paths = home();
    const result = await addFromNpm({
      spec: "clock",
      ...paths,
      registry: { ...npm({ publishedAt: MINUTES_AGO }), ignoreReleaseAge: true },
    });
    expect(result.name).toBe("clock");
  });

  it("writes nothing when the package is not a plugin at all", async () => {
    const paths = home();
    await expect(
      addFromNpm({
        spec: "clock",
        ...paths,
        registry: npm({ versions: { "1.2.0": { files: { "index.js": CODE } } } }),
      }),
    ).rejects.toThrow(/has no rigline.json, so it is not a Rigline plugin/);
    expect(existsSync(join(paths.pluginsDir, "clock"))).toBe(false);
  });

  it("writes nothing when the manifest inside does not hold up", async () => {
    const paths = home();
    await expect(
      addFromNpm({
        spec: "clock",
        ...paths,
        registry: npm({
          versions: { "1.2.0": { files: { "rigline.json": '{"api":1,"name":"clock"}' } } },
        }),
      }),
    ).rejects.toThrow(/is not a valid manifest/);
    expect(existsSync(join(paths.pluginsDir, "clock"))).toBe(false);
  });

  it("writes nothing when the bytes are not the ones the registry described", async () => {
    const paths = home();
    await expect(
      addFromNpm({ spec: "clock", ...paths, registry: npm({ corrupt: true }) }),
    ).rejects.toThrow(/does not match its recorded integrity/);
    expect(existsSync(join(paths.pluginsDir, "clock"))).toBe(false);
  });

  it("drops a test file from the tarball, as every other route into the directory does", async () => {
    const paths = home();
    await addFromNpm({
      spec: "clock",
      ...paths,
      registry: npm({
        versions: {
          "1.2.0": plugin({ extra: { "src/index.test.js": "test", "README.md": "docs" } }),
        },
      }),
    });
    const dir = join(paths.pluginsDir, "clock");
    expect(existsSync(join(dir, "README.md"))).toBe(true);
    expect(existsSync(join(dir, "src", "index.test.js"))).toBe(false);
  });
});

describe("updatePlugins", () => {
  it("moves a plugin to what its tag resolves to now, keeping the tag", async () => {
    const paths = home();
    await addFromNpm({ spec: "clock@1.1.0", ...paths, registry: npm() });
    // Re-record it as following a tag, which is what `add clock` would have written.
    await addFromNpm({ spec: "clock", ...paths, registry: npm({ tags: { latest: "1.1.0" } }) });

    const updates = await updatePlugins({ ...paths, registry: npm() });

    expect(updates).toEqual([{ name: "clock", outcome: "updated", from: "1.1.0", to: "1.2.0" }]);
    expect(readConfig(paths.configPath).sources.clock).toMatchObject({
      version: "1.2.0",
      tag: "latest",
    });
  });

  it("says so and moves nothing when the tag resolves where you already are", async () => {
    const paths = home();
    await addFromNpm({ spec: "clock", ...paths, registry: npm() });
    const updates = await updatePlugins({ ...paths, registry: npm() });
    expect(updates).toEqual([{ name: "clock", outcome: "current", from: "1.2.0" }]);
  });

  it("leaves a pinned plugin pinned", async () => {
    const paths = home();
    await addFromNpm({ spec: "clock@1.1.0", ...paths, registry: npm() });
    const updates = await updatePlugins({ ...paths, registry: npm() });
    expect(updates).toEqual([{ name: "clock", outcome: "pinned", from: "1.1.0" }]);
  });

  it("names a newer version it is holding back rather than hiding it (D48)", async () => {
    const paths = home();
    await addFromNpm({ spec: "clock", ...paths, registry: npm({ tags: { latest: "1.1.0" } }) });

    const updates = await updatePlugins({ ...paths, registry: npm({ publishedAt: MINUTES_AGO }) });

    expect(updates[0]).toMatchObject({
      name: "clock",
      outcome: "withheld",
      from: "1.1.0",
      to: "1.2.0",
    });
    expect(updates[0]?.reason).toContain("--now");
    expect(readConfig(paths.configPath).sources.clock).toMatchObject({ version: "1.1.0" });
  });

  it("follows the tag backwards, because a maintainer who moved it meant to", async () => {
    const paths = home();
    await addFromNpm({ spec: "clock", ...paths, registry: npm() });
    const updates = await updatePlugins({ ...paths, registry: npm({ tags: { latest: "1.1.0" } }) });
    expect(updates).toEqual([{ name: "clock", outcome: "updated", from: "1.2.0", to: "1.1.0" }]);
  });

  it("reports what it cannot update rather than skipping it in silence", async () => {
    const paths = home();
    addPlugin({ from: localPlugin("local"), ...paths });
    mkdirSync(join(paths.pluginsDir, "by-hand"), { recursive: true });
    writeFileSync(join(paths.pluginsDir, "by-hand", "rigline.json"), "{}");

    const updates = await updatePlugins({ ...paths, registry: npm() });

    expect(updates.map((u) => [u.name, u.outcome])).toEqual([
      ["by-hand", "unmanaged"],
      ["local", "local"],
    ]);
  });

  it("carries on past a plugin whose registry is unreachable", async () => {
    const paths = home();
    await addFromNpm({ spec: "clock", ...paths, registry: npm() });
    addPlugin({ from: localPlugin("local"), ...paths });

    const updates = await updatePlugins({
      ...paths,
      registry: {
        registry: REGISTRY,
        fetchImpl: () => Promise.reject(new Error("ECONNREFUSED")),
      },
    });

    expect(updates.map((u) => [u.name, u.outcome])).toEqual([
      ["clock", "failed"],
      ["local", "local"],
    ]);
    expect(updates[0]?.reason).toContain("ECONNREFUSED");
    // Still installed, on the version it was on: a failed fetch is not a reason to lose a plugin.
    expect(readConfig(paths.configPath).sources.clock).toMatchObject({ version: "1.2.0" });
  });

  it("names a plugin asked for that is not installed", async () => {
    const paths = home();
    const updates = await updatePlugins({ ...paths, names: ["ghost"], registry: npm() });
    expect(updates[0]).toMatchObject({ name: "ghost", outcome: "failed" });
  });
});

describe("the bundled set", () => {
  /** A stand-in for core's `dist/bundled/plugins`: a root whose names may be taken (D71). */
  function bundledRootWith(name: string): string {
    const root = tempDir();
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "rigline.json"), "{}");
    return root;
  }

  it("allows add over a bundled name, and says the bundled copy is now shadowed", () => {
    // The escape hatch: a fork installed over a bundled name wins, which is what repairs a broken
    // first-party plugin without waiting for a release.
    const paths = home();
    const bundledRoot = bundledRootWith("session-id");

    const result = addPlugin({
      from: source({ name: "session-id" }),
      ...paths,
      otherRoots: [bundledRoot],
      bundledRoot,
    });

    expect(result.overridesBundled).toBe(true);
    expect(existsSync(join(paths.pluginsDir, "session-id", "rigline.json"))).toBe(true);
  });

  it("still refuses a name taken in a root that is not the bundled one", () => {
    const paths = home();
    const bundledRoot = bundledRootWith("probe");
    const checkout = tempDir();
    mkdirSync(join(checkout, "clock"), { recursive: true });
    writeFileSync(join(checkout, "clock", "rigline.json"), "{}");

    expect(() =>
      addPlugin({
        from: source({ name: "clock" }),
        ...paths,
        otherRoots: [checkout, bundledRoot],
        bundledRoot,
      }),
    ).toThrow(UserError);
  });

  it("sends remove of a bundled plugin to disable rather than deleting the engine's copy", () => {
    const paths = home();
    const bundledRoot = bundledRootWith("probe");

    expect(() =>
      removePlugin({ name: "probe", ...paths, otherRoots: [bundledRoot], bundledRoot }),
    ).toThrow(/bundled inside the engine.*rigline disable probe/s);
    expect(existsSync(join(bundledRoot, "probe"))).toBe(true);
  });
});

describe("setPluginEnabled", () => {
  /** A discovery root holding one plugin, so a switch has a name it can believe in. */
  function rootWith(name: string): string {
    const root = tempDir();
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "rigline.json"), "{}");
    return root;
  }

  it("switches a plugin off and back on, and says which time changed nothing", () => {
    const paths = home();
    const roots = [rootWith("time-marks")];

    const off = setPluginEnabled(
      { name: "time-marks", configPath: paths.configPath, roots },
      false,
    );
    expect(off.changed).toBe(true);
    expect(readConfig(paths.configPath).disabled).toEqual(["time-marks"]);

    const again = setPluginEnabled(
      { name: "time-marks", configPath: paths.configPath, roots },
      false,
    );
    expect(again.changed).toBe(false);

    const on = setPluginEnabled({ name: "time-marks", configPath: paths.configPath, roots }, true);
    expect(on.changed).toBe(true);
    expect(readConfig(paths.configPath).disabled).toEqual([]);
  });

  it("keeps everything else in config, because that file is the user's", () => {
    const paths = home();
    writeFileSync(paths.configPath, JSON.stringify({ somethingOfTheirs: 1, disabled: ["probe"] }));

    setPluginEnabled(
      { name: "time-marks", configPath: paths.configPath, roots: [rootWith("time-marks")] },
      false,
    );

    const raw = JSON.parse(readFileSync(paths.configPath, "utf8")) as Record<string, unknown>;
    expect(raw.somethingOfTheirs).toBe(1);
    expect(raw.disabled).toEqual(["probe", "time-marks"]);
  });

  it("refuses a name no root has, rather than writing a rule about a typo", () => {
    const paths = home();
    expect(() =>
      setPluginEnabled(
        { name: "tyme-marks", configPath: paths.configPath, roots: [rootWith("time-marks")] },
        false,
      ),
    ).toThrow(UserError);
    expect(readConfig(paths.configPath).disabled).toEqual([]);
  });
});
