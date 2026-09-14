/**
 * The crash-surviving record's pure half (D53).
 *
 * The storage plumbing itself is deliberately not tested here — it needs a real `localStorage`, and
 * what it does around one is try/catch and a timer. What is worth pinning is the two decisions:
 * which run gets reported as the previous one and which keys get dropped, and above all *what a
 * snapshot contains*, because that is a privacy boundary as much as a diagnostic one and a test is
 * the only thing that keeps a field from drifting into it later.
 */
import { describe, expect, it } from "vitest";
import type { Diagnostics } from "../src/kernel/bridge.ts";
import { lastSeen, snapshot, triage } from "../src/kernel/record.ts";

function diagnostics(over: Partial<Diagnostics> = {}): Diagnostics {
  return {
    version: "rigline-1",
    preAt: 1,
    postAt: 2,
    rootChildrenAtPre: 0,
    rootChildrenAtPost: 3,
    acquireWrapped: true,
    acquireCalled: true,
    outboundCount: 12,
    inboundCount: 34,
    buffered: 0,
    bufferSealed: true,
    tapClones: 5,
    tapCloneMs: 1.5,
    tapCloneMaxMs: 0.9,
    tapCloneMaxType: "list_sessions_response",
    resent: 0,
    plugins: [],
    rewrites: [],
    hostPatches: [],
    identifiersFor: "2.1.270",
    react: { hook: "installed", version: "19.1.0", commits: 400, notified: 40 },
    transcript: { entries: 319, timed: 300, sweeps: 88, rebuilds: 9 },
    mounts: { driver: "commit", active: 6, replaced: 1, lost: 0 },
    meters: {
      commit: { peak: 142, peakAt: 1_700_000_000_000, recent: 3 },
      sweep: { peak: 0, peakAt: null, recent: 0 },
    },
    storage: { available: true, writes: 1, failures: 0, bytes: 10, lastError: null },
    previous: null,
    errors: [],
    ...over,
  } as Diagnostics;
}

describe("snapshot", () => {
  it("carries the counters and the peaks that have fired", () => {
    const s = snapshot(diagnostics(), 1234);
    expect(s.at).toBe(1234);
    expect(s.outbound).toBe(12);
    expect(s.rebuilds).toBe(9);
    expect(s.mounts).toBe(6);
    expect(s.peaks).toEqual({ commit: 142 });
  });

  it("carries nothing that could hold a message, a title or a path", () => {
    // The guard against a field drifting in later: everything a snapshot holds is a number, or the
    // flat number map of peaks. Anything else is a string from somewhere, and somewhere is the app.
    const s = snapshot(diagnostics(), 1234);
    for (const [key, value] of Object.entries(s)) {
      if (key === "peaks") {
        expect(
          Object.values(value as Record<string, unknown>).every((v) => typeof v === "number"),
        ).toBe(true);
        continue;
      }
      expect(typeof value, `${key} is not a number`).toBe("number");
    }
  });
});

describe("lastSeen", () => {
  it("uses the final snapshot's time", () => {
    expect(lastSeen({ runId: "a", startedAt: 10, surface: "editor", entries: [{ at: 99 }] })).toBe(
      99,
    );
  });

  it("falls back to the start for a run that never took one", () => {
    expect(lastSeen({ runId: "a", startedAt: 10, surface: "editor", entries: [] })).toBe(10);
  });
});

describe("triage", () => {
  const run = (id: string, startedAt: number, at: number) => ({
    key: `rigline.diag.${id}`,
    run: { runId: id, startedAt, surface: "editor", entries: [{ at }] },
  });

  it("reports the run that was alive most recently, not the one that started last", () => {
    const older = run("old", 100, 900);
    const newerStart = run("new", 500, 600);
    expect(triage([newerStart, older], 3).previous?.runId).toBe("old");
  });

  it("drops everything past the keep count, oldest first", () => {
    const runs = [run("a", 1, 10), run("b", 2, 30), run("c", 3, 20)];
    expect(triage(runs, 1).drop).toEqual(["rigline.diag.c", "rigline.diag.a"]);
  });

  it("has no previous and nothing to drop when storage is empty", () => {
    expect(triage([], 3)).toEqual({ previous: null, drop: [] });
  });
});
