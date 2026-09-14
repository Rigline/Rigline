/**
 * The crash-surviving record: a bounded ring of diagnostic snapshots in `localStorage` (D53).
 *
 * **Why storage, and why it is the only option.** The webview CSP is `default-src 'none'` with no
 * `connect-src`, so nothing in here can write a file or fetch one. A plugin may not originate a bus
 * message (D20), so the extension host cannot be asked to log on the panel's behalf. Webview console
 * output reaches no log file. What is left is storage — and it works, because VS Code keeps
 * persisted origin stores keyed by viewType and extension id, so the webview's origin is the same
 * one across a webview reload, a window reload and a restart. A ring written under it outlives the
 * window that wrote it, which is the entire point: a window that had to be force-closed leaves no
 * other account of what the panel was doing in its last minutes.
 *
 * **One key per run, not one key per panel.** Two session tabs are two webviews sharing one origin,
 * so a single fixed key would have them overwriting each other every few seconds and produce a ring
 * belonging to nobody. Each boot claims `rigline.diag.<runId>` instead, and prunes at boot to the
 * newest few, which bounds the whole thing at a few hundred kilobytes however many panels have ever
 * been opened.
 *
 * **Nothing here may cost a panel.** Storage can be disabled, full, or cleared between one call and
 * the next, and reading it back can hand over whatever some older version of this wrote. Every
 * access is wrapped, every failure lands in `diagnostics.storage`, and the recorder degrades to
 * doing nothing at all rather than throwing. `available: false` is an ordinary state, not an alarm.
 */
import type { Diagnostics } from "./bridge.ts";

/** Namespace for every key this writes, and what a boot enumerates to find its predecessors. */
const PREFIX = "rigline.diag.";

/** How often a snapshot is taken. Coarse on purpose: this is a flight recorder, not a profiler, and
 * a write serialises the whole ring. At this cadence the default ring is about five minutes deep. */
const INTERVAL_MS = 5000;

/** Snapshots kept per run. */
const RING = 60;

/** Runs kept in storage, this one included. Older keys are deleted at boot. */
const RUNS = 4;

/** A serialised run larger than this is trimmed from the oldest end before it is written. */
const MAX_BYTES = 65536;

/** Snapshots handed back as `diagnostics.previous`: enough to see a slope, not the whole ring. */
const TAIL = 20;

export interface Recorder {
  /** Write one final snapshot and stop. Called from the kernel's teardown, not from unload. */
  stop(): void;
}

interface StoredRun {
  readonly runId: string;
  readonly startedAt: number;
  readonly surface: string;
  /** Mutable: the ring is trimmed in place, both by age and to fit the byte cap. */
  entries: Record<string, unknown>[];
}

/**
 * One snapshot: the counters and the peaks, and nothing that could carry a message.
 *
 * Deliberately flat and short-keyed. It is serialised sixty times over and the whole ring is
 * rewritten on every tick, so every byte here is paid for repeatedly; and it is read back by a
 * future version of this code, so a shape that is obvious from its own field names survives better
 * than one that needs a decoder.
 *
 * Exported and pure so the unit tier can pin it without a DOM: what this includes is a privacy
 * decision as much as a diagnostic one (D53), and a test is where that stays true.
 */
export function snapshot(diagnostics: Diagnostics, at: number): Record<string, unknown> {
  const peaks: Record<string, number> = {};
  for (const [name, m] of Object.entries(diagnostics.meters)) {
    if (m.peak > 0) peaks[name] = m.peak;
  }
  return {
    at,
    outbound: diagnostics.outboundCount,
    inbound: diagnostics.inboundCount,
    sweeps: diagnostics.transcript.sweeps,
    rebuilds: diagnostics.transcript.rebuilds,
    entries: diagnostics.transcript.entries,
    mounts: diagnostics.mounts.active,
    replaced: diagnostics.mounts.replaced,
    lost: diagnostics.mounts.lost,
    commits: diagnostics.react.commits,
    notified: diagnostics.react.notified,
    errors: diagnostics.errors.length,
    peaks,
  };
}

/** Whether a parsed value is a run this module wrote, rather than whatever else is under the key. */
function isStoredRun(value: unknown): value is StoredRun {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Partial<StoredRun>;
  return (
    typeof run.runId === "string" && typeof run.startedAt === "number" && Array.isArray(run.entries)
  );
}

/** When a run was last heard from: its final snapshot, or its start if it never took one. */
export function lastSeen(run: StoredRun): number {
  const last = run.entries.at(-1);
  const at = last?.at;
  return typeof at === "number" ? at : run.startedAt;
}

