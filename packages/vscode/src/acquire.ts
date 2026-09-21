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
import type { Editor } from "./editor.ts";
import { findNode, NoNodeError } from "./node.ts";

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
  }): Promise<{ readonly version: string; run(argv: readonly string[]): Promise<number> }>;
}

export interface AcquireOptions {
  readonly editor: Editor;
  readonly acquisition: Acquisition;
  readonly exists: (path: string) => boolean;
  /** This extension's own version, from the manifest VS Code read. Never discovered from disk. */
  readonly version: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}

/** How this process names itself in the home lock, for whoever is waiting on it (D80). */
export const LABEL = "the Rigline companion extension";

export type AcquireResult =
  | { readonly kind: "injected"; readonly engine: string }
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
  const { editor, acquisition, exists, version, env, platform } = options;

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

  editor.status("working", "Rigline: updating", "Checking for a newer Rigline engine");
  try {
    const update = await acquisition.updateEngine({ nodePath, label: LABEL, version });
    editor.log(`engine: ${update.outcome}${update.to === undefined ? "" : ` ${update.to}`}`);
    if (update.outcome === "failed") {
      // Reported, not thrown, and not fatal: a contended lock lands here, and the right answer is
      // to carry on with the engine already present rather than to give up on this update (D80).
      editor.log(`engine update did not happen: ${update.reason ?? "no reason given"}`);
    }

    const engine = await acquisition.ensureEngine({ nodePath, label: LABEL, version });
    editor.status("working", "Rigline: injecting", `Running ${engine.version}`);
    const code = await engine.run(["install"]);
    if (code !== 0) {
      const message = `the engine exited ${code} injecting. See the Rigline output for what it said.`;
      editor.status("attention", "Rigline: install failed", message);
      return { kind: "failed", message };
    }

    editor.status("ok", "Rigline", `Injected by engine ${engine.version}`);
    return { kind: "injected", engine: engine.version };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    editor.status("attention", "Rigline: failed", message);
    editor.log(message);
    return { kind: "failed", message };
  }
}
