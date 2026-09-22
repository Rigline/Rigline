/**
 * Never point these at a real, installed extension: a failing assertion mid-test would leave a
 * real install half-patched, and the panel renders blank when the static import is broken. Every
 * fixture here is a disposable `mkdtempSync` copy.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { harvestableHostReplies, harvestableWebview } from "../../test/fixtures.ts";
import { sleepSync } from "../extension/bundles.ts";
import {
  hostVerdict,
  type InstallOptions,
  type InstallReport,
  inspect,
  install as installBundle,
  PATCH_BYTES,
  restore,
  restoreAll,
  verdict,
} from "./inject.ts";

// Mirrors docs/host.md's two lines exactly, so a test failure here means the documented contract
// moved, not just this module's internals.
const PRE_LINE = 'import"./rigline/pre.js";/*RIGLINE-PRE*/\n';
const POST_LINE =
  '\n/*RIGLINE-POST*/import("./rigline/post.js").catch((e)=>console.error("[rigline] post-hook",e));\n';

const HOST_ANCHOR = "{dir:this.cwd,includeWorktrees:!1}";
const PATCHED_ANCHOR = "{dir:this.cwd,includeWorktrees:!0}";

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function hostBundleText(): string {
  return `${harvestableHostReplies()};function listSessions(){return ${HOST_ANCHOR}}`;
}

/** A disposable extension directory: webview bundle (CRLF, Latin1), host bundle, package.json. */
function fixture(options: { readonly version?: string } = {}): string {
  const ext = tempDir("rigline-inject-");
  const version = options.version ?? "2.1.263";
  const { js, css } = harvestableWebview();
  // CRLF line endings, encoded Latin1, so byte-mode I/O is observable rather than assumed.
  const bundleText = `var a=1;\r\n${js}\r\n/*end*/\r\n`;

  mkdirSync(join(ext, "webview"), { recursive: true });
  writeFileSync(join(ext, "webview", "index.js"), Buffer.from(bundleText, "latin1"));
  writeFileSync(join(ext, "webview", "index.css"), css);
  writeFileSync(join(ext, "extension.js"), hostBundleText());
  writeFileSync(join(ext, "package.json"), JSON.stringify({ version }));
  return ext;
}

function bundlePath(ext: string): string {
  return join(ext, "webview", "index.js");
}
function backupPath(ext: string): string {
  return join(ext, "webview", "index.js.orig");
}
function hostPath(ext: string): string {
  return join(ext, "extension.js");
}
function hostBackupPath(ext: string): string {
  return join(ext, "extension.js.orig");
}
function payloadOutDir(ext: string): string {
  return join(ext, "webview", "rigline");
}

function payload(preContent = "export default 1;\n", postContent = "export default 2;\n"): string {
  const dir = tempDir("rigline-payload-");
  writeFileSync(join(dir, "pre.js"), preContent);
  writeFileSync(join(dir, "post.js"), postContent);
  return dir;
}

function writePlugin(
  root: string,
  name: string,
  overrides: Record<string, unknown> = {},
  entrySource = "export default { setup() {} };\n",
): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "rigline.json"),
    JSON.stringify({ api: 1, name, entry: "index.js", ...overrides }),
  );
  writeFileSync(join(dir, "index.js"), entrySource);
  return dir;
}

function writeConfig(disabled: readonly string[]): string {
  const path = join(tempDir("rigline-config-"), "config.json");
  writeFileSync(path, JSON.stringify({ disabled }));
  return path;
}

function withPlugins(
  roots: readonly string[],
  extra: Partial<NonNullable<InstallOptions["plugins"]>> = {},
): NonNullable<InstallOptions["plugins"]> {
  return { roots, configPath: writeConfig([]), ...extra };
}

/**
 * `install` without the stability sample's quarter of a second.
 *
 * Every fixture here is written by the line above the call, so there is never a write in flight to
 * sample for — and paying for the sample forty times over is a third of this file's runtime. The
 * two cases that are *about* the sample call the real one below.
 */
