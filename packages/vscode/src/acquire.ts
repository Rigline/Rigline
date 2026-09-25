/**
 * Getting an engine, from inside the extension host.
 *
 * The companion is a retrieval layer, not an engine (D80): this is the whole of what makes it one.
 * It finds a Node, hands that Node to the wrapper's own acquisition code, and reports — it never
 * harvests, injects or reads a manifest itself.
 *
 * Nothing here imports `vscode`. What it needs from the editor arrives as `Editor`, and what it
 * needs from the world arrives as functions, so the sequence is driven by vitest rather than
 * inferred from a live run.
 */
import { CLAUDE_CODE, type Editor } from "./editor.ts";
import { findNode, NoNodeError } from "./node.ts";
import { type Reload, reloadWanted } from "./reload.ts";
import type { Stamps, WatchReason } from "./watch.ts";

/**
 * The wrapper's half, narrowed to what this file calls. Injected, so a test spawns nothing.
 *
 * `version` is not optional here though it is optional there, and that is the point. The wrapper
 * defaults it by reading `../package.json` beside its own module, which is right for an npm install
 * and wrong inside a VSIX: bundling rewrites that to the extensions directory, where no manifest
 * exists, so the default throws on the first run of every companion. The version the companion
 * should use is the one VS Code already hands it, so it is passed rather than discovered.
 */
export interface Acquisition {
  updateEngine(options: {
    readonly nodePath: string;
    readonly label: string;
    readonly version: string;
  }): Promise<{ readonly outcome: string; readonly to?: string; readonly reason?: string }>;
  ensureEngine(options: {
    readonly nodePath: string;
    readonly label: string;
    readonly version: string;
  }): Promise<{ readonly version: string; readonly entry: string }>;
}

export interface AcquireOptions {
  readonly editor: Editor;
  readonly acquisition: Acquisition;
  readonly exists: (path: string) => boolean;
  /** This extension's own version, from the manifest VS Code read. Never discovered from disk. */
  readonly version: string;
  /** Why this run is happening, which is what decides whether a reload is offered (D82). */
  readonly reason: WatchReason;
  /** The watcher's own sampling, read either side of the install to see what the engine moved. */
  readonly stamps: (path: string | undefined) => Stamps;
  /**
   * Run the engine and hand back every line it wrote, then its exit code.
   *
   * The wrapper's own `run` inherits stdio, which is right for a terminal and wrong here: in the
   * extension host that goes to a stream VS Code keeps no log of, so the engine's whole report —
   * the one thing a person needs when it exits non-zero — was discarded, while the status bar said
   * to go and read it (P8).
   */
  readonly runEngine: (
    nodePath: string,
    entry: string,
    argv: readonly string[],
    onLine: (line: string) => void,
  ) => Promise<number>;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}

/** How this process names itself in the home lock, for whoever is waiting on it (D80). */
export const LABEL = "the Rigline companion extension";

/** An engine entry spawned in place of the acquired one, for developing Rigline (D94). */
export const ENGINE_SETTING = "enginePath";

type Runnable = { readonly version: string; readonly entry: string };

/**
 * The engine `rigline.enginePath` names, or undefined when it is unset. Its path stands where a
 * version would, since nothing here reads its manifest. A path that is not there throws: falling
 * back to the acquired engine is the silent swap D94 removes.
 */
function namedEngine(editor: Editor, exists: (path: string) => boolean): Runnable | undefined {
  const entry = editor.setting(ENGINE_SETTING)?.trim();
  if (entry === undefined) return undefined;
  if (!exists(entry)) {
    throw new Error(
      `\`rigline.${ENGINE_SETTING}\` names ${entry}, which does not exist. Build it, or clear ` +
        "the setting to run the released engine.",
    );
  }
  editor.log(`engine: ${entry}, from \`rigline.${ENGINE_SETTING}\`, which is never updated`);
  return { version: entry, entry };
}

/** A status line as shown: marked while a named engine runs, which otherwise looks released (D94). */
export function marked(
  text: string,
  tooltip: string,
  named: string | undefined,
): { readonly text: string; readonly tooltip: string } {
  if (named === undefined) return { text, tooltip };
  return {
    text: `${text} (dev)`,
    tooltip: `${tooltip}\n\nEngine: ${named}, from \`rigline.${ENGINE_SETTING}\``,
  };
}

