import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addToList,
  editConfig,
  readConfig,
  readSources,
  removeFromList,
  splitLegacyConfig,
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
  it("returns an empty disabled list when the file is absent, and still says where it looked", () => {
    const path = join(tempDir(), "config.yaml");
    expect(readConfig(path)).toEqual({ path, disabled: [] });
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

describe("splitLegacyConfig", () => {
  function files(): { config: string; sources: string; legacy: string } {
    const dir = tempDir();
    return {
      config: join(dir, "config.yaml"),
      sources: join(dir, "sources.json"),
      legacy: join(dir, "config.json"),
    };
  }

  it("does nothing when there is no config.json", () => {
    const f = files();
    expect(splitLegacyConfig(f)).toBeNull();
    expect(existsSync(f.config)).toBe(false);
  });

  it("moves what a person chose into config.yaml and what add recorded into sources.json", () => {
    const f = files();
    writeFileSync(
      f.legacy,
      JSON.stringify({ disabled: ["probe"], sources: { clock: SOURCE }, theirs: { a: 1 } }),
    );

    expect(splitLegacyConfig(f)).toContain("moved");

    expect(existsSync(f.legacy)).toBe(false);
    expect(readConfig(f.config).disabled).toEqual(["probe"]);
    expect(readFileSync(f.config, "utf8")).toContain("theirs:\n  a: 1\n");
    expect(readFileSync(f.config, "utf8")).not.toContain("sources");
    expect(readSources(f.sources)).toEqual({ clock: SOURCE });
  });

  it("writes no sources.json when config.json recorded no sources", () => {
    const f = files();
    writeFileSync(f.legacy, JSON.stringify({ disabled: [] }));
    splitLegacyConfig(f);
    expect(existsSync(f.sources)).toBe(false);
    expect(readConfig(f.config).disabled).toEqual([]);
  });

  it("leaves a config.json written after the split alone, and says it is not read", () => {
    // An older engine running beside this one; what it wrote is not what loads.
    const f = files();
    writeFileSync(f.config, "disabled: []\n");
    writeFileSync(f.legacy, JSON.stringify({ disabled: ["probe"] }));

    expect(splitLegacyConfig(f)).toContain("is not read");
    expect(existsSync(f.legacy)).toBe(true);
    expect(readConfig(f.config).disabled).toEqual([]);
  });
});
