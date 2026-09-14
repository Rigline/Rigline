import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { missing, versionDir } from "../../test/corpus.ts";
import { UserError } from "../errors.ts";
import {
  hostBackupIsCurrent,
  isExtensionDir,
  pristineHostPath,
  pristineWebviewPath,
  readBundles,
} from "./bundles.ts";

const dirs: string[] = [];

function tempExtension(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-bundles-"));
  dirs.push(dir);
  mkdirSync(join(dir, "webview"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "2.1.270" }));
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("pristineWebviewPath", () => {
  it("prefers the backup when one exists", () => {
    const ext = tempExtension();
    writeFileSync(join(ext, "webview", "index.js"), "live");
    writeFileSync(join(ext, "webview", "index.js.orig"), "pristine");

    expect(pristineWebviewPath(ext)).toBe(join(ext, "webview", "index.js.orig"));
  });

  it("falls back to the live bundle when there is no backup", () => {
    const ext = tempExtension();
    writeFileSync(join(ext, "webview", "index.js"), "live");

    expect(pristineWebviewPath(ext)).toBe(join(ext, "webview", "index.js"));
  });

  it("throws UserError when neither file exists", () => {
    const ext = tempExtension();
    expect(() => pristineWebviewPath(ext)).toThrow(UserError);
  });
});

describe("hostBackupIsCurrent", () => {
  it("is true only when the backup's byte size equals the live file's", () => {
    const ext = tempExtension();
    writeFileSync(join(ext, "extension.js"), "abcdef");
    writeFileSync(join(ext, "extension.js.orig"), "abcdef");
    expect(hostBackupIsCurrent(join(ext, "extension.js.orig"), join(ext, "extension.js"))).toBe(
      true,
    );

    writeFileSync(join(ext, "extension.js.orig"), "shorter");
    writeFileSync(join(ext, "extension.js"), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(hostBackupIsCurrent(join(ext, "extension.js.orig"), join(ext, "extension.js"))).toBe(
      false,
    );
  });
});

describe("pristineHostPath", () => {
  it("prefers the backup only when its size matches the live file", () => {
    const ext = tempExtension();
    writeFileSync(join(ext, "extension.js"), "live-bytes");
    writeFileSync(join(ext, "extension.js.orig"), "orig-bytes");

    expect(pristineHostPath(ext)).toBe(join(ext, "extension.js.orig"));
  });

  it("falls back to the live file when the backup's size does not match", () => {
    const ext = tempExtension();
    writeFileSync(join(ext, "extension.js"), "a much longer live bundle than the backup");
    writeFileSync(join(ext, "extension.js.orig"), "short");

    expect(pristineHostPath(ext)).toBe(join(ext, "extension.js"));
  });

  it("falls back to the live file when there is no backup at all", () => {
    const ext = tempExtension();
    writeFileSync(join(ext, "extension.js"), "live-bytes");

    expect(pristineHostPath(ext)).toBe(join(ext, "extension.js"));
  });

  it("throws UserError when the live file is missing", () => {
    const ext = tempExtension();
    expect(() => pristineHostPath(ext)).toThrow(UserError);
  });
});

describe("readBundles", () => {
  it("returns version, webview, host and css", () => {
    const ext = tempExtension();
    writeFileSync(join(ext, "webview", "index.js"), "webview bytes");
    writeFileSync(join(ext, "webview", "index.css"), ".foo{}");
    writeFileSync(join(ext, "extension.js"), "host bytes");

    expect(readBundles(ext)).toEqual({
      version: "2.1.270",
      webview: "webview bytes",
      host: "host bytes",
      css: ".foo{}",
    });
  });

  it("returns an empty string for css when the stylesheet is absent", () => {
    const ext = tempExtension();
    writeFileSync(join(ext, "webview", "index.js"), "webview bytes");
    writeFileSync(join(ext, "extension.js"), "host bytes");

    expect(readBundles(ext).css).toBe("");
  });

  const version = "2.1.270";
  it.skipIf(missing(version))("reads the real corpus bundle and finds acquireVsCodeApi", () => {
    const bundles = readBundles(versionDir(version));
    expect(bundles.version).toBe(version);
    expect(bundles.webview).toContain("acquireVsCodeApi");
  });
});

describe("isExtensionDir", () => {
  it("is true when webview/index.js and package.json are both present", () => {
    const ext = tempExtension();
    writeFileSync(join(ext, "webview", "index.js"), "");
    expect(isExtensionDir(ext)).toBe(true);
  });

  it("is false when the webview bundle is missing", () => {
    const ext = tempExtension();
    expect(isExtensionDir(ext)).toBe(false);
  });
});
