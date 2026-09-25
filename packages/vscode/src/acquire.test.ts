/**
 * The acquisition sequence, with no VS Code and no processes.
 *
 * What these hold is the part 8a's live read cannot: that every failure is a *result* rather than a
 * rejected promise, because a throw out of an activation handler is invisible to the user and so is
 * precisely the silent failure this milestone exists to remove (P8).
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stubEditor } from "../test/editor.ts";
import {
  type AcquireOptions,
  acquireAndInject,
  LABEL,
  marked,
  saveLayout,
  showPlugins,
} from "./acquire.ts";
import type { Stamps } from "./watch.ts";

// Absolute on whichever platform runs this. A Windows path is merely relative on Linux, and
// `findNode` drops a relative PATH entry by design — so Windows paths here assert nothing in CI.
const abs = (...parts: string[]) => join(process.platform === "win32" ? "C:\\" : "/", ...parts);

const NODE_DIR = abs("Program Files", "nodejs");
const NODE = join(NODE_DIR, process.platform === "win32" ? "node.exe" : "node");

const CLAUDE_DIR = abs("ext", "anthropic.claude-code-2.1.278");

/** Claude Code present by default: the tests below are about acquisition, not about its absence. */
function editor(settings: Record<string, string> = {}, claudeCode: string | null = CLAUDE_DIR) {
  return stubEditor({
    setting: (key) => settings[key],
    extensionPath: () => claudeCode ?? undefined,
  });
}

const STEADY: Stamps = { bundle: "100:1", host: "200:1", manifest: "10:1" };

/**
 * A run that wants no reload: this host started over a directory the install did not have to
 * change. Spread into every case below that is about acquisition rather than about the offer.
 */
const QUIET = {
  reason: { kind: "start", path: CLAUDE_DIR } as const,
  stamps: () => STEADY,
};

/** Spread where a case builds its own options rather than taking `QUIET` whole. */
const runner = (a: ReturnType<typeof acquisition>) => ({ runEngine: a.runEngine });

const ENTRY = abs("home", ".rigline", "engine", "bin.js");

/**
 * The wrapper's half, and the runner beside it.
 *
 * `runEngine` is separate from the acquisition because the companion pipes the engine's output
 * into its own channel rather than inheriting stdio, which is what makes the report readable when
 * the engine wants a person.
 */
function acquisition(
  over: Partial<AcquireOptions["acquisition"]> = {},
  run: { code?: number; lines?: readonly string[]; onRun?: () => void } = {},
) {
  const calls: string[][] = [];
  const entries: string[] = [];
  const acquiring: string[] = [];
  const base: AcquireOptions["acquisition"] = {
    updateEngine: async () => {
      acquiring.push("update");
      return { outcome: "current" };
    },
    ensureEngine: async () => {
      acquiring.push("ensure");
      return { version: "1.0.0-alpha.7", entry: ENTRY };
    },
    ...over,
  };
  const runEngine: AcquireOptions["runEngine"] = async (_node, entry, argv, onLine) => {
    calls.push([...argv]);
    entries.push(entry);
    run.onRun?.();
    for (const line of run.lines ?? []) onLine(line);
    return run.code ?? 0;
  };
  return { acquisition: base, calls, entries, acquiring, runEngine };
}

