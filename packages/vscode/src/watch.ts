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
  /**
   * A cheap summary of the extension directory — sizes and modification times, never contents — so
   * the watcher can tell "still being written" from "finished". Injected, because reading a
   * directory is the one thing in here that touches a disk.
   */
  stamps(path: string | undefined): Stamps;
  /** How long the directory must look identical before we believe the install finished. */
  readonly settleMs?: number;
  /** How many times to re-sample before giving up and leaving it to the next poll. */
  readonly settleTries?: number;
  readonly setInterval?: (fn: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type WatchReason =
  | { readonly kind: "start"; readonly path: string | undefined }
  | { readonly kind: "moved"; readonly from: string | undefined; readonly to: string | undefined };

/**
 * Sizes and modification times of the three files an install touches, by role rather than joined
 * into one string.
 *
 * The settle wants all three at once; the reload decision wants `bundle` and `host` apart, because
 * one asks for a webview reload and the other for a window reload (D82). One sampling, read two
 * ways, rather than two functions that could disagree about what they looked at.
 */
export interface Stamps {
  /** `webview/index.js` — the bundle the loader is prepended and appended to. */
  readonly bundle: string;
  /** `extension.js` — where a plugin's byte substitutions land. */
  readonly host: string;
  readonly manifest: string;
}

export function sameStamps(a: Stamps, b: Stamps): boolean {
  return a.bundle === b.bundle && a.host === b.host && a.manifest === b.manifest;
}

const INTERVAL_MS = 30_000;

/**
 * Wait for the directory to stop moving before touching it.
 *
 * Not caution for its own sake. `settleWebviewBackup` ends with "the two share no relation, so the
 * extension was replaced in place" and makes the live bytes the new pristine backup — which is
 * right for a real new version and catastrophic for a half-written one, because the truncated bytes
 * become the thing `restore` restores. The poll alone made that unlikely by landing thirty seconds
 * late; `onDidChange` fires while VS Code may still be writing, so the fast path has to pay for
 * itself.
 *
 * Two seconds twice over, ten times at most. Whether VS Code writes to a temporary directory and
 * renames it into place — which would make all of this unnecessary — is not something this code
 * should assume either way, and the cost of being wrong in the safe direction is a few seconds on
 * an event that happens weekly.
 */
const SETTLE_MS = 2_000;
const SETTLE_TRIES = 10;

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
    stamps,
    settleMs = SETTLE_MS,
    settleTries = SETTLE_TRIES,
    setInterval: every = (fn, ms) => globalThis.setInterval(fn, ms),
    // The handle is `unknown` across the seam so a test can hand back whatever it likes; the cast
    // is confined to the one place that knows what the real timer returns.
    clearInterval: stop = (handle) =>
      globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
    sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  } = options;

  let current = editor.extensionPath(id);
  let running = false;
  let disposed = false;

  /**
   * Whether the directory has stopped changing. Answers false when it never settles, which leaves
   * the work to the next poll rather than reacting to a directory still being written.
   */
  async function settled(path: string | undefined): Promise<boolean> {
    let before = stamps(path);
    for (let attempt = 0; attempt < settleTries; attempt += 1) {
      await sleep(settleMs);
      if (disposed) return false;
      const after = stamps(path);
      if (sameStamps(after, before)) return true;
      before = after;
    }
    editor.log(
      `${id} is still changing after ${(settleTries * settleMs) / 1000}s; leaving it for the next look`,
    );
    return false;
  }

  /** Answers whether the move was dealt with, which is what decides if it stays outstanding. */
  async function run(reason: WatchReason): Promise<boolean> {
    if (running || disposed) return false;
    running = true;
    try {
      if (reason.kind === "moved" && !(await settled(reason.to))) return false;
      await react(reason);
      return true;
    } catch (error) {
      // `react` is not supposed to throw — `acquireAndInject` answers with a result instead — so
      // reaching here means a defect rather than a failed update. It is logged and swallowed all
      // the same: an unhandled rejection in a timer takes no user-visible path at all (P8).
      editor.log(`watch: the reaction threw, which it should not. ${String(error)}`);
      return true;
    } finally {
      running = false;
    }
  }

  async function look(): Promise<void> {
    if (disposed) return;
    const seen = editor.extensionPath(id);
    if (seen === current) return;
    const from = current;
    editor.log(`${id} moved: ${from ?? "absent"} -> ${seen ?? "absent"}`);
    // Committed only once the move has been dealt with. A directory that never settled, or a burst
    // whose follower was dropped, must stay outstanding — recording it here would mean the next
    // poll saw no change and the update was silently skipped, which is the failure this whole
    // milestone is against (P8).
    if (await run({ kind: "moved", from, to: seen })) current = seen;
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