const install = (ext: string, options: InstallOptions): InstallReport =>
  installBundle(ext, { wholeness: { sleep: () => {} }, ...options });

describe("install", () => {
  it("adds exactly PATCH_BYTES and nothing else, and the backup equals the original bundle", () => {
    const ext = fixture();
    const original = readFileSync(bundlePath(ext));

    install(ext, { payloadDir: payload() });

    const live = readFileSync(bundlePath(ext));
    expect(live.length - original.length).toBe(PATCH_BYTES);
    expect(readFileSync(backupPath(ext))).toEqual(original);
  });

  it("keeps the original bytes as one contiguous run between the two lines, CRLFs preserved", () => {
    const ext = fixture();
    const original = readFileSync(bundlePath(ext));

    install(ext, { payloadDir: payload() });

    const live = readFileSync(bundlePath(ext));
    expect(live).toEqual(
      Buffer.concat([Buffer.from(PRE_LINE, "utf8"), original, Buffer.from(POST_LINE, "utf8")]),
    );
    const crlfBefore = (original.toString("latin1").match(/\r\n/g) ?? []).length;
    const crlfAfter = (live.toString("latin1").match(/\r\n/g) ?? []).length;
    expect(crlfAfter).toBe(crlfBefore);
    expect(crlfBefore).toBeGreaterThan(0);
  });

  it("puts the static import first and the dynamic import last", () => {
    const ext = fixture();
    install(ext, { payloadDir: payload() });

    const live = readFileSync(bundlePath(ext)).toString("latin1");
    expect(live.startsWith('import"./rigline/pre.js";/*RIGLINE-PRE*/')).toBe(true);
    expect(live).toMatch(/\/\*RIGLINE-POST\*\/import\("\.\/rigline\/post\.js"\)\.catch/);
    expect(live.indexOf('import"./rigline/pre.js"')).toBeLessThan(live.indexOf("RIGLINE-POST"));
    expect(live.trimEnd().endsWith('console.error("[rigline] post-hook",e));')).toBe(true);
  });

  it("copies the payload files into webview/rigline/", () => {
    const ext = fixture();
    install(ext, { payloadDir: payload("PRE_MARKER", "POST_MARKER") });

    expect(readFileSync(join(payloadOutDir(ext), "pre.js"), "utf8")).toBe("PRE_MARKER");
    expect(readFileSync(join(payloadOutDir(ext), "post.js"), "utf8")).toBe("POST_MARKER");
  });

  it("refreshes the payload without rewriting the bundle on a second install", () => {
    const ext = fixture();
    install(ext, { payloadDir: payload("v1", "v1") });
    const afterFirst = readFileSync(bundlePath(ext));

    const report = install(ext, { payloadDir: payload("v2", "v2") });

    expect(report.action).toBe("refreshed");
    expect(readFileSync(bundlePath(ext))).toEqual(afterFirst);
    expect(readFileSync(join(payloadOutDir(ext), "pre.js"), "utf8")).toBe("v2");
  });

  it("refuses a payload directory missing a hook, and touches nothing", () => {
    const ext = fixture();
    const original = readFileSync(bundlePath(ext));
    const badPayload = tempDir("rigline-bad-payload-");
    writeFileSync(join(badPayload, "pre.js"), "x");

    expect(() => install(ext, { payloadDir: badPayload })).toThrow(/payload is missing post\.js/);
    expect(readFileSync(bundlePath(ext))).toEqual(original);
    expect(existsSync(backupPath(ext))).toBe(false);
  });

  it("rewrites generated.js on every install, and it carries this directory's version", () => {
    const ext = fixture({ version: "2.1.270" });
    install(ext, { payloadDir: payload() });

    const generated = readFileSync(join(payloadOutDir(ext), "generated.js"), "utf8");
    expect(generated).toContain("from extension 2.1.270");
    expect(generated).toContain('"version":"2.1.270"');
    expect(generated).toContain('"req_0"');
    expect(generated).toContain('"req_0_response"');
    expect(generated).toContain('"field_0"');

    writeFileSync(join(payloadOutDir(ext), "generated.js"), "stale, hand-edited");
    install(ext, { payloadDir: payload() });
    const refreshed = readFileSync(join(payloadOutDir(ext), "generated.js"), "utf8");
    expect(refreshed).not.toBe("stale, hand-edited");
    expect(refreshed).toContain('"version":"2.1.270"');
  });

  it("gives two fixtures at different versions different generated.js but identical pre.js", () => {
    const extA = fixture({ version: "2.1.270" });
    const extB = fixture({ version: "2.1.271" });
    const onePayload = payload("shared pre", "shared post");

    install(extA, { payloadDir: onePayload });
    install(extB, { payloadDir: onePayload });

    const generatedA = readFileSync(join(payloadOutDir(extA), "generated.js"), "utf8");
    const generatedB = readFileSync(join(payloadOutDir(extB), "generated.js"), "utf8");
    expect(generatedA).not.toBe(generatedB);
    expect(readFileSync(join(payloadOutDir(extA), "pre.js"))).toEqual(
      readFileSync(join(payloadOutDir(extB), "pre.js")),
    );
  });

  it("does not create registry.js when no plugins option is given", () => {
    const ext = fixture();
    install(ext, { payloadDir: payload() });
    expect(existsSync(join(payloadOutDir(ext), "registry.js"))).toBe(false);
  });
});