describe("acquireAndInject", () => {
  it("finds a Node, updates, injects, and ends green", async () => {
    const e = editor();
    const a = acquisition();
    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      ...runner(a),
      ...QUIET,
      version: "1.0.0-alpha.6",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result).toEqual({
      kind: "injected",
      engine: "1.0.0-alpha.7",
      reload: null,
      runner: { nodePath: NODE, entry: ENTRY },
    });
    expect(a.acquiring).toEqual(["update", "ensure"]);
    expect(a.calls).toEqual([["install"]]);
    expect(e.statuses.at(-1)).toMatchObject({ health: "ok", text: "Rigline" });
  });

  it("wants a person when the wrapper refuses a new major, not green on the old engine (D99)", async () => {
    const e = editor();
    const a = acquisition({
      updateEngine: async () => ({
        outcome: "failed",
        to: "2.0.0",
        reason: "rigline 1.x cannot run engine 2.x",
      }),
    });
    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      ...runner(a),
      ...QUIET,
      version: "1.0.0-alpha.12",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result.kind).toBe("attention");
    expect(e.statuses.at(-1)).toMatchObject({ health: "attention", text: "Rigline: needs you" });
    expect(e.statuses.at(-1)?.tooltip).toContain("rigline vscode-setup");
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
        return { version: "1.0.0-alpha.7", entry: ENTRY };
      },
    });

    await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      ...runner(a),
      ...QUIET,
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
      ...runner(a),
      ...QUIET,
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
      ...runner(a),
      ...QUIET,
      version: "1.0.0-alpha.6",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result).toMatchObject({ kind: "injected", engine: "1.0.0-alpha.7", reload: null });
    expect(a.calls).toEqual([["install"]]);
    expect(e.lines.join("\n")).toMatch(/pid 4/);
  });

  it("reports a non-zero install rather than claiming success", async () => {
    const e = editor();
    const a = acquisition({}, { code: 1 });

    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      ...runner(a),
      ...QUIET,
      version: "1.0.0-alpha.6",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result.kind).toBe("attention");
    expect(e.statuses.at(-1)?.health).toBe("attention");
  });

  // The engine exits non-zero whenever somebody is wanted, which is not the same as having done
  // nothing — and reading the code alone meant the one case the window-reload offer exists for was
  // the one case that could never reach it.
  it("still works out the reload when the engine wants a person", async () => {
    const seen = stubEditor({
      extensionPath: () => CLAUDE_DIR,
      extensionActive: () => true,
    });
    let after = false;
    const a = acquisition(
      {},
      {
        code: 1,
        onRun: () => {
          after = true;
        },
      },
    );

    const result = await acquireAndInject({
      editor: seen.editor,
      acquisition: a.acquisition,
      ...runner(a),
      reason: { kind: "start", path: CLAUDE_DIR },
      stamps: () => (after ? { ...STEADY, host: "200:2" } : STEADY),
      version: "1.0.0-alpha.9",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result).toMatchObject({ kind: "attention", reload: "window" });
    // The person outranks the prompt: the status says who is wanted, not what to reload.
    expect(seen.statuses.at(-1)?.health).toBe("attention");
  });

  // The bug this exists for: the engine ran with inherited stdio, which in the extension host is a
  // stream VS Code keeps no log of. Every word it said was dropped — including on the runs where
  // the status bar then told somebody to go and read it (P8).
  it("puts every line the engine wrote into the output channel", async () => {
    const e = editor();
    const a = acquisition(
      {},
      { code: 1, lines: ["2.1.278: refreshed", "Needs you:", "  - a moved anchor"] },
    );

    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      ...runner(a),
      ...QUIET,
      version: "1.0.0-alpha.9",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(e.lines).toContain("Needs you:");
    expect(e.lines).toContain("  - a moved anchor");
    expect(result.kind).toBe("attention");
  });

  it("offers nothing when the engine refused and moved nothing", async () => {
    const seen = stubEditor({
      extensionPath: () => CLAUDE_DIR,
      extensionActive: () => true,
    });
    const a = acquisition({}, { code: 1 });

    const result = await acquireAndInject({
      editor: seen.editor,
      acquisition: a.acquisition,
      ...runner(a),
      reason: { kind: "start", path: CLAUDE_DIR },
      stamps: () => STEADY,
      version: "1.0.0-alpha.9",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result).toMatchObject({ kind: "attention", reload: null });
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
      ...runner(a),
      ...QUIET,
      version: "1.0.0-alpha.6",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result).toEqual({ kind: "failed", message: "npm exited 1" });
    expect(e.statuses.at(-1)?.health).toBe("attention");
  });

  it("takes the setting over PATH, which is the macOS repair", async () => {
    const chosen = abs("opt", "homebrew", "bin", "node");
    const e = editor({ nodePath: chosen });
    const a = acquisition();
    await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      ...runner(a),
      ...QUIET,
      version: "1.0.0-alpha.6",
      exists: (p) => p === chosen,
      env: {},
    });
    expect(e.lines[0]).toContain(chosen);
  });

  it("does not report success when there is nothing to inject into", async () => {
    // Leo's laptop: `vscode-setup` run before Claude Code was installed. The engine's `install`
    // exits 0 having done nothing, so reading the exit code alone painted a green badge over an
    // absent feature — and a green badge that means nothing is the failure P8 exists against.
    const e = editor({}, null);
    const a = acquisition();
    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      ...runner(a),
      ...QUIET,
      version: "1.0.0-alpha.8",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result).toMatchObject({ kind: "waiting", engine: "1.0.0-alpha.7" });
    expect(e.statuses.at(-1)).toMatchObject({ health: "idle", text: "Rigline: no Claude Code" });
  });

  it("notices that the install moved the bundle under a live extension (D82)", async () => {
    const e = editor();
    // Active, and the bundle grew across the run: the panel in front of the user is unpatched.
    const moved = stubEditor({
      extensionPath: () => CLAUDE_DIR,
      extensionActive: () => true,
      log: e.editor.log,
    });
    let after = false;
    const a = acquisition(
      {},
      {
        onRun: () => {
          after = true;
        },
      },
    );

    const result = await acquireAndInject({
      editor: moved.editor,
      acquisition: a.acquisition,
      ...runner(a),
      reason: { kind: "start", path: CLAUDE_DIR },
      stamps: () => (after ? { ...STEADY, bundle: "140:2" } : STEADY),
      version: "1.0.0-alpha.9",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result).toMatchObject({ kind: "injected", engine: "1.0.0-alpha.7", reload: "webviews" });
  });

  it("says nothing about a reload after a move, whatever the install changed", async () => {
    const e = editor();
    let after = false;
    const a = acquisition(
      {},
      {
        onRun: () => {
          after = true;
        },
      },
    );

    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      ...runner(a),
      reason: { kind: "moved", arriving: [CLAUDE_DIR] },
      stamps: () => (after ? { ...STEADY, bundle: "140:2", host: "200:2" } : STEADY),
      version: "1.0.0-alpha.9",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result).toMatchObject({ kind: "injected", engine: "1.0.0-alpha.7", reload: null });
  });

  it("marks a version newly patched in the background as ready, not plain ok", async () => {
    const e = editor();
    const a = acquisition();

    await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      ...runner(a),
      reason: { kind: "moved", arriving: [CLAUDE_DIR] },
      stamps: () => STEADY,
      version: "1.0.0-alpha.9",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(e.statuses.at(-1)).toMatchObject({ health: "ready", text: "Rigline: ready to restart" });
  });
});

