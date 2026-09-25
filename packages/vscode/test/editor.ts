/**
 * An `Editor` that records rather than acts, for the tests that drive logic without an editor.
 *
 * Shared because the seam is a dozen methods and every test needs all of them to satisfy the type
 * while caring about two. One factory means widening the seam costs one edit rather than one per
 * test file.
 */
import type { Editor, Health, Level } from "../src/editor.ts";

export interface StubEditor {
  readonly editor: Editor;
  readonly statuses: { health: Health; text: string; tooltip: string }[];
  readonly lines: string[];
  /** Every question put to the user, in order, with the buttons offered. */
  readonly asked: { level: Level; message: string; actions: string[] }[];
  /** Every reload actually taken. The list this project cares most about staying short. */
  readonly reloads: ("webviews" | "window")[];
  /** Every VSIX installed, in order. */
  readonly installs: string[];
  /** The profile's state, as `remember` left it. */
  readonly memory: Map<string, unknown>;
}

export interface StubOptions extends Partial<Editor> {
  /** What the user presses, in order. Undefined, or running out, is a dismissal. */
  readonly answers?: readonly (string | undefined)[];
}

export function stubEditor(over: StubOptions = {}): StubEditor {
  const statuses: StubEditor["statuses"] = [];
  const lines: string[] = [];
  const asked: StubEditor["asked"] = [];
  const reloads: StubEditor["reloads"] = [];
  const installs: string[] = [];
  const memory = new Map<string, unknown>();
  const { answers = [], ...overrides } = over;
  let answered = 0;

  const editor: Editor = {
    setting: () => undefined,
    extensionPath: () => undefined,
    extensionActive: () => false,
    onExtensionsChanged: () => ({ dispose() {} }),
    status: (health, text, tooltip) => {
      statuses.push({ health, text, tooltip });
    },
    log: (line) => {
      lines.push(line);
    },
    ask: async (level, message, ...actions) => {
      asked.push({ level, message, actions: [...actions] });
      return answers[answered++];
    },
    reloadWebviews: async () => {
      reloads.push("webviews");
    },
    reloadWindow: async () => {
      reloads.push("window");
    },
    installExtension: async (vsix) => {
      installs.push(vsix);
    },
    remembered: (key) => memory.get(key),
    remember: async (key, value) => {
      memory.set(key, value);
    },
    ...overrides,
  };

  return { editor, statuses, lines, asked, reloads, installs, memory };
}
