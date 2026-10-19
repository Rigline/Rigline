import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIPPED_LAYOUT } from "@rigline/plugin-api/internal";
import { afterEach, describe, expect, it } from "vitest";
import {
  addToList,
  editConfig,
  readConfig,
  readSources,
  removeFromList,
  unknownKeyLines,
  updateSources,
} from "./config.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-config-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SOURCE = { kind: "path", from: "/somewhere/clock", addedAt: "2026-09-18T11:00:00.000Z" };

describe("readConfig", () => {
  it("reads an absent file as a new one, the shipped layout and nothing else, and says where it looked", () => {
    const path = join(tempDir(), "config.yaml");
    expect(readConfig(path)).toEqual({
      path,
      disabled: [],
      layout: SHIPPED_LAYOUT,
      settings: {},
      model: { requireChoice: "off", default: null },
      unknownKeys: [],
    });
    expect(existsSync(path)).toBe(false);
  });

  it("writes the shipped layout into a file a command creates, beside what the command wrote", () => {
    const path = join(tempDir(), "config.yaml");
    editConfig(path, (doc) => addToList(doc, ["disabled"], "time-marks"));
    expect(readConfig(path).layout).toEqual(SHIPPED_LAYOUT);
    expect(readConfig(path).disabled).toEqual(["time-marks"]);
  });

  it("keeps a file with no layout at every plugin's default", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "disabled: []\n");
    expect(readConfig(path).layout).toEqual({});
  });

  it("reads Rigline's model block, and names what this version does not know (D110)", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(
      path,
      ["model:", "  default: { model: opus, effort: high }", "  requireChoice: always", ""].join(
        "\n",
      ),
    );
    expect(readConfig(path).model).toEqual({
      requireChoice: "always",
      default: { model: "opus", effort: "high" },
    });
    writeFileSync(path, "model:\n  requireChoice: smart\n  later: 1\n");
    const later = readConfig(path);
    expect(later.model).toEqual({ requireChoice: "off", default: null });
    expect(later.unknownKeys).toEqual(["model.later", "model.requireChoice: smart"]);
  });

  it("refuses a model block of the wrong shape, naming the file", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "model:\n  default: opus\n");
    expect(() => readConfig(path)).toThrow(`${path}: "model.default" must name a model`);
  });

  it("carries a settings section whole, including keys it does not understand (D138)", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(
      path,
      [
        "settings:",
        "  model-favourites:",
        "    favourites:",
        "      - {model: opus, effort: xhigh}",
        "    somethingNewer: 3",
        "  emptied:",
        "",
      ].join("\n"),
    );
    const config = readConfig(path);
    expect(config.settings).toEqual({
      "model-favourites": {
        favourites: [{ model: "opus", effort: "xhigh" }],
        somethingNewer: 3,
      },
    });
    // A key inside a section is the plugin's vocabulary, so it is never an unknown key.
    expect(config.unknownKeys).toEqual([]);
  });

  it("refuses a settings block, or a section, that is not a mapping", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "settings: [one, two]\n");
    expect(() => readConfig(path)).toThrow(/"settings" must be a mapping of plugin names/);
    writeFileSync(path, "settings:\n  worktree: off\n");
    expect(() => readConfig(path)).toThrow(/"settings.worktree" must be a mapping/);
  });

  it("reads the layout as written, a place it does not know included (D92)", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(
      path,
      [
        "layout:",
        "  rigRow:",
        "    - session-id/address",
        "  before footerSpacer: [session-id/short-id]",
        "  rigrow: [typo/kept]",
        "  off:",
        "",
      ].join("\n"),
    );
    expect(readConfig(path).layout).toEqual({
      rigRow: ["session-id/address"],
      "before footerSpacer": ["session-id/short-id"],
      rigrow: ["typo/kept"],
      off: [],
    });
  });

  it("rejects a layout that is not a mapping of lists of names", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "layout: [rigRow]\n");
    expect(() => readConfig(path)).toThrow(/"layout" must be a mapping/);
    writeFileSync(path, "layout:\n  rigRow: session-id/address\n");
    expect(() => readConfig(path)).toThrow(/"layout.rigRow" must be a list/);
  });

  it("reads a list in either style", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "disabled:\n  - a\n  - b\n");
    expect(readConfig(path).disabled).toEqual(["a", "b"]);
    writeFileSync(path, "disabled: [a, b]\n");
    expect(readConfig(path).disabled).toEqual(["a", "b"]);
  });

  it("reads an emptied `disabled:`, a comment-only file and an empty one as nothing disabled", () => {
    const path = join(tempDir(), "config.yaml");
    for (const text of ["disabled:\n", "# nothing yet\n", ""]) {
      writeFileSync(path, text);
      expect(readConfig(path).disabled).toEqual([]);
    }
  });

  it("names the file and the line of a YAML mistake", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "disabled: [a\n");
    expect(() => readConfig(path)).toThrow(`${path} is not valid YAML`);
    writeFileSync(path, "disabled: [a]\ndisabled: [b]\n");
    expect(() => readConfig(path)).toThrow(/unique at line 2/);
  });

  it("rejects a file that is not a mapping, and a disabled that is not a list of names", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "- a\n");
    expect(() => readConfig(path)).toThrow(/must be a mapping/);
    writeFileSync(path, "disabled: a\n");
    expect(() => readConfig(path)).toThrow(/"disabled" must be a list of plugin names/);
  });

  it("names a key it does not read, and reads the rest", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "disabled: [a]\ntheme: dark\nlayout:\n");
    const config = readConfig(path);
    expect(config.unknownKeys).toEqual(["theme"]);
    expect(config.disabled).toEqual(["a"]);
    expect(unknownKeyLines(config)).toEqual([
      `${path} has "theme", which this version of Rigline does not know; fix it if it is a typo, or run \`rigline update\` if a later Rigline wrote it`,
    ]);
  });

  // 1.x wrote this block; 2.0 reads none of it and migrates nothing (D143).
  it("names the companion block 1.x read as a key it does not read", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "companion:\n  skipProfiles: [Kokai]\n");
    expect(readConfig(path).unknownKeys).toEqual(["companion"]);
  });

  it("knows every key a command writes, so none of them is named", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "disabled: []\nlayout:\n  rigRow: [a/b]\n");
    expect(readConfig(path).unknownKeys).toEqual([]);
  });
});