describe("a second run writes nothing", () => {
  /** Modification times of every file under a directory, so "was it written" is observable. */
  function touched(dir: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      const path = join(entry.parentPath, entry.name);
      if (entry.isFile()) out[path] = statSync(path).mtimeMs;
    }
    return out;
  }

  // The companion runs this on every update, against every installed version — so three of four
  // runs land on a directory that is already exactly right, one of them under a live webview.
  it("leaves every payload file alone when nothing has changed", () => {
    const ext = fixture();
    const root = tempDir("rigline-plugins-");
    writePlugin(root, "alpha");
    const options = { payloadDir: payload(), plugins: withPlugins([root]) };

    install(ext, options);
    const before = touched(payloadOutDir(ext));
    // mtime has millisecond resolution, so a rewrite inside the same tick would be invisible.
    sleepSync(20);
    const lines: string[] = [];
    const report = install(ext, { ...options, log: (line) => lines.push(line) });

    expect(touched(payloadOutDir(ext))).toEqual(before);
    expect(report.action).toBe("refreshed");
    expect(lines.join("\n")).toMatch(/already current, nothing written/);
  });

  it("writes the one file that did change, and only that one", () => {
    const ext = fixture();
    const root = tempDir("rigline-plugins-");
    const dir = writePlugin(root, "alpha");
    const options = { payloadDir: payload(), plugins: withPlugins([root]) };

    install(ext, options);
    const before = touched(payloadOutDir(ext));
    sleepSync(20);
    // What `rigline dev` does: the same plugin, rebuilt. A stamp keyed on its version would miss
    // this and leave the panel running yesterday's code while reporting success.
    writeFileSync(join(dir, "index.js"), "export default { setup() { /* rebuilt */ } };\n");
    install(ext, options);

    const after = touched(payloadOutDir(ext));
    const moved = Object.keys(after).filter((path) => after[path] !== before[path]);
    expect(moved).toEqual([join(payloadOutDir(ext), "plugins", "alpha", "index.js")]);
  });

  it("removes a plugin's directory once it is no longer enabled", () => {
    const ext = fixture();
    const root = tempDir("rigline-plugins-");
    writePlugin(root, "alpha");
    writePlugin(root, "beta");

    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });
    expect(existsSync(join(payloadOutDir(ext), "plugins", "beta"))).toBe(true);

    install(ext, {
      payloadDir: payload(),
      plugins: { roots: [root], configPath: writeConfig(["beta"]) },
    });

    expect(existsSync(join(payloadOutDir(ext), "plugins", "beta"))).toBe(false);
    expect(existsSync(join(payloadOutDir(ext), "plugins", "alpha"))).toBe(true);
  });
});