export type AcquireResult =
  /** `reload` is what this window needs to show it, which is usually nothing (D82). */
  | { readonly kind: "injected"; readonly engine: string; readonly reload: Reload | null }
  /**
   * The engine wants a person. It may still have injected — a non-zero exit means somebody is
   * needed, not that nothing happened — so this carries a reload too, decided from the bytes.
   */
  | { readonly kind: "attention"; readonly message: string; readonly reload: Reload | null }
  /** The engine ran and had nothing to inject into. Not a failure, and not a success either. */
  | { readonly kind: "waiting"; readonly engine: string }
  | { readonly kind: "no-node"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Bring the engine up to date and re-inject, reporting through the editor as it goes.
 *
 * Never throws. This runs unattended on every extension update, and a rejected promise in an
 * activation handler is a thing the user never sees — which is the silent failure the whole
 * milestone exists to remove (P8). Every exit is a result somebody can read.
 */
export async function acquireAndInject(options: AcquireOptions): Promise<AcquireResult> {
  const { editor, acquisition, exists, version, reason, stamps, runEngine, env, platform } =
    options;

  let nodePath: string;
  try {
    const found = findNode({
      setting: editor.setting("nodePath"),
      exists,
      ...(env === undefined ? {} : { env }),
      ...(platform === undefined ? {} : { platform }),
    });
    nodePath = found.path;
    editor.log(`Node: ${found.path} (found by ${found.source === "setting" ? "setting" : "PATH"})`);
  } catch (error) {
    const message = error instanceof NoNodeError ? error.message : String(error);
    editor.status("attention", "Rigline: no Node", message);
    editor.log(message);
    return { kind: "no-node", message };
  }

  try {
    const engine =
      namedEngine(editor, exists) ??
      (await acquired(editor, acquisition, { nodePath, label: LABEL, version }));
    editor.status("working", "Rigline: injecting", `Running ${engine.version}`);
    const before = stamps(editor.extensionPath(CLAUDE_CODE));
    const code = await runEngine(nodePath, engine.entry, ["install"], (line) => editor.log(line));

    // The exit code cannot tell these apart and the editor can. `install` exits 0 having done
    // nothing when no Claude Code is installed, so reading the code alone paints a green badge over
    // an absent feature — green while nothing works is exactly what P8 forbids.
    const path = editor.extensionPath(CLAUDE_CODE);
    if (path === undefined) {
      editor.status(
        "idle",
        "Rigline: no Claude Code",
        "Rigline is ready, and will inject as soon as the Claude Code extension is installed.",
      );
      editor.log("nothing to inject into: the Claude Code extension is not installed");
      return { kind: "waiting", engine: engine.version };
    }

    // Decided from the bytes and never from the exit code, so it is right against an engine that
    // predates any of this (D82). An engine that refused moved nothing and offers nothing; one
    // that wants a person may still have injected, and that window is still stale.
    const reload = reloadWanted({
      reason: reason.kind,
      before,
      after: stamps(path),
      active: editor.extensionActive(CLAUDE_CODE),
    });
    if (reload !== null) editor.log(`this window loaded Claude Code unpatched: ${reload} reload`);

    if (code !== 0) {
      // Not "install failed": a non-zero exit means somebody is wanted, which a bundled plugin
      // patching `extension.js` used to trigger on every single update having worked perfectly.
      const message = `the engine exited ${code}; what it said is in this output channel, above.`;
      editor.status("attention", "Rigline: needs you", message);
      editor.log(message);
      return { kind: "attention", message, reload };
    }

    // A version patched behind this window must not look like steady state (D85).
    if (reason.kind === "moved") {
      editor.status(
        "ready",
        "Rigline: ready to restart",
        `Injected by engine ${engine.version} into the newly installed Claude Code. This window ` +
          "keeps running the old one until you restart extensions or reload the window.",
      );
    } else {
      editor.status("ok", "Rigline", `Injected by engine ${engine.version}`);
    }
    return { kind: "injected", engine: engine.version, reload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    editor.status("attention", "Rigline: failed", message);
    editor.log(message);
    return { kind: "failed", message };
  }
}

/** The acquired engine, moved first if its tag has. */
async function acquired(
  editor: Editor,
  acquisition: Acquisition,
  options: Parameters<Acquisition["ensureEngine"]>[0],
): Promise<Runnable> {
  editor.status("working", "Rigline: updating", "Checking for a newer Rigline engine");
  const update = await acquisition.updateEngine(options);
  editor.log(`engine: ${update.outcome}${update.to === undefined ? "" : ` ${update.to}`}`);
  if (update.outcome === "failed") {
    // Reported, not thrown, and not fatal: a contended lock lands here, and the right answer is
    // to carry on with the engine already present rather than to give up on this update (D80).
    editor.log(`engine update did not happen: ${update.reason ?? "no reason given"}`);
  }
  return await acquisition.ensureEngine(options);
}

export interface ShowPluginsOptions {
  readonly editor: Editor;
  readonly ensureEngine: Acquisition["ensureEngine"];
  readonly exists: (path: string) => boolean;
  readonly version: string;
  readonly runEngine: AcquireOptions["runEngine"];
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}

/**
 * The palette command: the engine's own `list`, piped into the output channel.
 *
 * Never touches the status item: that line reports the watcher's own health, and a one-off command
 * failing here is a different kind of thing than the background flow needing a person.
 */
export async function showPlugins(options: ShowPluginsOptions): Promise<void> {
  await onDisk(options, ["list"]);
}

export interface SaveLayoutOptions extends ShowPluginsOptions {
  /** A Save link's payload, which the engine checks and the companion never reads (D93). */
  readonly payload: string;
}

/** How the engine prints a problem a person has to fix, which is how a refusal reaches here. */
const ENGINE_PROBLEM = "rigline: ";

/**
 * A Save link from the panel: run `layout save` with its payload, and say how it went in a
 * notification. The engine prints the outcome first; a refusal and a save over a change are
 * warnings, since a person needs to know either (D92). Never awaits a notification: one stands until
 * it is dismissed, and every save after this one waits for this one to finish.
 */
export async function saveLayout(options: SaveLayoutOptions): Promise<void> {
  const lines = await onDisk(options, ["layout", "save", options.payload]);
  if (lines === null) return;
  const outcome = lines.find((line) => line.trim() !== "") ?? "";
  if (outcome === "" || outcome.startsWith(ENGINE_PROBLEM)) {
    const reason = outcome.slice(ENGINE_PROBLEM.length).replace(/^not saved: /, "");
    void options.editor.ask(
      "warn",
      `The layout was not saved: ${reason || "the engine said nothing; the Rigline output has the rest"}`,
    );
    return;
  }
  const sentence = outcome.charAt(0).toUpperCase() + outcome.slice(1);
  void options.editor.ask(outcome.includes("over a change") ? "warn" : "info", sentence);
}

/**
 * Finds a Node and the engine already on disk and runs `argv` with it, for a one-off command. No
 * `updateEngine`: a command a person gave has no business reaching npm for a newer engine, and
 * `ensureEngine` alone is a local read when one is on disk (8c). Every failure is said in a
 * notification rather than thrown. The lines the engine wrote, or null where it never ran.
 */
async function onDisk(
  options: ShowPluginsOptions,
  argv: readonly string[],
): Promise<readonly string[] | null> {
  const { editor, ensureEngine, exists, version, runEngine, env, platform } = options;

  let nodePath: string;
  try {
    const found = findNode({
      setting: editor.setting("nodePath"),
      exists,
      ...(env === undefined ? {} : { env }),
      ...(platform === undefined ? {} : { platform }),
    });
    nodePath = found.path;
  } catch (error) {
    const message = error instanceof NoNodeError ? error.message : String(error);
    editor.log(message);
    void editor.ask("warn", message);
    return null;
  }

  try {
    const engine =
      namedEngine(editor, exists) ?? (await ensureEngine({ nodePath, label: LABEL, version }));
    const lines: string[] = [];
    await runEngine(nodePath, engine.entry, argv, (line) => {
      lines.push(line);
      editor.log(line);
    });
    return lines;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    editor.log(message);
    void editor.ask("warn", message);
    return null;
  }
}
