import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserError } from "../errors.ts";
import {
  EXTENSION_NAME_PREFIX,
  extensionVersion,
  findExtension,
  installedExtensions,
  supersededExtensions,
} from "./locate.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "prototype-locate-"));
  dirs.push(dir);
  return dir;
}

function makeExtension(extensionsDir: string, name: string): string {
  const dir = join(extensionsDir, name);
  mkdirSync(join(dir, "webview"), { recursive: true });
  writeFileSync(join(dir, "webview", "index.js"), "");
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("installedExtensions", () => {
  it("sorts numerically, oldest first, never lexically", () => {
    // The bug this pins: "2.1.59" sorts above "2.1.263" as a string, and both can be on disk at
    // once during the window an update is installing.
    const extensionsDir = tempDir();
    makeExtension(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.59-win32-x64`);
    makeExtension(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.263-win32-x64`);
    makeExtension(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.9-win32-x64`);

    const versions = installedExtensions(extensionsDir).map((dir) => dir.split(/[\\/]/).at(-1));
    expect(versions).toEqual([
      `${EXTENSION_NAME_PREFIX}2.1.9-win32-x64`,
      `${EXTENSION_NAME_PREFIX}2.1.59-win32-x64`,
      `${EXTENSION_NAME_PREFIX}2.1.263-win32-x64`,
    ]);
  });

  it("ignores directories belonging to other publishers", () => {
    const extensionsDir = tempDir();
    makeExtension(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.263-win32-x64`);
    makeExtension(extensionsDir, "someoneelse.thing-9.9.9");

    expect(installedExtensions(extensionsDir)).toHaveLength(1);
  });

  it("returns an empty list when the extensions directory does not exist", () => {
    expect(installedExtensions(join(tempDir(), "does-not-exist"))).toEqual([]);
  });
});

describe("findExtension", () => {
  it("picks the newest by numeric version", () => {
    const extensionsDir = tempDir();
    makeExtension(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.59-win32-x64`);
    makeExtension(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.263-win32-x64`);
    makeExtension(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.9-win32-x64`);

    expect(findExtension(extensionsDir).endsWith(`2.1.263-win32-x64`)).toBe(true);
  });

  it("throws UserError when nothing is installed", () => {
    const extensionsDir = tempDir();
    expect(() => findExtension(extensionsDir)).toThrow(UserError);
  });

  it("throws UserError when the extensions directory does not exist", () => {
    expect(() => findExtension(join(tempDir(), "does-not-exist"))).toThrow(UserError);
  });
});

describe("supersededExtensions", () => {
  it("returns every installed directory except the newest", () => {
    const extensionsDir = tempDir();
    makeExtension(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.59-win32-x64`);
    makeExtension(extensionsDir, `${EXTENSION_NAME_PREFIX}2.1.263-win32-x64`);

    const superseded = supersededExtensions(extensionsDir);
    expect(superseded).toHaveLength(1);
    expect(superseded[0]?.endsWith("2.1.59-win32-x64")).toBe(true);
  });
});

describe("extensionVersion", () => {
  it("reads package.json's version when the directory carries a platform suffix", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "2.1.270" }));
    expect(extensionVersion(dir)).toBe("2.1.270");
  });

  it("reads package.json's version when the directory is a plain version, as an extracted VSIX is", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "2.1.270" }));
    expect(extensionVersion(dir)).toBe("2.1.270");
  });

  it("throws UserError when there is no manifest", () => {
    const dir = tempDir();
    expect(() => extensionVersion(dir)).toThrow(UserError);
  });
});