describe("a directory still being written", () => {
  // Not the same assertion as `wholenessProblem`'s own. A predicate can be right while its caller
  // asks too late, and asking too late here means `settleWebviewBackup` has already made a
  // fragment the pristine backup — silently, and destroying the only recovery path (D81).
  it("is refused before anything is read or written, so no backup is made", () => {
    const ext = fixture();
    expect(() =>
      installBundle(ext, {
        payloadDir: payload(),
        wholeness: {
          sleep: () => {
            writeFileSync(bundlePath(ext), "var a=1;// still arriving");
          },
        },
      }),
    ).toThrow(/still being written/);

    expect(existsSync(backupPath(ext))).toBe(false);
    expect(existsSync(payloadOutDir(ext))).toBe(false);
  });

  it("says an update is probably in progress, which is the thing to do about it", () => {
    const ext = fixture();
    expect(() =>
      installBundle(ext, {
        payloadDir: payload(),
        wholeness: {
          sleep: () => {
            writeFileSync(hostPath(ext), `${hostBundleText()}// more`);
          },
        },
      }),
    ).toThrow(/extension update is probably in progress/);
  });
});

describe("restore", () => {
  it("round-trips exactly back to the original bytes and removes webview/rigline/", () => {
    const ext = fixture();
    const original = readFileSync(bundlePath(ext));
    install(ext, { payloadDir: payload() });

    const result = restore(ext);

    expect(result).toEqual({ ext, restored: true });
    expect(readFileSync(bundlePath(ext))).toEqual(original);
    expect(existsSync(payloadOutDir(ext))).toBe(false);
  });

  it("reports the reason rather than throwing when there is no backup", () => {
    const ext = fixture();
    const result = restore(ext);
    expect(result.restored).toBe(false);
    expect(result.reason).toMatch(/index\.js\.orig/);
  });
});

describe("restoreAll", () => {
  it("continues past a failure, restoring every recoverable directory", () => {
    const unrecoverable = fixture();
    const recoverable = fixture();
    const original = readFileSync(bundlePath(recoverable));
    install(recoverable, { payloadDir: payload() });

    const results = restoreAll([unrecoverable, recoverable]);

    expect(results[0]).toMatchObject({ ext: unrecoverable, restored: false });
    expect(results[1]).toMatchObject({ ext: recoverable, restored: true });
    expect(readFileSync(bundlePath(recoverable))).toEqual(original);
  });
});

describe("verdict", () => {
  it("is unknown with no backup, patched after install, vanilla after restore", () => {
    const ext = fixture();
    expect(verdict(inspect(ext))).toBe("unknown");

    install(ext, { payloadDir: payload() });
    expect(verdict(inspect(ext))).toBe("patched");

    restore(ext);
    expect(verdict(inspect(ext))).toBe("vanilla");
  });

  it("still reads as patched when the marker comment itself is gone", () => {
    const ext = fixture();
    install(ext, { payloadDir: payload() });

    const withoutMarker = readFileSync(bundlePath(ext))
      .toString("latin1")
      .replace("/*RIGLINE-PRE*/", "");
    writeFileSync(bundlePath(ext), Buffer.from(withoutMarker, "latin1"));

    expect(verdict(inspect(ext))).toBe("patched");
  });
});

