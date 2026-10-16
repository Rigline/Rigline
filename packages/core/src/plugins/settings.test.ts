import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeSettingsPayload, type SettingsSave } from "@rigline/plugin-api/internal";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "./config.ts";
import { ensureToken } from "./save.ts";
import { saveSettingsFromPanel, writeSettings } from "./settings.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-settings-"));
  dirs.push(dir);
  return dir;
}

describe("writeSettings", () => {
  it("keeps a comment on a key the save did not change (D91)", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(
      path,
      [
        "settings:",
        "  model-favourites:",
        "    # mine, do not touch",
        "    favourites: [opus]",
        "    warn: true",
        "",
      ].join("\n"),
    );

    expect(writeSettings(path, { "model-favourites": { favourites: ["opus"], warn: false } })).toBe(
      true,
    );
    const text = readFileSync(path, "utf8");
    expect(text).toContain("# mine, do not touch");
    expect(readConfig(path).settings).toEqual({
      "model-favourites": { favourites: ["opus"], warn: false },
    });
  });

  it("deletes a key the new value drops, and writes nothing when nothing moved", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "settings:\n  worktree:\n    prefix: wt\n    stale: yes\n");

    expect(writeSettings(path, { worktree: { prefix: "wt" } })).toBe(true);
    expect(readConfig(path).settings).toEqual({ worktree: { prefix: "wt" } });
    // A command that changes nothing writes nothing (D91).
    expect(writeSettings(path, { worktree: { prefix: "wt" } })).toBe(false);
  });

  it("takes an emptied section out, and `settings` with it", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "disabled: [probe]\nsettings:\n  worktree:\n    prefix: wt\n");

    expect(writeSettings(path, { worktree: {} })).toBe(true);
    expect(readFileSync(path, "utf8")).not.toContain("settings");
    // Only the settings went.
    expect(readConfig(path).disabled).toEqual(["probe"]);
  });

  it("leaves another plugin's section alone", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "settings:\n  a:\n    x: 1\n  b:\n    y: 2\n");

    writeSettings(path, { a: { x: 9 } });
    expect(readConfig(path).settings).toEqual({ a: { x: 9 }, b: { y: 2 } });
  });

  it("refuses a section that is not a mapping rather than repairing it", () => {
    const path = join(tempDir(), "config.yaml");
    writeFileSync(path, "settings:\n  a: nonsense\n");

    // Editing reads first, so the reader refuses it by name and the person who wrote it fixes it —
    // the same answer `disabled` and `companion` give to a shape somebody got wrong (D91).
    expect(() => writeSettings(path, { a: { x: 1 } })).toThrow(/"settings\.a" must be a mapping/);
  });
});

describe("saveSettingsFromPanel", () => {
  function home(): { configPath: string; tokenPath: string; token: string } {
    const dir = tempDir();
    const tokenPath = join(dir, "token");
    const made = ensureToken(tokenPath);
    if ("problem" in made) throw new Error(made.problem);
    return { configPath: join(dir, "config.yaml"), tokenPath, token: made.token };
  }

  const link = (token: string, sections: Record<string, SettingsSave>) =>
    encodeSettingsPayload({ v: 1, token, sections });

  it("writes the sections it is given and reports none over a change", () => {
    const { configPath, tokenPath, token } = home();
    writeFileSync(configPath, "settings:\n  a:\n    x: 1\n");

    expect(
      saveSettingsFromPanel(
        configPath,
        tokenPath,
        link(token, { a: { from: { x: 1 }, to: { x: 2 } } }),
        new Set(["a"]),
      ),
    ).toEqual({ changed: true, wrote: ["a"], overChange: [], unknown: [] });
    expect(readConfig(configPath).settings).toEqual({ a: { x: 2 } });
  });

  it("names a section whose file copy moved since the panel loaded", () => {
    const { configPath, tokenPath, token } = home();
    writeFileSync(configPath, "settings:\n  a:\n    x: 99\n  b:\n    y: 1\n");

    const saved = saveSettingsFromPanel(
      configPath,
      tokenPath,
      link(token, { a: { from: { x: 1 }, to: { x: 2 } }, b: { from: { y: 1 }, to: { y: 2 } } }),
      new Set(["a", "b"]),
    );
    // `a` moved under the panel; `b` did not. The write still lands, as the layout's does (D92).
    expect(saved).toEqual({ changed: true, wrote: ["a", "b"], overChange: ["a"], unknown: [] });
    expect(readConfig(configPath).settings).toEqual({ a: { x: 2 }, b: { y: 2 } });
  });

  it("treats an absent section as an empty baseline rather than a change", () => {
    const { configPath, tokenPath, token } = home();
    writeFileSync(configPath, "disabled: []\n");

    expect(
      saveSettingsFromPanel(
        configPath,
        tokenPath,
        link(token, { a: { from: {}, to: { x: 1 } } }),
        new Set(["a"]),
      ),
    ).toEqual({ changed: true, wrote: ["a"], overChange: [], unknown: [] });
  });

  it("skips a section naming a plugin this machine has not got, and writes the rest", () => {
    const { configPath, tokenPath, token } = home();
    writeFileSync(configPath, "settings:\n  a:\n    x: 1\n");

    const saved = saveSettingsFromPanel(
      configPath,
      tokenPath,
      link(token, { a: { from: { x: 1 }, to: { x: 2 } }, gone: { from: {}, to: { y: 1 } } }),
      new Set(["a"]),
    );
    expect(saved).toEqual({ changed: true, wrote: ["a"], overChange: [], unknown: ["gone"] });
    // No block invented for a plugin that was never here, and `a` still saved.
    expect(readConfig(configPath).settings).toEqual({ a: { x: 2 } });
  });

  it("writes a section for a plugin that is only switched off", () => {
    const { configPath, tokenPath, token } = home();
    writeFileSync(configPath, "disabled:\n  - a\nsettings:\n  a:\n    x: 1\n");

    // Discovered, not enabled: `remove` leaves a section behind and the bake skips an unenabled
    // one, so a switched-off plugin's block lives in the file legitimately.
    const saved = saveSettingsFromPanel(
      configPath,
      tokenPath,
      link(token, { a: { from: { x: 1 }, to: { x: 2 } } }),
      new Set(["a"]),
    );
    expect(saved.wrote).toEqual(["a"]);
    expect(readConfig(configPath).settings).toEqual({ a: { x: 2 } });
  });

  it("writes nothing when every section names a plugin that is not installed", () => {
    const { configPath, tokenPath, token } = home();
    writeFileSync(configPath, "settings:\n  a:\n    x: 1\n");

    const saved = saveSettingsFromPanel(
      configPath,
      tokenPath,
      link(token, { gone: { from: {}, to: { y: 1 } } }),
      new Set(["a"]),
    );
    expect(saved).toEqual({ changed: false, wrote: [], overChange: [], unknown: ["gone"] });
    expect(readConfig(configPath).settings).toEqual({ a: { x: 1 } });
  });

  it("refuses another machine's token, and a payload that is not one", () => {
    const { configPath, tokenPath } = home();
    writeFileSync(configPath, "settings:\n  a:\n    x: 1\n");

    expect(() =>
      saveSettingsFromPanel(
        configPath,
        tokenPath,
        link("0".repeat(32), { a: { from: {}, to: {} } }),
        new Set(["a"]),
      ),
    ).toThrow(/token is not this machine's/);
    expect(() => saveSettingsFromPanel(configPath, tokenPath, "not-a-payload", new Set())).toThrow(
      /not saved/,
    );
  });
});
