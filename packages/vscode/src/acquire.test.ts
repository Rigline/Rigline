/**
 * The acquisition sequence, with no VS Code and no processes.
 *
 * What these hold is the part 8a's live read cannot: that every failure is a *result* rather than a
 * rejected promise, because a throw out of an activation handler is invisible to the user and so is
 * precisely the silent failure this milestone exists to remove (P8).
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AcquireOptions, acquireAndInject, LABEL } from "./acquire.ts";
import type { Editor, Health } from "./editor.ts";

// Absolute on whichever platform runs this. A Windows path is merely relative on Linux, and
// `findNode` drops a relative PATH entry by design — so Windows paths here assert nothing in CI.
const abs = (...parts: string[]) => join(process.platform === "win32" ? "C:\\" : "/", ...parts);

const NODE_DIR = abs("Program Files", "nodejs");
const NODE = join(NODE_DIR, process.platform === "win32" ? "node.exe" : "node");

function editor(setting?: string) {
  const statuses: { health: Health; text: string }[] = [];
  const lines: string[] = [];
  const it: Editor = {
    setting: () => setting,
    extensionPath: () => undefined,
    onExtensionsChanged: () => ({ dispose() {} }),
    status: (health, text) => {
      statuses.push({ health, text });
    },
    log: (line) => {
      lines.push(line);
    },
    ask: async () => undefined,
  };
  return { editor: it, statuses, lines };
}

function acquisition(over: Partial<AcquireOptions["acquisition"]> = {}) {
  const calls: string[][] = [];
  const base: AcquireOptions["acquisition"] = {
    updateEngine: async () => ({ outcome: "current" }),
    ensureEngine: async () => ({
      version: "1.0.0-alpha.7",
      run: async (argv) => {
        calls.push([...argv]);
        return 0;
      },
    }),
    ...over,
  };
  return { acquisition: base, calls };
}

describe("acquireAndInject", () => {
  it("finds a Node, updates, injects, and ends green", async () => {
    const e = editor();
    const a = acquisition();
    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      version: "1.0.0-alpha.6",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result).toEqual({ kind: "injected", engine: "1.0.0-alpha.7" });
    expect(a.calls).toEqual([["install"]]);
    expect(e.statuses.at(-1)).toEqual({ health: "ok", text: "Rigline" });
  });

  it("hands the wrapper the Node it found and the companion's lock label (D80)", async () => {
    const e = editor();
    const seen: { nodePath: string; label: string }[] = [];
    const a = acquisition({
      updateEngine: async (options) => {
        seen.push(options);
        return { outcome: "current" };
      },
      ensureEngine: async (options) => {
        seen.push(options);
        return { version: "1.0.0-alpha.7", run: async () => 0 };
      },
    });

    await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      version: "1.0.0-alpha.6",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    // The version travels with them, and that is not cosmetic. The wrapper's own default reads
    // `../package.json` beside its module, which bundling rewrites to the extensions directory —
    // so a companion that let it default would throw ENOENT on the first run of every install.
    expect(seen).toEqual([
      { nodePath: NODE, label: LABEL, version: "1.0.0-alpha.6" },
      { nodePath: NODE, label: LABEL, version: "1.0.0-alpha.6" },
    ]);
  });

  it("answers rather than throwing when there is no Node, and says how to repair it", async () => {
    const e = editor();
    const a = acquisition();
    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      version: "1.0.0-alpha.6",
      exists: () => false,
      env: { PATH: abs("nothing") },
    });

    expect(result.kind).toBe("no-node");
    expect(e.statuses.at(-1)?.health).toBe("attention");
    expect(a.calls).toEqual([]);
  });

  it("carries on with the engine it has when the update was refused (D80)", async () => {
    // What a contended lock looks like from here: `update` reports rather than throws, and giving
    // up would mean one user's terminal command costs the other window its injection.
    const e = editor();
    const a = acquisition({
      updateEngine: async () => ({
        outcome: "failed",
        reason: "rigline update (pid 4) has been working under Rigline's home",
      }),
    });

    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      version: "1.0.0-alpha.6",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result).toEqual({ kind: "injected", engine: "1.0.0-alpha.7" });
    expect(a.calls).toEqual([["install"]]);
    expect(e.lines.join("\n")).toMatch(/pid 4/);
  });

  it("reports a non-zero install rather than claiming success", async () => {
    const e = editor();
    const a = acquisition({
      ensureEngine: async () => ({ version: "1.0.0-alpha.7", run: async () => 1 }),
    });

    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      version: "1.0.0-alpha.6",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result.kind).toBe("failed");
    expect(e.statuses.at(-1)?.health).toBe("attention");
  });

  it("turns a throw from the wrapper into a result, because activation swallows a rejection", async () => {
    const e = editor();
    const a = acquisition({
      ensureEngine: async () => {
        throw new Error("npm exited 1");
      },
    });

    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      version: "1.0.0-alpha.6",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result).toEqual({ kind: "failed", message: "npm exited 1" });
    expect(e.statuses.at(-1)?.health).toBe("attention");
  });

  it("takes the setting over PATH, which is the macOS repair", async () => {
    const chosen = abs("opt", "homebrew", "bin", "node");
    const e = editor(chosen);
    const a = acquisition();
    await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      version: "1.0.0-alpha.6",
      exists: (p) => p === chosen,
      env: {},
    });
    expect(e.lines[0]).toContain(chosen);
  });
});