describe("a foreign or outdated patch already on the bundle", () => {
  it("rolls a wrapper this loader does not recognise back to a single clean loader", () => {
    const ext = fixture();
    const pristine = readFileSync(bundlePath(ext));
    writeFileSync(backupPath(ext), pristine);
    const foreign = Buffer.concat([
      Buffer.from('import"./ccx/pre.js";/*CCX-PRE*/\n', "latin1"),
      pristine,
      Buffer.from('\n/*CCX-POST*/import("./ccx/post.js");\n', "latin1"),
    ]);
    writeFileSync(bundlePath(ext), foreign);

    install(ext, { payloadDir: payload() });

    const live = readFileSync(bundlePath(ext));
    expect(live.length - pristine.length).toBe(PATCH_BYTES);
    expect(live.toString("latin1")).not.toContain("CCX");
    expect(live).toEqual(
      Buffer.concat([Buffer.from(PRE_LINE, "utf8"), pristine, Buffer.from(POST_LINE, "utf8")]),
    );
  });

  it("rewrites a backup that shares no relation with the live bundle", () => {
    const ext = fixture();
    const currentPristine = readFileSync(bundlePath(ext));
    writeFileSync(backupPath(ext), Buffer.from("bytes from an entirely different build", "latin1"));

    install(ext, { payloadDir: payload() });

    expect(readFileSync(backupPath(ext))).toEqual(currentPristine);
    const live = readFileSync(bundlePath(ext));
    expect(live.length - currentPristine.length).toBe(PATCH_BYTES);
  });
});

describe("plugins", () => {
  it("tolerates a missing plugins root entirely, producing an empty registry", () => {
    const ext = fixture();
    const report = install(ext, {
      payloadDir: payload(),
      plugins: withPlugins([join(tempDir("rigline-empty-"), "does-not-exist")]),
    });

    expect(report.enabled).toEqual([]);
    expect(readFileSync(join(payloadOutDir(ext), "registry.js"), "utf8")).toMatch(
      /export const plugins = \[\s*\];/,
    );
  });

  it("bakes discovered plugins into the registry and moves `last` names to the end", () => {
    const ext = fixture();
    const root = tempDir("rigline-plugins-");
    writePlugin(root, "zeta");
    writePlugin(root, "probe");

    const report = install(ext, {
      payloadDir: payload(),
      plugins: withPlugins([root], { last: ["probe"] }),
    });

    expect(report.enabled).toEqual(["zeta", "probe"]);
    const registry = readFileSync(join(payloadOutDir(ext), "registry.js"), "utf8");
    expect(registry.indexOf('"name":"zeta"')).toBeLessThan(registry.indexOf('"name":"probe"'));
  });

  it("excludes a plugin's own test files from the copy", () => {
    const ext = fixture();
    const root = tempDir("rigline-plugins-");
    const dir = writePlugin(root, "sample");
    writeFileSync(join(dir, "index.test.js"), "should not ship");

    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });

    const copied = join(payloadOutDir(ext), "plugins", "sample");
    expect(existsSync(join(copied, "index.js"))).toBe(true);
    expect(existsSync(join(copied, "index.test.js"))).toBe(false);
  });

  it("removes a disabled plugin's copy on the next install", () => {
    const ext = fixture();
    const root = tempDir("rigline-plugins-");
    writePlugin(root, "sample");
    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });
    expect(existsSync(join(payloadOutDir(ext), "plugins", "sample"))).toBe(true);

    install(ext, {
      payloadDir: payload(),
      plugins: withPlugins([root], { configPath: writeConfig(["sample"]) }),
    });

    expect(existsSync(join(payloadOutDir(ext), "plugins", "sample"))).toBe(false);
  });

  it("drops a plugin's copy once its directory is deleted from disk", () => {
    const ext = fixture();
    const root = tempDir("rigline-plugins-");
    const dir = writePlugin(root, "sample");
    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });
    expect(existsSync(join(payloadOutDir(ext), "plugins", "sample"))).toBe(true);

    rmSync(dir, { recursive: true, force: true });
    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });

    expect(existsSync(join(payloadOutDir(ext), "plugins", "sample"))).toBe(false);
  });

  it("reports capability-use notes in both directions, only over shipped source", () => {
    const ext = fixture();
    const root = tempDir("rigline-plugins-");
    writePlugin(
      root,
      "agrees",
      { uses: { session: true } },
      "export default { setup(ctx) { ctx.onSessionId(() => {}); } };\n",
    );
    const mismatched = writePlugin(root, "mismatched", {}, "ctx.onToolUse(() => {});\n");
    writeFileSync(join(mismatched, "index.test.js"), "ctx.decorateTranscript(() => {});\n");

    const report = install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });

    expect(report.notes).toContain(
      'mismatched: calls onToolUse/onToolResult() without declaring "tools": it will throw and disable the plugin',
    );
    expect(report.notes.some((n) => n.includes("agrees"))).toBe(false);
    expect(report.notes.some((n) => n.includes("transcript"))).toBe(false);
  });

  it("notes a field two plugins both rewrite, in registry order", () => {
    const ext = fixture();
    const root = tempDir("rigline-plugins-");
    writePlugin(root, "first", { uses: { rewrites: { req_0: ["field_0"] } } });
    writePlugin(root, "second", { uses: { rewrites: { req_0: ["field_0"] } } });

    const report = install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });

    expect(report.notes).toContain("req_0.field_0 is rewritten by first, then second");
  });
});

