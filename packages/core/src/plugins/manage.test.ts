/**
 * `add` and `remove`, against disposable directories.
 *
 * The interesting cases are the ones where a copy alone would be wrong: a source directory whose
 * name is not the plugin's, a name already taken somewhere `add` does not own, a `config.yaml`
 * carrying a person's own comments, and a `remove` pointed at a checkout.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserError } from "../errors.ts";
import { readConfig, readSources } from "./config.ts";
import { addPlugin, removePlugin, setPluginEnabled } from "./manage.ts";

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

/** A user home with a plugins directory and the two files beside it, as the CLI hands them over. */
function home(): { pluginsDir: string; configPath: string; sourcesPath: string } {
  const dir = tempDir();
  const pluginsDir = join(dir, "plugins");
  mkdirSync(pluginsDir, { recursive: true });
  return {
    pluginsDir,
    configPath: join(dir, "config.yaml"),
    sourcesPath: join(dir, "sources.json"),
  };
}

const AT = new Date("2026-09-18T11:00:00.000Z");

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
    expect(readSources(paths.sourcesPath).clock).toEqual({
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
    writeFileSync(paths.configPath, "disabled: [clock]\n");

    const result = addPlugin({ from: source({ name: "clock" }), ...paths });

    expect(result.disabled).toBe(true);
    expect(readConfig(paths.configPath).disabled).toEqual(["clock"]);
  });

  it("records the source without touching config.yaml, which is a person's", () => {
    const paths = home();
    const text = "# mine\ndisabled: []\nsettings:\n  clock: { format: 24h }\n";
    writeFileSync(paths.configPath, text);

    addPlugin({ from: source({ name: "clock" }), ...paths });

    expect(readFileSync(paths.configPath, "utf8")).toBe(text);
    expect(readSources(paths.sourcesPath).clock?.kind).toBe("path");
  });

  it("writes nothing when the manifest does not hold up", () => {
    const paths = home();
    const from = source({ name: "clock" });
    writeFileSync(join(from, "rigline.json"), JSON.stringify({ api: 1, name: "clock" }));

    expect(() => addPlugin({ from, ...paths })).toThrow(UserError);
    expect(existsSync(join(paths.pluginsDir, "clock"))).toBe(false);
    expect(existsSync(paths.configPath)).toBe(false);
    expect(existsSync(paths.sourcesPath)).toBe(false);
  });

  it("changes nothing when config.yaml does not parse", () => {
    const paths = home();
    writeFileSync(paths.configPath, "disabled: [clock\n");

    expect(() => addPlugin({ from: source({ name: "clock" }), ...paths })).toThrow(
      /not valid YAML/,
    );
    expect(existsSync(join(paths.pluginsDir, "clock"))).toBe(false);
    expect(existsSync(paths.sourcesPath)).toBe(false);
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
    expect(result.wasDisabled).toBe(false);
    expect(existsSync(join(paths.pluginsDir, "clock"))).toBe(false);
    expect(readSources(paths.sourcesPath)).toEqual({});
    expect(existsSync(paths.configPath)).toBe(false);
  });

  it("drops a name from disabled too, since the rule is now about nothing", () => {
    const paths = home();
    addPlugin({ from: source({ name: "clock" }), ...paths });
    writeFileSync(paths.configPath, "disabled:\n  - clock\n  - probe\n");

    const result = removePlugin({ name: "clock", ...paths });

    expect(result.wasDisabled).toBe(true);
    expect(readConfig(paths.configPath).disabled).toEqual(["probe"]);
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

describe("a link in ~/.rigline/plugins (W43)", () => {
  /** A working tree linked in, as an author might: a junction on Windows, a symlink elsewhere. */
  function linked(): { paths: ReturnType<typeof home>; tree: string; link: string } {
    const paths = home();
    const tree = source({ name: "clock" });
    const link = join(paths.pluginsDir, "clock");
    symlinkSync(tree, link, "junction");
    return { paths, tree, link };
  }

  it("is refused by add, which would put a copy where the author's link was", () => {
    const { paths, tree, link } = linked();
    const other = source({ name: "clock", dirName: "clock-elsewhere" });

    expect(() => addPlugin({ from: other, ...paths })).toThrow(
      new RegExp(`is a link to .*${basename(tree)}, so rigline will not replace it`),
    );
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(tree, "rigline.json"))).toBe(true);
  });

  it("is refused by remove, which names the link and what to do instead", () => {
    const { paths, tree, link } = linked();

    expect(() => removePlugin({ name: "clock", ...paths })).toThrow(
      /which rigline did not make and will not remove.*rigline disable clock/,
    );
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(tree, "rigline.json"))).toBe(true);
  });

  it("is no reason to refuse a link inside a plugin, which remove unlinks and does not follow", () => {
    const paths = home();
    const placed = addPlugin({ from: source({ name: "clock" }), ...paths });
    const elsewhere = tempDir();
    writeFileSync(join(elsewhere, "keep.txt"), "kept");
    symlinkSync(elsewhere, join(placed.dir, "linked"), "junction");

    removePlugin({ name: "clock", ...paths });

    expect(existsSync(placed.dir)).toBe(false);
    expect(readFileSync(join(elsewhere, "keep.txt"), "utf8")).toBe("kept");
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

  it("keeps everything else in config, comments included, because that file is the user's", () => {
    const paths = home();
    writeFileSync(
      paths.configPath,
      "somethingOfTheirs: 1 # theirs\n\n# too slow on this machine\ndisabled:\n  - probe\n",
    );

    setPluginEnabled(
      { name: "time-marks", configPath: paths.configPath, roots: [rootWith("time-marks")] },
      false,
    );

    expect(readFileSync(paths.configPath, "utf8")).toBe(
      "somethingOfTheirs: 1 # theirs\n\n# too slow on this machine\ndisabled:\n  - probe\n  - time-marks\n",
    );
  });

  it("writes nothing when nothing changes", () => {
    const paths = home();
    setPluginEnabled(
      { name: "time-marks", configPath: paths.configPath, roots: [rootWith("time-marks")] },
      true,
    );
    expect(existsSync(paths.configPath)).toBe(false);
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
