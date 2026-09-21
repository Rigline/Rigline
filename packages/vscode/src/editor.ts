/**
 * The editor, as the companion needs it.
 *
 * Everything the companion does is testable except the six things below, so those are the seam:
 * `extension.ts` adapts the real `vscode` module to this, and every other module in this package
 * imports nothing from VS Code at all. That is the same split `@rigline/host` uses for the webview
 * and core uses for the filesystem, and it is why 8a's logic can be driven by vitest even though
 * its acceptance is a live read.
 */

export interface Disposable {
  dispose(): void;
}

/** Where a status line sits: green, working, or wanting somebody. */
export type Health = "ok" | "working" | "attention";

export interface Editor {
  /** A `rigline.*` setting, or undefined when unset or blank. */
  setting(key: string): string | undefined;
  /**
   * Where VS Code put an installed extension, which is the one fact the companion has and the
   * engine cannot get for itself (D80). Undefined when the extension is not installed.
   */
  extensionPath(id: string): string | undefined;
  /** Fires when the installed set changes. The fast path; never the only signal (D80). */
  onExtensionsChanged(listener: () => void): Disposable;
  /** The status line. Called often and cheap; never a notification. */
  status(health: Health, text: string, tooltip: string): void;
  /** A line in the companion's own output channel. Where the detail goes. */
  log(line: string): void;
  /**
   * A notification with buttons, answering with the one chosen or undefined. Reserved for things a
   * person must act on: a status line is the place for everything else.
   */
  ask(message: string, ...actions: readonly string[]): Promise<string | undefined>;
}

/** The extension the whole project is about. */
export const CLAUDE_CODE = "anthropic.claude-code";
