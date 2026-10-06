/**
 * What Diagnostics shows and what Copy report carries (D53, D119), without a browser. The submenu
 * itself is driven in the harness.
 */
import { describe, expect, it } from "vitest";
import type { CheckGroup } from "../src/kernel/checks.ts";
import { formatGroups, formatLine, formatReport, type ReportFacts } from "../src/shell/report.ts";

/** One group, as the registry hands it back. */
function group(
  contributor: string,
  ...results: Omit<CheckGroup["results"][number], "contributor">[]
): CheckGroup {
  return {
    contributor,
    results: results.map((r) => ({ contributor, ...r })),
    failing: results.filter((r) => r.verdict === "fail").length,
  };
}

const line = (name: string, verdict: "pass" | "fail" | "n/a", detail = "") => ({
  name,
  verdict,
  detail,
});

describe("formatLine", () => {
  it("tags each verdict and keeps the detail after an em dash", () => {
    expect(formatLine(line("x", "pass", "ok"))).toBe("PASS  x — ok");
    expect(formatLine(line("y", "fail", "broken"))).toBe("FAIL  y — broken");
    expect(formatLine(line("z", "n/a", "not yet"))).toBe("N/A   z — not yet");
  });

  it("omits the dash and detail when there is none", () => {
    expect(formatLine(line("x", "pass"))).toBe("PASS  x");
  });
});

describe("formatGroups", () => {
  it("heads each contributor's lines with its name and indents them under it", () => {
    const text = formatGroups([group("rigline", line("tables loaded", "pass", "2.1.270"))]);
    expect(text).toBe("rigline\n  PASS  tables loaded — 2.1.270");
  });

  // A count on every header would train the eye to skip it; a header that carries one is itself
  // the finding, which is the same reason the abandoned-mounts line is absent rather than empty.
  it("puts a count on a header only when that contributor has a failure", () => {
    const text = formatGroups([
      group("rigline", line("a", "pass")),
      group("time-marks", line("b", "fail", "no rows carried a time")),
    ]);
    expect(text.split("\n")[0]).toBe("rigline");
    expect(text).toContain("time-marks  (1 failing)");
  });

  it("keeps the registry's order rather than sorting, so the list cannot move as verdicts change", () => {
    const text = formatGroups([
      group("rigline", line("a", "pass")),
      group("probe", line("b", "fail")),
    ]);
    expect(text.indexOf("rigline")).toBeLessThan(text.indexOf("probe"));
  });

  it("says so rather than rendering nothing when no check has been contributed", () => {
    expect(formatGroups([])).toBe("(no checks registered)");
  });
});