describe("an engine named by rigline.enginePath (D94)", () => {
  const DEV_ENTRY = abs("dev", "rigline", "packages", "core", "dist", "engine", "bin.js");
  const withDev = (p: string) => p === NODE || p === DEV_ENTRY;

  it("spawns the entry it names, and never reaches acquisition", async () => {
    const e = editor({ enginePath: DEV_ENTRY });
    const a = acquisition();
    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      ...runner(a),
      ...QUIET,
      version: "1.0.0-alpha.10",
      exists: withDev,
      env: { PATH: NODE_DIR },
    });

    expect(result).toMatchObject({ kind: "injected", engine: DEV_ENTRY, reload: null });
    expect(a.acquiring).toEqual([]);
    expect(a.entries).toEqual([DEV_ENTRY]);
    expect(e.lines.join("\n")).toContain(`engine: ${DEV_ENTRY}`);
  });

  it("fails naming the setting when the entry is not there, and runs nothing else", async () => {
    const e = editor({ enginePath: DEV_ENTRY });
    const a = acquisition();
    const result = await acquireAndInject({
      editor: e.editor,
      acquisition: a.acquisition,
      ...runner(a),
      ...QUIET,
      version: "1.0.0-alpha.10",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(result).toMatchObject({
      kind: "failed",
      message: expect.stringContaining("rigline.enginePath"),
    });
    expect(a.acquiring).toEqual([]);
    expect(a.calls).toEqual([]);
    expect(e.statuses.at(-1)?.health).toBe("attention");
  });

  it("runs Show Plugins and a Save through it too", async () => {
    const e = editor({ enginePath: DEV_ENTRY });
    const a = acquisition();
    const common = {
      editor: e.editor,
      ensureEngine: a.acquisition.ensureEngine,
      runEngine: a.runEngine,
      version: "1.0.0-alpha.10",
      exists: withDev,
      env: { PATH: NODE_DIR },
    };
    await showPlugins(common);
    await saveLayout({ ...common, payload: "eyJ2IjoxfQ" });

    expect(a.acquiring).toEqual([]);
    expect(a.entries).toEqual([DEV_ENTRY, DEV_ENTRY]);
  });

  it("marks a status line while it is set, and leaves one alone otherwise", () => {
    expect(marked("Rigline", "Injected", DEV_ENTRY)).toEqual({
      text: "Rigline (dev)",
      tooltip: `Injected\n\nEngine: ${DEV_ENTRY}, from \`rigline.enginePath\``,
    });
    expect(marked("Rigline: needs you", "Read the output", undefined)).toEqual({
      text: "Rigline: needs you",
      tooltip: "Read the output",
    });
  });
});

