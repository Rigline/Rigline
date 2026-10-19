import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeSavePayload, type Layout, SAVE_PAYLOAD_VERSION } from "@rigline/plugin-api/internal";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "./config.ts";
import { broadcastName, ensureToken, readToken, saveFromPanel, saveRecord } from "./save.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-save-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tokenOf(path: string): string {
  const result = ensureToken(path);
  if (!("token" in result)) throw new Error(result.problem);
  return result.token;
}

describe("the token", () => {
  it("is made once, in a home that does not exist yet, and read after that", () => {
    const path = join(tempDir(), "home", "token");
    const token = tokenOf(path);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const written = statSync(path).mtimeMs;
    expect(tokenOf(path)).toBe(token);
    expect(statSync(path).mtimeMs).toBe(written);
    expect(readToken(path)).toEqual({ token });
  });

  it("leaves nothing beside it but the token", () => {
    const home = tempDir();
    tokenOf(join(home, "token"));
    expect(readdirSync(home)).toEqual(["token"]);
  });

  it("keeps a token another tool made first", () => {
    const path = join(tempDir(), "token");
    writeFileSync(path, "ABCDEFGHIJKLMNOPQRSTUV\n");
    expect(tokenOf(path)).toBe("ABCDEFGHIJKLMNOPQRSTUV");
  });

  it("never rewrites a file that does not hold one, and says what to do", () => {
    const path = join(tempDir(), "token");
    writeFileSync(path, "garbage");
    expect(ensureToken(path)).toMatchObject({ problem: expect.stringContaining("delete it") });
    expect(readFileSync(path, "utf8")).toBe("garbage");
  });
});

describe("the broadcast channel's name (D141)", () => {
  it("is the token's, every time, and gives the token away nowhere in it", () => {
    const token = "ABCDEFGHIJKLMNOPQRSTUV";
    const name = broadcastName(token);
    expect(name).toMatch(/^rigline-[0-9a-f]{32}$/);
    expect(broadcastName(token)).toBe(name);
    expect(name).not.toContain(token);
    expect(broadcastName("ABCDEFGHIJKLMNOPQRSTUW")).not.toBe(name);
  });
});

// Nothing about the companion: it is required, so where it matters it is there (D143).
describe("the save record", () => {
  it("is the token and the scheme", () => {
    const tokenPath = join(tempDir(), "token");
    const record = saveRecord(tokenPath, () => {});
    expect(record).toEqual({ token: tokenOf(tokenPath), scheme: "vscode" });
  });

  it("bakes no token where the file holds none, and says Save is off", () => {
    const tokenPath = join(tempDir(), "token");
    writeFileSync(tokenPath, "garbage");
    const log: string[] = [];
    expect(saveRecord(tokenPath, (l) => log.push(l)).token).toBeNull();
    expect(log).toEqual([expect.stringMatching(/^Save in the panel is off: /)]);
  });
});

describe("a save from the panel", () => {
  function setup(config: string): { configPath: string; tokenPath: string; token: string } {
    const home = tempDir();
    const configPath = join(home, "config.yaml");
    writeFileSync(configPath, config);
    const tokenPath = join(home, "token");
    return { configPath, tokenPath, token: tokenOf(tokenPath) };
  }

  const link = (token: string, from: Layout, to: Layout): string =>
    encodeSavePayload({ v: SAVE_PAYLOAD_VERSION, token, from, to });

  it("writes the copy over the file's layout, keeping comments and emptying places it dropped", () => {
    const { configPath, tokenPath, token } = setup(
      [
        "# my settings",
        "disabled: [time-marks]",
        "layout:",
        "  rigRow:",
        "    - session-id/address # keep this",
        "  off:",
        "    - session-id/short-id",
        "",
      ].join("\n"),
    );
    const from = readConfig(configPath).layout;
    const to = { rigRow: ["session-id/full-id", "session-id/address"] };
    expect(saveFromPanel(configPath, tokenPath, link(token, from, to))).toEqual({
      changed: true,
      overChange: false,
    });
    const text = readFileSync(configPath, "utf8");
    expect(readConfig(configPath).layout).toEqual(to);
    expect(text).toContain("# my settings");
    expect(text).toContain("session-id/address # keep this");
    expect(readConfig(configPath).disabled).toEqual(["time-marks"]);
  });

  it("takes the layout out of the file when the copy is empty", () => {
    const { configPath, tokenPath, token } = setup("layout:\n  off: [session-id/short-id]\n");
    const from = readConfig(configPath).layout;
    saveFromPanel(configPath, tokenPath, link(token, from, {}));
    expect(readFileSync(configPath, "utf8")).not.toContain("layout");
  });

  it("says when it saved over a change made since the panel loaded, and when nothing changed", () => {
    const { configPath, tokenPath, token } = setup("layout:\n  rigRow: [a/b]\n");
    const to = { rigRow: ["c/d"] };
    expect(saveFromPanel(configPath, tokenPath, link(token, {}, to))).toEqual({
      changed: true,
      overChange: true,
    });
    expect(saveFromPanel(configPath, tokenPath, link(token, to, to)).changed).toBe(false);
  });

  it("refuses another machine's token, and a malformed payload, writing nothing", () => {
    const { configPath, tokenPath } = setup("layout:\n  rigRow: [a/b]\n");
    const before = readFileSync(configPath, "utf8");
    expect(() =>
      saveFromPanel(configPath, tokenPath, link("ZZZZZZZZZZZZZZZZZZZZZZ", {}, {})),
    ).toThrow(/token is not this machine's; reload the panel/);
    expect(() => saveFromPanel(configPath, tokenPath, "%%%")).toThrow(/^not saved: /);
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it("refuses when there is no token to check against", () => {
    const home = tempDir();
    const configPath = join(home, "config.yaml");
    expect(() =>
      saveFromPanel(configPath, join(home, "token"), link("ABCDEFGHIJKLMNOPQRSTUV", {}, {})),
    ).toThrow(/rigline install/);
  });
});
