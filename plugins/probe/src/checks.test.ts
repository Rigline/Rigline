import { describe, expect, it } from "vitest";
import {
  type CheckGroup,
  chainComposeVerdict,
  errorMessage,
  failingCount,
  formatGroups,
  formatLine,
  formatReport,
  immutabilityVerdict,
  leakVerdict,
  rewriteBookkeepingVerdict,
} from "./checks.ts";

/** One group, as the host's registry hands it back. */
function group(contributor: string, ...results: CheckGroup["results"]): CheckGroup {
  return {
    contributor,
    results,
    failing: results.filter((r) => r.verdict === "fail").length,
  };
}

const line = (name: string, verdict: "pass" | "fail" | "n/a", detail = "") => ({
  name,
  verdict,
  detail,
});

describe("formatLine and failingCount", () => {
  it("tags each verdict and keeps the detail after an em dash", () => {
    expect(formatLine(line("x", "pass", "ok"))).toBe("PASS  x — ok");
    expect(formatLine(line("y", "fail", "broken"))).toBe("FAIL  y — broken");
    expect(formatLine(line("z", "n/a", "not yet"))).toBe("N/A   z — not yet");
  });

  it("omits the dash and detail when there is none", () => {
    expect(formatLine(line("x", "pass"))).toBe("PASS  x");
  });

  it("counts only fail, never n/a or pass, across every contributor", () => {
    const groups = [
      group("core", line("a", "pass"), line("b", "fail")),
      group("probe", line("c", "n/a"), line("d", "fail")),
    ];
    expect(failingCount(groups)).toBe(2);
    expect(failingCount([])).toBe(0);
  });
});

describe("formatGroups", () => {
  it("heads each contributor's lines with its name and indents them under it", () => {
    const text = formatGroups([group("core", line("tables loaded", "pass", "2.1.270"))]);
    expect(text).toBe("core\n  PASS  tables loaded — 2.1.270");
  });

  // A count on every header would train the eye to skip it; a header that carries one is itself
  // the finding, which is the same reason the abandoned-mounts line is absent rather than empty.
  it("puts a count on a header only when that contributor has a failure", () => {
    const text = formatGroups([
      group("core", line("a", "pass")),
      group("time-marks", line("b", "fail", "no rows carried a time")),
    ]);
    expect(text.split("\n")[0]).toBe("core");
    expect(text).toContain("time-marks  (1 failing)");
  });

  it("keeps the host's order rather than sorting, so the list cannot move as verdicts change", () => {
    const text = formatGroups([
      group("core", line("a", "pass")),
      group("probe", line("b", "fail")),
    ]);
    expect(text.indexOf("core")).toBeLessThan(text.indexOf("probe"));
  });

  it("says so rather than rendering nothing when no check has been contributed", () => {
    expect(formatGroups([])).toBe("(no checks registered)");
  });
});

describe("errorMessage", () => {
  it("takes an Error's own message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies anything else", () => {
    expect(errorMessage("boom")).toBe("boom");
    expect(errorMessage(7)).toBe("7");
  });
});

describe("immutabilityVerdict", () => {
  it("is n/a until a nested object has been seen", () => {
    expect(immutabilityVerdict(false, false, false).verdict).toBe("n/a");
  });

  it("passes when both levels are frozen", () => {
    expect(immutabilityVerdict(true, true, true)).toEqual({
      verdict: "pass",
      detail: "top+nested",
    });
  });

  it("fails and names which level regressed", () => {
    expect(immutabilityVerdict(true, false, true).detail).toBe("top not frozen");
    expect(immutabilityVerdict(true, true, false).detail).toBe("nested not frozen");
    expect(immutabilityVerdict(true, false, false).detail).toBe("top and nested not frozen");
  });
});

describe("chainComposeVerdict", () => {
  it("is n/a before any rename_tab has crossed", () => {
    expect(chainComposeVerdict(false, false).verdict).toBe("n/a");
  });

  it("fails when the chain ran but the second rewriter never saw the mark", () => {
    expect(chainComposeVerdict(true, false).verdict).toBe("fail");
  });

  it("passes and latches once composition has been observed", () => {
    expect(chainComposeVerdict(true, true).verdict).toBe("pass");
    expect(chainComposeVerdict(false, true).verdict).toBe("pass");
  });
});

describe("leakVerdict", () => {
  it("is n/a until a rename_tab has been tapped", () => {
    expect(leakVerdict(false, false, null).verdict).toBe("n/a");
  });

  it("passes when the tap never saw the mark", () => {
    expect(leakVerdict(true, false, "Refactor the bus")).toEqual({
      verdict: "pass",
      detail: "clean",
    });
  });

  it("fails and names the leaked title when the mark reached the wire", () => {
    const result = leakVerdict(true, true, "[rigline-probe] Refactor the bus");
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("[rigline-probe]");
  });
});

describe("rewriteBookkeepingVerdict", () => {
  it("passes with exactly two entries for this plugin", () => {
    const result = rewriteBookkeepingVerdict(
      [
        { plugin: "probe", type: "rename_tab", applied: 3, ran: 4, missed: 1 },
        { plugin: "probe", type: "rename_tab", applied: 3, ran: 4, missed: 1 },
        { plugin: "worktree-prefix", type: "rename_tab", applied: 4, ran: 4, missed: 1 },
      ],
      "probe",
    );
    expect(result.verdict).toBe("pass");
    expect(result.detail).toContain("ran=4 applied=3 missed=1");
  });

  it("fails when the count is not exactly two", () => {
    expect(rewriteBookkeepingVerdict([], "probe").verdict).toBe("fail");
  });
});

describe("formatReport", () => {
  const NOW = Date.parse("2026-09-14T06:26:41Z");
  const facts = {
    extension: "2.1.270",
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
    plugins: [{ name: "session-id", status: "loaded" as const }],
    hostPatches: [{ plugin: "worktree-prefix", applied: true, required: false }],
    previous: {
      from: Date.parse("2026-09-14T06:21:03Z"),
      to: Date.parse("2026-09-14T06:26:41Z"),
      entries: [{ at: Date.parse("2026-09-14T06:26:41Z"), outbound: 900, lost: 0, peaks: {} }],
    },
    errors: [],
  };
  const groups = [group("core", line("tables loaded", "pass", "2.1.270"))];

  it("leads with the facts a stranger needs before any check line", () => {
    const text = formatReport(facts, groups);
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
    // that stops firing keeps its last value for the life of the panel. Read straight, a boot
    // burst is still being reported as sustained load an hour later, which is the misreading the
    // rates exist to end (D53).
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
        plugins: [
          { name: "session-id", status: "loaded" as const, missingOptional: ["anchor x is gone"] },
        ],
      },
      groups,
    );
    expect(text).toContain("without anchor x is gone");
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