describe("host patches", () => {
  function patchPlugin(
    root: string,
    name: string,
    options: { readonly required?: boolean; readonly find?: string } = {},
  ): string {
    const find = options.find ?? HOST_ANCHOR;
    // Equal byte length is required at manifest-read time; a placeholder replace of the same
    // length as an anchor that will never be found is never actually written anywhere.
    const replace = options.find ? "X".repeat(find.length) : PATCHED_ANCHOR;
    return writePlugin(root, name, {
      patches: [
        {
          find,
          replace,
          why: "steers the worktree list",
          required: options.required ?? false,
        },
      ],
    });
  }

  it("applies a declared patch without resizing the host bundle, keeping the pristine backup", () => {
    const ext = fixture();
    const originalHost = readFileSync(hostPath(ext));
    const root = tempDir("rigline-plugins-");
    patchPlugin(root, "worktree-toggle");

    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });

    const patchedHost = readFileSync(hostPath(ext));
    expect(patchedHost.length).toBe(originalHost.length);
    expect(patchedHost.toString("utf8")).toContain(PATCHED_ANCHOR);
    expect(readFileSync(hostBackupPath(ext))).toEqual(originalHost);
  });

  it("creates no backup and touches nothing when no plugin declares a patch", () => {
    const ext = fixture();
    const originalHost = readFileSync(hostPath(ext));
    const root = tempDir("rigline-plugins-");
    writePlugin(root, "no-patches");

    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });

    expect(existsSync(hostBackupPath(ext))).toBe(false);
    expect(readFileSync(hostPath(ext))).toEqual(originalHost);
  });

  it("does not rewrite extension.js when the patch set is unchanged", () => {
    const ext = fixture();
    const root = tempDir("rigline-plugins-");
    patchPlugin(root, "worktree-toggle");
    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });
    const past = new Date(2000, 0, 1);
    utimesSync(hostPath(ext), past, past);

    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });

    expect(statSync(hostPath(ext)).mtime.getTime()).toBe(past.getTime());
  });

  it("puts the host bytes back when the plugin declaring the patch is disabled", () => {
    const ext = fixture();
    const originalHost = readFileSync(hostPath(ext));
    const root = tempDir("rigline-plugins-");
    patchPlugin(root, "worktree-toggle");
    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });

    install(ext, {
      payloadDir: payload(),
      plugins: withPlugins([root], { configPath: writeConfig(["worktree-toggle"]) }),
    });

    expect(readFileSync(hostPath(ext))).toEqual(originalHost);
  });

  it("applies the patch exactly once across three installs", () => {
    const ext = fixture();
    const originalHost = readFileSync(hostPath(ext));
    const root = tempDir("rigline-plugins-");
    patchPlugin(root, "worktree-toggle");

    for (let i = 0; i < 3; i++) {
      install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });
    }

    const finalHost = readFileSync(hostPath(ext));
    expect(finalHost.length).toBe(originalHost.length);
    expect(finalHost.toString("utf8").split(PATCHED_ANCHOR).length - 1).toBe(1);
  });

  it("reverts the host bundle on restore", () => {
    const ext = fixture();
    const originalHost = readFileSync(hostPath(ext));
    const root = tempDir("rigline-plugins-");
    patchPlugin(root, "worktree-toggle");
    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });

    restore(ext);

    expect(readFileSync(hostPath(ext))).toEqual(originalHost);
    expect(hostVerdict(inspect(ext))).toBe("vanilla");
  });

  it("reports a host bundle it could not write back, rather than claiming a clean restore", () => {
    const ext = fixture();
    const root = tempDir("rigline-plugins-");
    patchPlugin(root, "worktree-toggle");
    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });
    // Stands in for the platform refusing the write — on Windows, an extension host still holding
    // extension.js open. What matters is that restore answers rather than throwing.
    rmSync(hostPath(ext));
    mkdirSync(hostPath(ext));

    const result = restore(ext);

    // The panel is back, and the extension host is not: two outcomes, reported apart.
    expect(result.restored).toBe(true);
    expect(result.hostReason).toMatch(/could not write/);
  });

  it("says nothing about the host bundle when nothing ever patched it", () => {
    const ext = fixture();
    install(ext, { payloadDir: payload() });

    expect(restore(ext).hostReason).toBeUndefined();
  });

  it("recovers the host bundle even when the webview backup is gone", () => {
    const ext = fixture();
    const originalHost = readFileSync(hostPath(ext));
    const root = tempDir("rigline-plugins-");
    patchPlugin(root, "worktree-toggle");
    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });
    rmSync(backupPath(ext));

    const result = restore(ext);

    expect(result.restored).toBe(false);
    expect(readFileSync(hostPath(ext))).toEqual(originalHost);
  });

  it("leaves an optional patch's plugin loadable when its anchor cannot apply", () => {
    const ext = fixture();
    const originalHost = readFileSync(hostPath(ext));
    const root = tempDir("rigline-plugins-");
    patchPlugin(root, "hopeful", { find: "[NOWHERE TO BE FOUND]", required: false });

    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });

    const registry = readFileSync(join(payloadOutDir(ext), "registry.js"), "utf8");
    expect(registry).toContain('"patchRefusal":null');
    expect(readFileSync(hostPath(ext))).toEqual(originalHost);
  });

  it("records a refusal when a required patch's anchor cannot apply", () => {
    const ext = fixture();
    const root = tempDir("rigline-plugins-");
    patchPlugin(root, "essential", { find: "[NOWHERE TO BE FOUND]", required: true });

    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });

    const registry = readFileSync(join(payloadOutDir(ext), "registry.js"), "utf8");
    expect(registry).toContain(
      '"patchRefusal":"required host patch did not apply: anchor not found in the host bundle"',
    );
  });

  it("rewrites a stale host backup left over from a different build, then applies correctly", () => {
    const ext = fixture();
    const originalHost = readFileSync(hostPath(ext));
    writeFileSync(hostBackupPath(ext), Buffer.from("a stale backup, shorter", "utf8"));
    const root = tempDir("rigline-plugins-");
    patchPlugin(root, "worktree-toggle");

    install(ext, { payloadDir: payload(), plugins: withPlugins([root]) });

    expect(readFileSync(hostBackupPath(ext))).toEqual(originalHost);
    expect(readFileSync(hostPath(ext)).toString("utf8")).toContain(PATCHED_ANCHOR);
  });
});
