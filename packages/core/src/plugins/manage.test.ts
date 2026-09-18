/**
 * `add` and `remove`, against disposable directories.
 *
 * The interesting cases are the ones where a copy alone would be wrong: a source directory whose
 * name is not the plugin's, a name already taken somewhere `add` does not own, a `config.json`
 * carrying something this code has never heard of, and a `remove` pointed at a checkout.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserError } from "../errors.ts";
import { readConfig } from "./discover.ts";
import { addPlugin, removePlugin } from "./manage.ts";

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