describe("editConfig", () => {
  it("keeps comments, blank lines, flow style and keys it has never heard of", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "# mine\nsettings:\n  clock: {size: 2} # big\n\ndisabled: [a] # for now\n");

    editConfig(path, (doc) => addToList(doc, ["disabled"], "b"));

    expect(readFileSync(path, "utf8")).toBe(
      "# mine\nsettings:\n  clock: {size: 2} # big\n\ndisabled: [a, b] # for now\n",
    );
  });

  it("writes in the line endings the file already had", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "# mine\r\ndisabled:\r\n  - a\r\n");

    editConfig(path, (doc) => addToList(doc, ["disabled"], "b"));

    expect(readFileSync(path, "utf8")).toBe("# mine\r\ndisabled:\r\n  - a\r\n  - b\r\n");
  });

  it("starts a file that is not there with a header pointing at its documentation", () => {
    const path = join(tempDir(), "config.yaml");

    editConfig(path, (doc) => addToList(doc, ["disabled"], "a"));

    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/^# Rigline's settings\./);
    expect(text).toContain("docs/config.md");
    expect(text).toContain("disabled:\n  - a\n");
  });

  it("writes nothing when the edit changes nothing", () => {
    const path = join(tempDir(), "config.yaml");
    expect(editConfig(path, (doc) => removeFromList(doc, ["disabled"], "a"))).toBe(false);
    expect(existsSync(path)).toBe(false);

    writeFileSync(path, "disabled: [a]\n");
    expect(editConfig(path, (doc) => addToList(doc, ["disabled"], "a"))).toBe(false);
  });

  it("refuses to edit a file it could not read, and leaves it alone", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "disabled: a\n");
    expect(() => editConfig(path, (doc) => addToList(doc, ["disabled"], "b"))).toThrow(
      /must be a list/,
    );
    expect(readFileSync(path, "utf8")).toBe("disabled: a\n");
  });

  it("takes the last name out of a list and leaves the key, and any comment on it", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "# off for now\ndisabled:\n  - a\n");

    editConfig(path, (doc) => removeFromList(doc, ["disabled"], "a"));

    expect(readFileSync(path, "utf8")).toBe("# off for now\ndisabled: []\n");
  });
});

describe("readSources", () => {
  it("reads the sources add recorded, and nothing when there is no file", () => {
    const path = join(tempDir(), "sources.json");
    expect(readSources(path)).toEqual({});
    writeFileSync(path, JSON.stringify({ clock: SOURCE }));
    expect(readSources(path)).toEqual({ clock: SOURCE });
  });

  it("skips a source kind it does not know, names it, and keeps the rest (D74)", () => {
    // A newer wrapper wrote it. Throwing would cost every command on every older engine, over one
    // entry describing one plugin; dropping it in silence would make that plugin look hand-placed.
    const path = join(tempDir(), "sources.json");
    writeFileSync(path, JSON.stringify({ clock: SOURCE, pigeon: { kind: "carrier-pigeon" } }));

    const lines: string[] = [];
    expect(readSources(path, (line) => lines.push(line))).toEqual({ clock: SOURCE });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"pigeon"');
    expect(lines[0]).toContain("carrier-pigeon");
  });

  it("writes back a record it cannot read rather than dropping it", () => {
    const path = join(tempDir(), "sources.json");
    const pigeon = { kind: "carrier-pigeon", loft: 3 };
    writeFileSync(path, JSON.stringify({ pigeon }));

    updateSources(path, (sources) => {
      sources.clock = SOURCE;
    });

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ pigeon, clock: SOURCE });
  });
});
