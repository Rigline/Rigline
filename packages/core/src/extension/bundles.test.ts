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
  sleepSync,
  wholenessProblem,
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

/** A directory that passes every wholeness check, so each test can spoil exactly one thing. */
function wholeExtension(): string {
  const ext = tempExtension();
  writeFileSync(join(ext, "webview", "index.js"), "var a={};\n");
  writeFileSync(join(ext, "extension.js"), "var b={};\n");
  writeFileSync(join(ext, "webview", "index.css"), ".a{}");
  return ext;
}

/** No wait: every case below is about the verdict, and the sample gap has its own tests. */
const whole = (ext: string) => wholenessProblem(ext, { sleep: () => {} });

describe("wholenessProblem", () => {
  it("says nothing is wrong with a finished directory", () => {
    expect(whole(wholeExtension())).toBeNull();
  });

  it("names the file that has not arrived", () => {
    const ext = wholeExtension();
    rmSync(join(ext, "extension.js"));
    expect(whole(ext)).toMatch(/extension\.js is not there yet/);
  });

  it("names an empty file, which is a created-but-unwritten one", () => {
    const ext = wholeExtension();
    writeFileSync(join(ext, "webview", "index.js"), "");
    expect(whole(ext)).toMatch(/is empty/);
  });

  it("refuses a manifest that is not JSON yet", () => {
    const ext = wholeExtension();
    writeFileSync(join(ext, "package.json"), '{"version": "2.1.2');
    expect(whole(ext)).toMatch(/not readable JSON/);
  });

  it("refuses a manifest with no version", () => {
    const ext = wholeExtension();
    writeFileSync(join(ext, "package.json"), "{}");
    expect(whole(ext)).toMatch(/no version/);
  });

  it("accepts a bundle that is merely odd, because content is not what this judges", () => {
    // The dropped tail check would have refused this. Recorded as a test so the reasoning in
    // `wholenessProblem` is enforced rather than merely written down: structure only, because a
    // content rule that fits today's bundler refuses everybody on the day it changes (P8).
    const ext = wholeExtension();
    writeFileSync(join(ext, "extension.js"), "var b={};\n//# sourceMappingURL=extension.js.map\n");
    expect(whole(ext)).toBeNull();
  });

  it("checks the css too, since a part-written install often has some files and not others", () => {
    const ext = wholeExtension();
    rmSync(join(ext, "webview", "index.css"));
    expect(whole(ext)).toMatch(/index\.css is not there yet/);
  });

  // The half structure cannot see: every file present, one of them still growing. This is the
  // shape that produces a fragment as the pristine backup, so it is the one that matters.
  it("refuses a file that grew between the two samples, and names it", () => {
    const ext = wholeExtension();
    const problem = wholenessProblem(ext, {
      sleep: () => {
        writeFileSync(join(ext, "webview", "index.js"), "var a={};var more={};");
      },
    });
    expect(problem).toMatch(/index\.js is still being written/);
  });

  it("refuses a file that disappeared between the two samples", () => {
    const ext = wholeExtension();
    const problem = wholenessProblem(ext, {
      sleep: () => {
        rmSync(join(ext, "extension.js"));
      },
    });
    expect(problem).toMatch(/extension\.js is still being written/);
  });

  it("accepts a directory nobody is touching, which is every ordinary run", () => {
    const ext = wholeExtension();
    expect(wholenessProblem(ext, { settleMs: 5 })).toBeNull();
  });
});

describe("sleepSync", () => {
  // The whole reason `install` stayed synchronous. If this ever silently returns immediately the
  // stability sample becomes two stats in a row, which would pass on a directory mid-write.
  it("actually blocks the thread", () => {
    const before = Date.now();
    sleepSync(30);
    expect(Date.now() - before).toBeGreaterThanOrEqual(25);
  });
});