/**
 * The run to report as `previous`, and the keys to delete, given everything found under the prefix.
 *
 * Newest by last snapshot rather than by start, because "which run was alive most recently" is the
 * question, and a long-lived panel that started yesterday is a better witness than a short one that
 * started an hour ago. Pure, so the choice is testable without storage.
 */
export function triage(
  runs: readonly { key: string; run: StoredRun }[],
  keep: number,
): { previous: StoredRun | null; drop: string[] } {
  const sorted = [...runs].sort((a, b) => lastSeen(b.run) - lastSeen(a.run));
  return {
    previous: sorted[0]?.run ?? null,
    drop: sorted.slice(keep).map((r) => r.key),
  };
}

/** Trim from the oldest end until the serialised run fits, so one write cannot grow without bound. */
function serialise(run: StoredRun): string {
  let entries = run.entries;
  let json = JSON.stringify({ ...run, entries });
  while (json.length > MAX_BYTES && entries.length > 1) {
    entries = entries.slice(Math.ceil(entries.length / 4));
    json = JSON.stringify({ ...run, entries });
  }
  run.entries = entries;
  return json;
}

/**
 * `localStorage` itself, or null when merely touching it throws — which it does in more situations
 * than the API suggests, and always synchronously.
 */
function readStore(): Storage | null {
  try {
    const s = globalThis.localStorage;
    // Reading `length` is the cheapest thing that actually exercises the accessor: the getter can be
    // present and throw on use when storage is disabled for the origin.
    void s.length;
    return s;
  } catch {
    return null;
  }
}

/**
 * Start recording into `localStorage`, after reading back what the last run left there.
 *
 * `surface` is carried into the record because the editor panel and the sidebar are different
 * origins with different histories, and a report that does not say which one it came from invites
 * the reader to assume the wrong one.
 */
export function createRecorder(diagnostics: Diagnostics, surface: string): Recorder {
  const found = readStore();
  if (!found) return { stop: () => {} };
  // Re-bound non-null so the closures below do not each have to re-prove it.
  const store: Storage = found;
  diagnostics.storage.available = true;

  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const run: StoredRun = { runId, startedAt: Date.now(), surface, entries: [] };

  adoptPrevious(store, runId);

  function fail(e: unknown): void {
    diagnostics.storage.failures += 1;
    diagnostics.storage.lastError = e instanceof Error ? e.message : String(e);
  }

  /** Read every run under the prefix, publish the newest as `previous`, and delete the surplus. */
  function adoptPrevious(s: Storage, ours: string): void {
    const found: { key: string; run: StoredRun }[] = [];
    const keys: string[] = [];
    try {
      for (let i = 0; i < s.length; i++) {
        const key = s.key(i);
        if (key?.startsWith(PREFIX)) keys.push(key);
      }
      for (const key of keys) {
        if (key === PREFIX + ours) continue;
        const raw = s.getItem(key);
        if (raw === null) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // Not ours, or written by a version whose shape has moved on. Dropping it is right: this
          // is a flight recorder, and a record that cannot be read has no claim on the space.
          s.removeItem(key);
          continue;
        }
        if (isStoredRun(parsed)) found.push({ key, run: parsed });
        else s.removeItem(key);
      }
      const { previous, drop } = triage(found, RUNS - 1);
      for (const key of drop) s.removeItem(key);
      if (previous) {
        const entries = previous.entries.slice(-TAIL);
        const first = entries[0]?.at;
        diagnostics.previous = {
          from: typeof first === "number" ? first : previous.startedAt,
          to: lastSeen(previous),
          entries,
        };
      }
    } catch (e) {
      fail(e);
    }
  }

  function write(): void {
    try {
      const json = serialise(run);
      store.setItem(PREFIX + runId, json);
      diagnostics.storage.writes += 1;
      diagnostics.storage.bytes = json.length;
    } catch (e) {
      // A quota failure is the expected one, and the right answer is to shrink and let the next tick
      // try rather than to stop recording: whatever filled the quota may well be gone by then.
      run.entries = run.entries.slice(Math.ceil(run.entries.length / 2));
      fail(e);
    }
  }

  function tick(): void {
    run.entries.push(snapshot(diagnostics, Date.now()));
    if (run.entries.length > RING) run.entries.splice(0, run.entries.length - RING);
    write();
  }

  tick();
  const timer = setInterval(tick, INTERVAL_MS);

  return {
    stop() {
      clearInterval(timer);
      tick();
    },
  };
}
