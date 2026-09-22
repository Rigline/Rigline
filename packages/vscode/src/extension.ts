/**
 * The only file in this package that imports `vscode`.
 *
 * It adapts the editor to `Editor` and gets out of the way; the sequence itself lives in
 * `acquire.ts`, which vitest drives. Keeping the boundary this thin is what lets 8a be tested at
 * all, since nothing here can run outside an extension host.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import * as vscode from "vscode";
import { acquireAndInject, showPlugins } from "./acquire.ts";
import { CLAUDE_CODE, type Editor, type Health } from "./editor.ts";
import { type ReloadOffer, reloadOffer } from "./reload.ts";
import { type Stamps, startingReason, type WatchReason, watchExtension } from "./watch.ts";

/** Not contributed to the palette: VS Code already has one, and this one clears our status. */
const RELOAD_COMMAND = "rigline.reload";
/** Contributed: nothing else lists what's installed without a terminal (8c). */
const SHOW_PLUGINS_COMMAND = "rigline.showPlugins";

const HEALTH: Record<Health, { icon: string; background?: string; command?: string }> = {
  ok: { icon: "$(check)" },
  working: { icon: "$(sync~spin)" },
  idle: { icon: "$(circle-outline)" },
  attention: { icon: "$(warning)", background: "statusBarItem.warningBackground" },
  stale: { icon: "$(refresh)", command: RELOAD_COMMAND },
  // No command: unlike `stale`, there is no outstanding offer behind it to re-show, only information.
  ready: { icon: "$(check-all)" },
};

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Rigline");
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(output, item);

  const editor: Editor = {
    setting: (key) => {
      const value = vscode.workspace.getConfiguration("rigline").get<string>(key);
      return value === undefined || value.trim() === "" ? undefined : value;
    },
    extensionPath: (id) => vscode.extensions.getExtension(id)?.extensionUri.fsPath,
    extensionActive: (id) => vscode.extensions.getExtension(id)?.isActive === true,
    onExtensionsChanged: (listener) => vscode.extensions.onDidChange(() => listener()),
    status: (health, text, tooltip) => {
      const look = HEALTH[health];
      item.text = `${look.icon} ${text}`;
      item.tooltip = tooltip;
      item.backgroundColor =
        look.background === undefined ? undefined : new vscode.ThemeColor(look.background);
      // Cleared on every other health, so a green item is not quietly clickable.
      item.command = look.command;
      item.show();
    },
    // A blank line keeps the engine's paragraphs apart; stamping it would turn each one into a
    // line of noise.
    log: (line) => output.appendLine(line === "" ? "" : `[${new Date().toISOString()}] ${line}`),
    ask: async (level, message, ...actions) =>
      level === "warn"
        ? await vscode.window.showWarningMessage(message, ...actions)
        : await vscode.window.showInformationMessage(message, ...actions),
    reloadWebviews: async () => {
      await vscode.commands.executeCommand("workbench.action.webview.reloadWebviewAction");
    },
    reloadWindow: async () => {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    },
  };

  // From the manifest VS Code read, never from disk: inside a VSIX the wrapper's own lookup
  // resolves to the extensions directory, where there is no manifest to find.
  const version = String(context.extension.packageJSON.version ?? "0.0.0");

  const offer = reloadOffer(editor);

  const watcher = watchExtension({
    editor,
    id: CLAUDE_CODE,
    installed: installedIn(dirname(context.extension.extensionUri.fsPath)),
    stamps,
    react: async (reason) => {
      await run(editor, version, reason, offer);
    },
  });
  context.subscriptions.push(watcher);
  context.subscriptions.push(
    vscode.commands.registerCommand(RELOAD_COMMAND, () => {
      void offer.again();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_PLUGINS_COMMAND, async () => {
      output.show();
      const wrapper = await import("rigline/engine");
      await showPlugins({
        editor,
        ensureEngine: (opts) => wrapper.ensureEngine(opts),
        exists: existsSync,
        version,
        runEngine,
      });
    }),
  );

  // Deliberately not awaited: activation must return promptly, and every failure inside is already
  // a result rather than a rejection, so there is nothing here for a `catch` to add.
  void run(editor, version, startingReason(editor, CLAUDE_CODE), offer);
}

