/**
 * Watching for the extension update that removed the loader.
 *
 * There is no event to subscribe to. VS Code installs a new versioned directory beside the old one
 * and deletes the old one some time later, with the extension host doing both; nothing tells a
 * process outside it. So this polls the extensions directory for the set of installed directories
 * changing, which is the one observable the update always produces and the only one that does not
 * depend on VS Code's internals.
 *
 * Polling a directory listing rather than `fs.watch`: the directory is created, renamed and removed
 * repeatedly during an install, and a recursive watch over an extensions folder full of other
 * people's extensions produces a great deal of noise for one event a week. A listing every half
 * minute costs a `readdir` and cannot miss the transition, because the transition is a lasting
 * change to the listing and not a moment.
 *
 * It runs unattended, so it never throws for a plugin's problem and never commits (D27, D30). It
 * writes the artefacts the flow writes and reports through `onReport`; the caller decides what a
 * non-empty `attention` means, which from the CLI is a non-zero exit.
 */
import { installedExtensions } from "../extension/locate.ts";
import { type FlowReport, type UpdateOptions, update } from "./flow.ts";

export interface WatchOptions extends UpdateOptions {
  /** Where to look for installed extensions. Defaults to this machine's own directory. */
  readonly extensionsDir?: string;
  /** How often to look. Half a minute by default: the update lands within a window of the release. */
  readonly intervalMs?: number;
  /** Every completed update, in order. Errors reach `onError` instead. */
  onReport(report: FlowReport): void;
  /**
   * A failure that stopped one update. The watcher carries on: a harvest that failed against a
   * half-written directory during an install succeeds on the next pass, and a watcher that exited
   * on the first of those would be a watcher that is never running when it is needed.
   */
  onError?(error: unknown): void;
  /** Run the flow once at start, before any change. Default true: the loader may already be gone. */
  readonly immediate?: boolean;
}

export interface Watcher {
  stop(): void;
}

/** The set of installed directories as one comparable string. */
function fingerprint(exts: readonly string[]): string {
  return [...exts].sort().join("\n");
}

export function watch(options: WatchOptions): Watcher {
  const intervalMs = options.intervalMs ?? 30_000;
  const look = (): string[] => installedExtensions(options.extensionsDir);
  let last = fingerprint(look());
  let running = false;

  const run = (exts: readonly string[]): void => {
    // Guarded rather than queued: an update that outruns the interval means the machine is busy,
    // and the right answer then is to skip this tick, not to build a backlog of identical work.
    if (running) return;
    running = true;
    try {
      // The list this tick saw, not whatever the flow would find for itself: the directory can
      // change again mid-update, and reporting on a set nobody observed would be a report about
      // a moment that never existed.
      options.onReport(update({ ...options, exts }));
    } catch (error) {
      if (options.onError) options.onError(error);
      else throw error;
    } finally {
      running = false;
    }
  };

  if (options.immediate !== false) run(look());

  const timer = setInterval(() => {
    const exts = look();
    const now = fingerprint(exts);
    if (now === last) return;
    last = now;
    run(exts);
  }, intervalMs);
  // Not `unref`ed: a watcher is the process's whole reason to be alive.

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