describe("showPlugins", () => {
  it("finds a Node, resolves the engine, and pipes list into the output channel", async () => {
    const e = editor();
    const a = acquisition(
      {},
      { lines: ["session-id — this checkout", "time-marks — this checkout"] },
    );

    await showPlugins({
      editor: e.editor,
      ensureEngine: a.acquisition.ensureEngine,
      runEngine: a.runEngine,
      version: "1.0.0-alpha.6",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(a.calls).toEqual([["list"]]);
    expect(e.lines).toContain("session-id — this checkout");
    expect(e.lines).toContain("time-marks — this checkout");
    // A one-off command's own failure is not the watcher's health.
    expect(e.statuses).toEqual([]);
  });

  it("never reaches ensureEngine or spawns anything when there is no Node", async () => {
    const e = editor();
    const a = acquisition();

    await showPlugins({
      editor: e.editor,
      ensureEngine: a.acquisition.ensureEngine,
      runEngine: a.runEngine,
      version: "1.0.0-alpha.6",
      exists: () => false,
      env: { PATH: abs("nothing") },
    });

    expect(a.calls).toEqual([]);
    expect(e.asked).toHaveLength(1);
    expect(e.asked[0]).toMatchObject({ level: "warn" });
  });

  it("answers rather than throwing when the engine cannot be resolved", async () => {
    const e = editor();
    const a = acquisition({
      ensureEngine: async () => {
        throw new Error("the engine in ~/.rigline/engine is 1.0.0-alpha.5 and refuses");
      },
    });

    await showPlugins({
      editor: e.editor,
      ensureEngine: a.acquisition.ensureEngine,
      runEngine: a.runEngine,
      version: "1.0.0-alpha.6",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(a.calls).toEqual([]);
    expect(e.lines).toContain("the engine in ~/.rigline/engine is 1.0.0-alpha.5 and refuses");
    expect(e.asked).toHaveLength(1);
  });

  it("never calls updateEngine: a viewing command has no business reaching npm", async () => {
    const e = editor();
    let updateCalled = false;
    const a = acquisition({
      updateEngine: async () => {
        updateCalled = true;
        return { outcome: "current" };
      },
    });

    await showPlugins({
      editor: e.editor,
      ensureEngine: a.acquisition.ensureEngine,
      runEngine: a.runEngine,
      version: "1.0.0-alpha.6",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
    });

    expect(updateCalled).toBe(false);
  });
});

describe("saveLayout", () => {
  const PAYLOAD = "eyJ2IjoxfQ";

  async function save(lines: readonly string[], code = 0) {
    const e = editor();
    const a = acquisition({}, { lines, code });
    await saveLayout({
      editor: e.editor,
      ensureEngine: a.acquisition.ensureEngine,
      runEngine: a.runEngine,
      version: "1.0.0-alpha.11",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
      payload: PAYLOAD,
    });
    return { e, a };
  }

  it("hands the engine the payload unread and says the outcome it printed first", async () => {
    const { e, a } = await save([
      "saved the panel's layout to /home/.rigline/config.yaml",
      "",
      "2.1.280: refreshed",
    ]);
    expect(a.calls).toEqual([["layout", "save", PAYLOAD]]);
    expect(e.asked).toEqual([
      {
        level: "info",
        message: "Saved the panel's layout to /home/.rigline/config.yaml",
        actions: [],
      },
    ]);
    expect(e.lines).toContain("2.1.280: refreshed");
  });

  it("warns when the save overwrote a change, even though the install after it wants a person", async () => {
    const { e } = await save(
      ["saved the panel's layout to /c.yaml, over a change made since the panel loaded"],
      1,
    );
    expect(e.asked[0]).toMatchObject({
      level: "warn",
      message: expect.stringContaining("over a change"),
    });
  });

  it("finishes while its notification is still unanswered, so the next save is not held up", async () => {
    const a = acquisition({}, { lines: ["saved the panel's layout to /c.yaml"], code: 0 });
    const e = stubEditor({ ask: () => new Promise(() => {}) });
    let finished = false;
    const saving = saveLayout({
      editor: e.editor,
      ensureEngine: a.acquisition.ensureEngine,
      runEngine: a.runEngine,
      version: "1.0.0-alpha.11",
      exists: (p) => p === NODE,
      env: { PATH: NODE_DIR },
      payload: PAYLOAD,
    }).then(() => {
      finished = true;
    });
    await Promise.race([saving, new Promise((r) => setTimeout(r, 200))]);
    expect(finished).toBe(true);
  });

  it("warns with the engine's reason when it refuses", async () => {
    const { e } = await save(
      ["rigline: not saved: the Save link's token is not this machine's; reload the panel"],
      1,
    );
    expect(e.asked).toEqual([
      {
        level: "warn",
        message:
          "The layout was not saved: the Save link's token is not this machine's; reload the panel",
        actions: [],
      },
    ]);
  });

  it("never spawns anything without a Node, and never updates the engine", async () => {
    const e = editor();
    let updateCalled = false;
    const a = acquisition({
      updateEngine: async () => {
        updateCalled = true;
        return { outcome: "current" };
      },
    });
    await saveLayout({
      editor: e.editor,
      ensureEngine: a.acquisition.ensureEngine,
      runEngine: a.runEngine,
      version: "1.0.0-alpha.11",
      exists: () => false,
      env: { PATH: abs("nothing") },
      payload: PAYLOAD,
    });
    expect(a.calls).toEqual([]);
    expect(updateCalled).toBe(false);
    expect(e.asked[0]).toMatchObject({ level: "warn" });
  });
});