describe("formatReport", () => {
  const NOW = Date.parse("2026-09-14T06:26:41Z");
  const facts: ReportFacts = {
    extension: "2.1.270",
    engine: "1.0.0",
    surface: "editor",
    preAt: 12,
    postAt: 486,
    react: { hook: "installed", version: "19.1.0", commits: 4821, notified: 92, foreign: 0 },
    mounts: { driver: "commit", active: 6, replaced: 1, lost: 0, abandoned: [] },
    storage: { available: true, writes: 14, failures: 0, bytes: 18_600, lastError: null },
    bus: {
      outbound: 1204,
      inbound: 3891,
      clones: 2110,
      cloneMs: 412.4,
      cloneMaxMs: 31.2,
      cloneMaxType: "list_sessions_response",
    },
    at: NOW,
    meters: {
      commit: {
        peak: 142,
        peakAt: Date.parse("2026-09-14T06:26:38Z"),
        recent: 3,
        recentAt: NOW - 500,
      },
      sweep: {
        peak: 12,
        peakAt: Date.parse("2026-09-14T06:26:38Z"),
        recent: 0,
        recentAt: NOW - 500,
      },
      resend: { peak: 0, peakAt: null, recent: 0, recentAt: null },
    },
    plugins: [{ name: "session-id", status: "loaded" }],
    rewrites: [],
    hostPatches: [{ plugin: "worktree", applied: true, required: false }],
    previous: {
      from: Date.parse("2026-09-14T06:21:03Z"),
      to: Date.parse("2026-09-14T06:26:41Z"),
      entries: [{ at: Date.parse("2026-09-14T06:26:41Z"), outbound: 900, lost: 0, peaks: {} }],
    },
    errors: [],
  };
  const groups = [group("rigline", line("tables loaded", "pass", "2.1.270"))];

  it("leads with the facts a stranger needs before any check line", () => {
    const text = formatReport(facts, groups);
    expect(text.split("\n")[0]).toBe("rigline report");
    expect(text).toContain("2.1.270, surface editor");
    expect(text).toContain("6 active, 1 re-placed, 0 lost, on commit");
    expect(text).toContain("14 writes");
    expect(text).not.toContain("ignored");
  });

  it("names a renderer the host ignored, since that is a plugin carrying its own React", () => {
    const text = formatReport({ ...facts, react: { ...facts.react, foreign: 1 } }, groups);
    expect(text).toContain("92 notified, 1 other renderer(s) ignored");
  });

  it("reads a meter that has gone quiet as zero, not as its last burst", () => {
    // `recent` is the last window that *closed*, and only a new event closes one — so a meter
    // that stops firing keeps its last value for the life of the panel (D53).
    const idle = {
      ...facts,
      at: NOW + 60_000,
      meters: { commit: { peak: 142, peakAt: NOW, recent: 18, recentAt: NOW } },
    };
    expect(formatReport(idle, groups)).toContain("now 0/s");
    // The peak is untouched: what it got to is a fact about the session, not about this second.
    expect(formatReport(idle, groups)).toContain("142/s");
  });

  it("reads a meter still firing as its real rate", () => {
    expect(formatReport(facts, groups)).toContain("now 3/s");
  });

  it("ranks peaks by how busy they got and omits the ones that never fired", () => {
    const text = formatReport(facts, groups);
    const commit = text.indexOf("commit ");
    const sweep = text.indexOf("sweep ");
    expect(commit).toBeGreaterThan(-1);
    expect(commit).toBeLessThan(sweep);
    expect(text).not.toContain("resend ");
  });

  it("carries the check lines grouped by contributor", () => {
    const text = formatReport(facts, [
      ...groups,
      group("time-marks", line("marks are being placed", "fail", "no rows carried a time")),
    ]);
    expect(text).toContain("time-marks  (1 failing)");
    expect(text).toContain("FAIL  marks are being placed");
  });

  // Nothing else in the report says why a decoration a person is looking for is not on screen.
  it("names what a loaded plugin is going without", () => {
    const text = formatReport(
      {
        ...facts,
        plugins: [{ name: "session-id", status: "loaded", missingOptional: ["anchor x is gone"] }],
      },
      groups,
    );
    expect(text).toContain("without anchor x is gone");
  });

  it("carries every plugin's rewrite counts, and no block when nothing rewrites", () => {
    expect(formatReport(facts, groups)).not.toContain("rewrites");
    const text = formatReport(
      {
        ...facts,
        rewrites: [{ plugin: "worktree", type: "rename_tab", ran: 4, applied: 3, missed: 1 }],
      },
      groups,
    );
    expect(text).toContain("rewrites\n  worktree         rename_tab: ran 4, applied 3, missed 1");
  });

  it("includes the previous run's tail, which is the whole reason it is persisted", () => {
    expect(formatReport(facts, groups)).toContain("previous run (");
    expect(formatReport(facts, groups)).toContain("outbound=900");
  });

  it("says so plainly when there are no host errors", () => {
    expect(formatReport(facts, groups)).toContain("host errors (0)");
    expect(formatReport(facts, groups)).toContain("(none)");
  });

  it("still reports when storage was unavailable and nothing has been counted", () => {
    const bare = {
      ...facts,
      storage: { ...facts.storage, available: false },
      at: NOW,
      meters: {},
      previous: null,
    };
    const text = formatReport(bare, groups);
    expect(text).toContain("storage    unavailable");
    expect(text).toContain("(nothing has been counted yet)");
    expect(text).not.toContain("previous run (");
  });
});