async function run(
  editor: Editor,
  version: string,
  reason: WatchReason,
  offer: ReloadOffer,
): Promise<void> {
  const wrapper = await import("rigline/engine");
  const result = await acquireAndInject({
    editor,
    version,
    reason,
    stamps,
    runEngine,
    exists: existsSync,
    acquisition: {
      updateEngine: (options) => wrapper.updateEngine(options),
      ensureEngine: (options) => wrapper.ensureEngine(options),
    },
  });
  // Not awaited: an unanswered notification would otherwise hold the watcher's reaction lock for
  // as long as it stands, and the next update would be dropped as a follower (D82).
  if (result.kind === "injected") void offer.settle(result.reload, result.engine);
  // A run that wants a person may still have injected, so the offer is still owed — but it does not
  // get to overwrite what the status line is saying about the person.
  if (result.kind === "attention") void offer.settle(result.reload, "", true);
}

/**
 * Every installed Claude Code directory, by name, sorted.
 *
 * The root is this extension'''s own parent, which is the directory this host installs user
 * extensions into — we are in it, and it is there whether or not Claude Code is. Read from disk
 * rather than asked of VS Code, because `extensionUri` is fixed at what this host loaded and so
 * cannot report an install that happened since (D82).
 */
function installedIn(root: string): () => readonly string[] {
  const prefix = `${CLAUDE_CODE}-`.toLowerCase();
  return () => {
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix))
        .map((entry) => join(root, entry.name))
        .sort();
    } catch {
      // Unreadable is reported as nothing installed, which the next look corrects if it was a blip.
      return [];
    }
  };
}

/**
 * Run the engine, with its output piped into the Rigline channel a line at a time.
 *
 * The wrapper's own `run` inherits stdio, which in the extension host is a stream VS Code keeps no
 * log of — so every word the engine said was dropped, including on the runs where the status bar
 * then told somebody to go and read it. Piping is the whole fix, and it costs the engine nothing.
 */
function runEngine(
  nodePath: string,
  entry: string,
  argv: readonly string[],
  onLine: (line: string) => void,
): Promise<number> {
  return new Promise((done, fail) => {
    const child = spawn(nodePath, [entry, ...argv], { stdio: ["ignore", "pipe", "pipe"] });
    let rest = "";
    const take = (chunk: string) => {
      const lines = (rest + chunk).split(/\r?\n/);
      // The last piece has no newline yet, so it waits for the next chunk rather than being
      // reported as a line that is only half of one.
      rest = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", take);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", take);
    child.on("error", fail);
    child.on("close", (code) => {
      if (rest !== "") onLine(rest);
      done(code ?? 1);
    });
  });
}

/**
 * Sizes and modification times of the three files that matter, never their contents.
 *
 * Reading 3.6 MB every two seconds to decide whether a directory is still moving would cost more
 * than the thing it protects. A missing file reports as absent rather than throwing, which is the
 * correct answer mid-install and settles once it stops being true.
 */
function stamps(path: string | undefined): Stamps {
  const of = (name: string): string => {
    if (path === undefined) return "absent";
    try {
      const { size, mtimeMs } = statSync(join(path, name));
      return `${size}:${mtimeMs}`;
    } catch {
      return "absent";
    }
  };
  return {
    bundle: of(join("webview", "index.js")),
    host: of("extension.js"),
    manifest: of("package.json"),
  };
}

export function deactivate(): void {
  // Nothing to unwind: the status item and the output channel are disposed by the subscriptions,
  // and no injection is in flight that would be safe to interrupt anyway.
}
