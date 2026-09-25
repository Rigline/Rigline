/**
 * The editor, as the companion needs it.
 *
 * Everything the companion does is testable except the things below, so those are the seam:
 * `extension.ts` adapts the real `vscode` module to this, and every other module in this package
 * imports nothing from VS Code at all. That is the same split `@rigline/host` uses for the webview
 * and core uses for the filesystem, and it is why 8a's logic can be driven by vitest even though
 * its acceptance is a live read.
 */

export interface Disposable {
  dispose(): void;
}

/** Where a status line sits: green, working, or wanting somebody. */
/**
 * `idle` exists because green was lying. The engine's `install` exits 0 when no Claude Code is
 * installed — nothing to do is not an error for the CLI — so a companion reading the exit code
 * alone reported success over an absent feature, which is the one thing P8 forbids. The companion
 * knows better than the exit code does: it can ask the editor whether the extension is there.
 *
 * `stale` is the same complaint about this window rather than about the machine: injected on disk,
 * absent from the panel in front of the user until something reloads (D82).
 *
 * `ready` is not a complaint: a newly arrived version is patched and waiting for a restart, and
 * plain `ok` would look like nothing had happened (D85).
 */
export type Health = "ok" | "working" | "idle" | "attention" | "stale" | "ready";

/** How loudly a question is asked. An offer is not a warning (D82). */
export type Level = "info" | "warn";

export interface Editor {
  /** A `rigline.*` setting, or undefined when unset or blank. */
  setting(key: string): string | undefined;
  /**
   * Where VS Code put an installed extension, which is the one fact the companion has and the
   * engine cannot get for itself (D80). Undefined when the extension is not installed.
   */
  extensionPath(id: string): string | undefined;
  /**
   * Whether the extension is running, which gates the reload offer (D82). Installed and running
   * are not the same question. It is not "has a webview": Claude Code activates at startup
   * regardless, and VS Code will not answer the finer question.
   */
  extensionActive(id: string): boolean;
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
  ask(level: Level, message: string, ...actions: readonly string[]): Promise<string | undefined>;
  /** Re-read every live webview from disk. Ends the in-flight turn of every session here (D82). */
  reloadWebviews(): Promise<void>;
  /** The whole window. The only thing that picks up a changed `extension.js`. */
  reloadWindow(): Promise<void>;
  /** Install a VSIX into this window's profile; it runs once extensions next restart (D99). */
  installExtension(vsix: string): Promise<void>;
  /** A value kept in this profile's state for the companion, shared by the profile's windows. */
  remembered(key: string): unknown;
  remember(key: string, value: unknown): Promise<void>;
}

/** The extension the whole project is about. */
export const CLAUDE_CODE = "anthropic.claude-code";
