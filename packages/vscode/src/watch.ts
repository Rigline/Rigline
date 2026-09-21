/**
 * Noticing that the extension was replaced.
 *
 * Two signals, and the asymmetry between them is the whole design. `extensions.onDidChange` is the
 * fast one: it fires when the installed set changes, so the gap between VS Code writing a new
 * directory and Rigline being back in it is a second rather than a poll interval. It is also the
 * one that must not be relied on — it carries no payload, names no extension, and its issue history
 * is a record of it not firing in cases the API documents. So the poll is the floor and the event
 * only shortens the wait (D80).
 *
 * What is watched is the *directory VS Code says the extension is in*, which the companion can ask
 * for and the engine cannot. A new path means a new install; the same path with our bytes gone
 * means somebody restored or reinstalled over it. Both want the same answer, so neither is treated
 * as a special case.
 */
import type { Disposable, Editor } from "./editor.ts";

export interface WatchOptions {
  readonly editor: Editor;
  /** The extension whose directory is watched. `anthropic.claude-code` in every real use. */
  readonly id: string;
  /** What to do when it moved. Never called concurrently with itself. */
  react(reason: WatchReason): Promise<void>;
  /** How often to look when nothing has fired. Half a minute, as the CLI's watcher uses. */
  readonly intervalMs?: number;
  readonly setInterval?: (fn: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

export type WatchReason =
  | { readonly kind: "start"; readonly path: string | undefined }
  | { readonly kind: "moved"; readonly from: string | undefined; readonly to: string | undefined };

const INTERVAL_MS = 30_000;

export interface Watcher extends Disposable {
  /** Look now. Exposed for the event path and for tests; never runs two reactions at once. */
  poke(): Promise<void>;
}

/**
 * Watch, and react once per move.
 *
 * Reactions are serialised rather than debounced. An update produces a burst — the event, then a
 * poll, then often a second event as VS Code deletes the old directory — and a reaction that ran
 * three times would run three npm installs, each waiting on the last one's lock. A run in flight
 * therefore marks itself and the follower is dropped, because the work is idempotent and the
 * follower would only discover what the leader already has.
 */
export function watchExtension(options: WatchOptions): Watcher {
  const {
    editor,
    id,
    react,
    intervalMs = INTERVAL_MS,
    setInterval: every = (fn, ms) => globalThis.setInterval(fn, ms),
    // The handle is `unknown` across the seam so a test can hand back whatever it likes; the cast
    // is confined to the one place that knows what the real timer returns.
    clearInterval: stop = (handle) =>
      globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
  } = options;

  let current = editor.extensionPath(id);
  let running = false;
  let disposed = false;

  async function run(reason: WatchReason): Promise<void> {
    if (running || disposed) return;
    running = true;
    try {
      await react(reason);
    } catch (error) {
      // `react` is not supposed to throw — `acquireAndInject` answers with a result instead — so
      // reaching here means a defect rather than a failed update. It is logged and swallowed all
      // the same: an unhandled rejection in a timer takes no user-visible path at all (P8).
      editor.log(`watch: the reaction threw, which it should not. ${String(error)}`);
    } finally {
      running = false;
    }
  }

  async function look(): Promise<void> {
    if (disposed) return;
    const seen = editor.extensionPath(id);
    if (seen === current) return;
    const from = current;
    current = seen;
    editor.log(`${id} moved: ${from ?? "absent"} -> ${seen ?? "absent"}`);
    await run({ kind: "moved", from, to: seen });
  }

  const subscription = editor.onExtensionsChanged(() => {
    void look();
  });
  const handle = every(() => {
    void look();
  }, intervalMs);

  return {
    poke: look,
    dispose() {
      disposed = true;
      subscription.dispose();
      stop(handle);
    },
  };
}

/** The first run, which is not a move and should happen whatever the watcher later sees. */
export function startingReason(editor: Editor, id: string): WatchReason {
  return { kind: "start", path: editor.extensionPath(id) };
}
