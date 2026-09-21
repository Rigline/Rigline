/**
 * The only file in this package that imports `vscode`.
 *
 * It adapts the editor to `Editor` and gets out of the way; the sequence itself lives in
 * `acquire.ts`, which vitest drives. Keeping the boundary this thin is what lets 8a be tested at
 * all, since nothing here can run outside an extension host.
 */
import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { acquireAndInject } from "./acquire.ts";
import { CLAUDE_CODE, type Editor, type Health } from "./editor.ts";
import { watchExtension } from "./watch.ts";

const HEALTH: Record<Health, { icon: string; background?: string }> = {
  ok: { icon: "$(check)" },
  working: { icon: "$(sync~spin)" },
  attention: { icon: "$(warning)", background: "statusBarItem.warningBackground" },
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
    onExtensionsChanged: (listener) => vscode.extensions.onDidChange(() => listener()),
    status: (health, text, tooltip) => {
      const look = HEALTH[health];
      item.text = `${look.icon} ${text}`;
      item.tooltip = tooltip;
      item.backgroundColor =
        look.background === undefined ? undefined : new vscode.ThemeColor(look.background);
      item.show();
    },
    log: (line) => output.appendLine(`[${new Date().toISOString()}] ${line}`),
    ask: async (message, ...actions) => await vscode.window.showWarningMessage(message, ...actions),
  };

  const watcher = watchExtension({
    editor,
    id: CLAUDE_CODE,
    react: async () => {
      await run(editor);
    },
  });
  context.subscriptions.push(watcher);

  // Deliberately not awaited: activation must return promptly, and every failure inside is already
  // a result rather than a rejection, so there is nothing here for a `catch` to add.
  void run(editor);
}

function run(editor: Editor): Promise<unknown> {
  return import("rigline/engine").then(async (wrapper) =>
    acquireAndInject({
      editor,
      exists: existsSync,
      acquisition: {
        updateEngine: (options) => wrapper.updateEngine(options),
        ensureEngine: (options) => wrapper.ensureEngine(options),
      },
    }),
  );
}

export function deactivate(): void {
  // Nothing to unwind: the status item and the output channel are disposed by the subscriptions,
  // and no injection is in flight that would be safe to interrupt anyway.
}
