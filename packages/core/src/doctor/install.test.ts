/**
 * Install state, against disposable extension directories only (D39).
 *
 * The registry test round trips through `bakeRegistry` itself rather than against a pasted sample:
 * the parser exists only to read what the baker writes, and a fixture would let the two drift apart
 * while both tests went on passing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writePayload } from "../../test/fixtures.ts";
import type { PatchOutcome } from "../inject/hostpatch.ts";
import { bakeRegistry, discoverPlugins } from "../plugins/discover.ts";
import { CORE_VERSION } from "../version.ts";
import { installState, parseRegistry } from "./install.ts";

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A plugin root holding one plugin, so `bakeRegistry` gets a real manifest to bake. */
function pluginRoot(name: string): string {
  const root = tempDir("rigline-doctor-plugins-");
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "rigline.json"),
    JSON.stringify({ api: 1, name, entry: "index.js", surfaces: ["sidebar"], uses: {} }),
  );
  writeFileSync(join(dir, "index.js"), "export default { setup() {} };\n");
  return root;
}

describe("parseRegistry", () => {
  it("reads back what bakeRegistry wrote, including a refused host patch", () => {
    const plugins = discoverPlugins([pluginRoot("worktree")]);
    const outcomes: PatchOutcome[] = [
      {
        plugin: "worktree",
        why: "widen the session id; keeps the panel's title honest",
        required: true,
        applied: false,
        reason: "anchor matched twice",
      },
    ];
    const registry = parseRegistry(bakeRegistry(plugins, outcomes));

    expect(registry.problem).toBeNull();
    expect(registry.plugins).toEqual([
      { name: "worktree", surfaces: ["sidebar"], patchRefusal: expect.any(String) },
    ]);
    expect(registry.patches).toEqual(outcomes);
  });

  it("reports a truncated registry rather than throwing", () => {
    const registry = parseRegistry("export const plugins = [\n  {not json},\n];\n");
    expect(registry.plugins).toEqual([]);
    expect(registry.problem).toContain("not valid JSON");
    expect(registry.problem).toContain("no patch list");
  });

  it("survives a file that is not a registry at all", () => {
    const registry = parseRegistry("");
    expect(registry).toEqual({
      engine: null,
      plugins: [],
      patches: [],
      problem: "no plugin list; no patch list",
    });
  });

  it("reads the engine stamp back out of what bakeRegistry wrote", () => {
    expect(parseRegistry(bakeRegistry([], [])).engine).toBe(CORE_VERSION);
  });

  it("reports a payload with no stamp as unstamped rather than as unreadable", () => {
    // A payload injected before D75 existed. It is a fact about its age, never a problem with the
    // registry: `problem` suppresses the plugin list, and an older install still has plugins.
    const registry = parseRegistry("export const plugins = [\n];\nexport const patches = [];\n");
    expect(registry.engine).toBeNull();
    expect(registry.problem).toBeNull();
  });
});

/** A disposable extension directory. `patched` makes the live bundle differ from its backup. */
function extensionDir(options: { readonly patched?: boolean; readonly backup?: boolean } = {}) {
  const ext = tempDir("rigline-doctor-ext-");
  mkdirSync(join(ext, "webview"), { recursive: true });
  writeFileSync(join(ext, "webview", "index.js"), options.patched ? "LOADER;BUNDLE" : "BUNDLE");
  if (options.backup !== false) writeFileSync(join(ext, "webview", "index.js.orig"), "BUNDLE");
  writeFileSync(join(ext, "extension.js"), "HOST");
  writeFileSync(join(ext, "package.json"), JSON.stringify({ version: "2.1.270" }));
  return ext;
}

describe("installState", () => {
  it("judges a patched bundle against its backup, not against the marker (D38)", () => {
    const state = installState(extensionDir({ patched: true }));
    expect(state.version).toBe("2.1.270");
    expect(state.webview).toBe("patched");
    expect(state.markerPresent).toBe(false);
    expect(state.host).toBe("vanilla");
    expect(state.webviewBackup?.size).toBe("BUNDLE".length);
    expect(state.hostBackup).toBeNull();
  });

  it("calls a bundle with no backup unknown, and says the payload is missing nothing", () => {
    const state = installState(extensionDir({ backup: false }));
    expect(state.webview).toBe("unknown");
    expect(state.payload).toEqual([]);
    expect(state.problems).toEqual([]);
  });

  it("reads the payload and the baked registry when one is installed", () => {
    const ext = extensionDir({ patched: true });
    const payload = join(ext, "webview", "rigline");
    mkdirSync(payload, { recursive: true });
    writePayload(payload, "1;", "2;");
    writeFileSync(join(payload, "generated.js"), "3;");
    writeFileSync(
      join(payload, "registry.js"),
      bakeRegistry(discoverPlugins([pluginRoot("probe")]), []),
    );

    const state = installState(ext);
    expect(
      state.payload.map((f) => f.path.slice(payload.length + 1).replaceAll("\\", "/")),
    ).toEqual([
      "pre.js",
      "post.js",
      "runtime/react.js",
      "runtime/jsx-runtime.js",
      "runtime/react-dom.js",
      "generated.js",
      "registry.js",
    ]);
    expect(state.registry.plugins.map((p) => p.name)).toEqual(["probe"]);
    expect(state.problems).toEqual([]);
  });

  it("notes a patched bundle whose payload is not there, and never throws", () => {
    const state = installState(extensionDir({ patched: true }));
    expect(state.problems).toContain("the payload is missing pre.js");
    expect(state.registry.problem).toBe("not installed");
  });

  it("still produces a row for a directory that is not an extension", () => {
    const state = installState(tempDir("rigline-doctor-empty-"));
    expect(state.version).toBeNull();
    expect(state.webview).toBe("unknown");
    expect(state.problems.join(" ")).toContain("package.json");
  });
});
