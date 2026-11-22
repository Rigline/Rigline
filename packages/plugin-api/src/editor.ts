/**
 * The editor context: Claude Code attaches the open file or the selected lines to every prompt, and
 * Rigline makes that opt-in per message.
 *
 * Pure: `config.yaml`'s `editor` block, and what a selection the panel's session holds reads as. The
 * host's editor-context service finds the session and holds the selection back.
 */

/** `editor.attach`: `ask` sends only what is ticked; `always` is Claude Code's own behaviour. */
export type EditorAttach = "ask" | "always";

export const EDITOR_ATTACH: readonly EditorAttach[] = ["ask", "always"];

/** Rigline's own editor settings: `config.yaml`'s `editor` block. */
export interface EditorSettings {
  readonly attach: EditorAttach;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = Object.freeze({ attach: "ask" });

const EDITOR_KEYS = ["attach"];

/**
 * The `editor` block as written, or why it cannot be read. A key or a value a later Rigline wrote is
 * listed in `unknown` (D110), and an unknown value reads as `always`, the state in which Rigline
 * does nothing.
 */
export function readEditorSettings(
  value: unknown,
):
  | { readonly settings: EditorSettings; readonly unknown: readonly string[] }
  | { readonly problem: string } {
  if (value === undefined || value === null) {
    return { settings: DEFAULT_EDITOR_SETTINGS, unknown: [] };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { problem: '"editor" must be a mapping of settings' };
  }
  const block = value as Record<string, unknown>;
  const unknown = Object.keys(block)
    .filter((key) => !EDITOR_KEYS.includes(key))
    .map((key) => `editor.${key}`);
  const attach = block.attach;
  if (attach === undefined || attach === null) {
    return { settings: DEFAULT_EDITOR_SETTINGS, unknown };
  }
  if (typeof attach !== "string") {
    return { problem: `"editor.attach" must be one of ${EDITOR_ATTACH.join(", ")}` };
  }
  if ((EDITOR_ATTACH as readonly string[]).includes(attach)) {
    return { settings: { attach: attach as EditorAttach }, unknown };
  }
  return { settings: { attach: "always" }, unknown: [...unknown, `editor.attach: ${attach}`] };
}

/** What the panel attaches: some lines of a file, or the open file alone. */
export interface Attachable {
  readonly path: string;
  /** The lines selected, numbered as the panel's block numbers them, or null for the file alone. */
  readonly lines: { readonly start: number; readonly end: number } | null;
}

/**
 * A selection the panel's session holds, as the panel reads it: lines where text is selected, the
 * file alone otherwise. Null for anything without a path.
 */
export function attachableOf(value: unknown): Attachable | null {
  if (typeof value !== "object" || value === null) return null;
  const selection = value as Record<string, unknown>;
  const path = selection.filePath;
  if (typeof path !== "string" || path === "") return null;
  const { startLine: start, endLine: end, selectedText } = selection;
  const selected =
    typeof selectedText === "string" &&
    selectedText !== "" &&
    typeof start === "number" &&
    typeof end === "number";
  return { path, lines: selected ? { start, end } : null };
}

/** The file's name, as Claude Code's own chip shows it. */
export function fileName(path: string): string {
  return path.split(/[/\\]/).at(-1) ?? path;
}

/** What Rigline's chip draws: what is available, and whether it goes with the next message. */
export interface EditorContextState {
  readonly available: Attachable | null;
  readonly ticked: boolean;
}

export const NO_EDITOR_CONTEXT: EditorContextState = Object.freeze({
  available: null,
  ticked: false,
});

export function sameEditorContext(a: EditorContextState, b: EditorContextState): boolean {
  return (
    a.ticked === b.ticked &&
    a.available?.path === b.available?.path &&
    a.available?.lines?.start === b.available?.lines?.start &&
    a.available?.lines?.end === b.available?.lines?.end
  );
}
