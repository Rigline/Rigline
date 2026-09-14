import { describe, expect, it } from "vitest";
import {
  acquireVerdict,
  anchorResolvesVerdict,
  anchorUniqueVerdict,
  bufferSealedVerdict,
  busTrafficVerdict,
  chainComposeVerdict,
  errorMessage,
  failingCount,
  formatLine,
  formatReport,
  hostErrorsVerdict,
  immutabilityVerdict,
  leakVerdict,
  mountOrderVerdict,
  mountReplacementVerdict,
  mountSurvivesVerdict,
  pluginStatusVerdict,
  preHookOrderVerdict,
  reactVerdict,
  rewriteBookkeepingVerdict,
  sessionIdVerdict,
  stylesheetVerdict,
  tablesLoadedVerdict,
  toolCallsVerdict,
  transcriptVerdict,
} from "./checks.ts";

describe("formatLine and failingCount", () => {
  it("tags each verdict and keeps the detail after an em dash", () => {
    expect(formatLine({ name: "x", verdict: "pass", detail: "ok" })).toBe("PASS  x — ok");
    expect(formatLine({ name: "y", verdict: "fail", detail: "broken" })).toBe("FAIL  y — broken");
    expect(formatLine({ name: "z", verdict: "n/a", detail: "not yet" })).toBe("N/A   z — not yet");
  });

  it("omits the dash and detail when there is none", () => {
    expect(formatLine({ name: "x", verdict: "pass", detail: "" })).toBe("PASS  x");
  });

  it("counts only fail, never n/a or pass", () => {
    const checks = [
      { name: "a", verdict: "pass", detail: "" },
      { name: "b", verdict: "fail", detail: "" },
      { name: "c", verdict: "n/a", detail: "" },
      { name: "d", verdict: "fail", detail: "" },
    ] as const;
    expect(failingCount(checks)).toBe(2);
  });
});

describe("errorMessage", () => {
  it("takes an Error's own message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies anything else", () => {
    expect(errorMessage("boom")).toBe("boom");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("preHookOrderVerdict", () => {
  it("is n/a while either child count is -1", () => {
    expect(preHookOrderVerdict(-1, null).verdict).toBe("n/a");
    expect(preHookOrderVerdict(-1, 3).verdict).toBe("n/a");
    expect(preHookOrderVerdict(0, -1).verdict).toBe("n/a");
  });

  it("passes when the root was empty at pre and non-empty at post", () => {
    expect(preHookOrderVerdict(0, 5).verdict).toBe("pass");
  });

  it("fails when the root already had children at pre", () => {
    expect(preHookOrderVerdict(2, 5).verdict).toBe("fail");
  });

  it("fails when the root is still empty at post", () => {
    expect(preHookOrderVerdict(0, 0).verdict).toBe("fail");
  });
});

describe("acquireVerdict", () => {
  it("passes only when both wrapped and called", () => {
    expect(acquireVerdict(true, true).verdict).toBe("pass");
    expect(acquireVerdict(true, false).verdict).toBe("fail");
    expect(acquireVerdict(false, true).verdict).toBe("fail");
  });
});

describe("busTrafficVerdict", () => {
  it("requires traffic in both directions", () => {
    expect(busTrafficVerdict(1, 1).verdict).toBe("pass");
    expect(busTrafficVerdict(0, 1).verdict).toBe("fail");
    expect(busTrafficVerdict(1, 0).verdict).toBe("fail");
  });
});

describe("bufferSealedVerdict", () => {
  it("passes when sealed", () => {
    expect(bufferSealedVerdict(true, 12).verdict).toBe("pass");
    expect(bufferSealedVerdict(false, 12).verdict).toBe("fail");
  });
});

describe("tablesLoadedVerdict", () => {
  it("passes with a version string, fails on null", () => {
    expect(tablesLoadedVerdict("2.1.270")).toEqual({ verdict: "pass", detail: "2.1.270" });
    expect(tablesLoadedVerdict(null).verdict).toBe("fail");
  });
});

describe("pluginStatusVerdict", () => {
  it("passes when every plugin loaded or is inactive", () => {
    const result = pluginStatusVerdict([
      { name: "probe", status: "loaded" },
      { name: "other", status: "inactive", reason: "not for this surface" },
    ]);
    expect(result.verdict).toBe("pass");
  });

  it("fails and names every refused or error entry with its reason", () => {
    const result = pluginStatusVerdict([
      { name: "probe", status: "loaded" },
      { name: "bad-anchor", status: "refused", reason: "anchor gone" },
      { name: "broken", status: "error", reason: "setup() threw: boom" },
    ]);
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("bad-anchor refused: anchor gone");
    expect(result.detail).toContain("broken error: setup() threw: boom");
  });

  it("passes vacuously with no plugins", () => {
    expect(pluginStatusVerdict([]).verdict).toBe("pass");
  });
});

describe("hostErrorsVerdict", () => {
  it("passes with no errors", () => {
    expect(hostErrorsVerdict([])).toEqual({ verdict: "pass", detail: "0" });
  });

  it("fails and lists up to three", () => {
    const result = hostErrorsVerdict(["a", "b", "c", "d"]);
    expect(result.verdict).toBe("fail");
    expect(result.detail).toBe("a; b; c");
  });
});

describe("reactVerdict", () => {
  it("passes only once a version is known", () => {
    expect(
      reactVerdict({ hook: "installed", version: "19.0.0", commits: 3, notified: 3 }).verdict,
    ).toBe("pass");
    expect(
      reactVerdict({ hook: "installed", version: null, commits: 0, notified: 0 }).verdict,
    ).toBe("fail");
  });
});

describe("immutabilityVerdict", () => {
  it("is n/a until a nested object has been seen", () => {
    expect(immutabilityVerdict(false, true, true).verdict).toBe("n/a");
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

describe("anchorResolvesVerdict", () => {
  it("passes with a resolved class", () => {
    expect(anchorResolvesVerdict("modelPill_gGYT1w", null)).toEqual({
      verdict: "pass",
      detail: "modelPill_gGYT1w",
    });
  });

  it("fails on an empty resolution or a throw", () => {
    expect(anchorResolvesVerdict("", null).verdict).toBe("fail");
    expect(anchorResolvesVerdict(null, "anchor gone").verdict).toBe("fail");
  });
});

describe("mountSurvivesVerdict", () => {
  it("is n/a before the first mount", () => {
    expect(mountSurvivesVerdict(false, false).verdict).toBe("n/a");
  });

  it("reflects the current node's connectedness once mounted", () => {
    expect(mountSurvivesVerdict(true, true).verdict).toBe("pass");
    expect(mountSurvivesVerdict(true, false).verdict).toBe("fail");
  });
});

describe("mountOrderVerdict", () => {
  it("is n/a with fewer than two nodes on the anchor", () => {
    expect(mountOrderVerdict([]).verdict).toBe("n/a");
    expect(mountOrderVerdict([2]).verdict).toBe("n/a");
  });

  it("passes when registry indices are non-decreasing", () => {
    expect(mountOrderVerdict([0, 1, 1, 4]).verdict).toBe("pass");
  });

  it("fails when a later DOM sibling has an earlier registry index", () => {
    expect(mountOrderVerdict([3, 1]).verdict).toBe("fail");
  });
});

describe("mountOrderVerdict, drift", () => {
  it("fails when our own mount is on screen but nothing sits beside the anchor", () => {
    const { verdict, detail } = mountOrderVerdict([], true);
    expect(verdict).toBe("fail");
    expect(detail).toContain("drifted");
  });

  it("stays n/a when nothing of ours is mounted to have drifted", () => {
    expect(mountOrderVerdict([], false).verdict).toBe("n/a");
  });

  it("still checks ordering once there are siblings to order", () => {
    expect(mountOrderVerdict([0, 1], true).verdict).toBe("pass");
    expect(mountOrderVerdict([3, 1], true).verdict).toBe("fail");
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
    // Once composed, later traffic that happens not to cross again cannot un-observe it.
    expect(chainComposeVerdict(false, true).verdict).toBe("pass");
  });
});

describe("leakVerdict", () => {
  it("is n/a until a rename_tab has been tapped", () => {
    expect(leakVerdict(false, false, null).verdict).toBe("n/a");
  });

  it("passes when the tap never saw the mark", () => {
    expect(leakVerdict(true, false, "My Session").verdict).toBe("pass");
  });

  it("fails and names the leaked title when the mark reached the wire", () => {
    const result = leakVerdict(true, true, "[rigline-probe] My Session");
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("[rigline-probe] My Session");
  });
});

describe("rewriteBookkeepingVerdict", () => {
  it("passes with exactly two entries for this plugin", () => {
    const result = rewriteBookkeepingVerdict(
      [
        { plugin: "probe", type: "rename_tab", applied: 2, ran: 4, missed: 0 },
        { plugin: "probe", type: "rename_tab", applied: 1, ran: 4, missed: 1 },
        { plugin: "other", type: "rename_tab", applied: 1, ran: 1, missed: 0 },
      ],
      "probe",
    );
    expect(result.verdict).toBe("pass");
    expect(result.detail).toContain("ran=4 applied=2 missed=0");
  });

  it("fails when the count is not exactly two", () => {
    expect(rewriteBookkeepingVerdict([], "probe").verdict).toBe("fail");
  });
});

describe("toolCallsVerdict", () => {
  it("is n/a until a tool call has been seen", () => {
    expect(toolCallsVerdict(0, null).verdict).toBe("n/a");
  });

  it("passes with the count and last name once seen", () => {
    const result = toolCallsVerdict(3, "Read");
    expect(result.verdict).toBe("pass");
    expect(result.detail).toBe('3 seen, last "Read"');
  });
});

describe("sessionIdVerdict", () => {
  it("is n/a while null", () => {
    expect(sessionIdVerdict(null).verdict).toBe("n/a");
  });

  it("passes with the first 8 characters", () => {
    expect(sessionIdVerdict("abcdefgh-ijkl").detail).toBe("abcdefgh");
  });
});

describe("transcriptVerdict", () => {
  it("is n/a with no rows yet", () => {
    expect(transcriptVerdict(0, 0, null).verdict).toBe("n/a");
  });

  it("passes once anything is timed", () => {
    expect(transcriptVerdict(5, 2, 9000).verdict).toBe("pass");
  });

  it("stays n/a while untimed rows are still young", () => {
    expect(transcriptVerdict(5, 0, 1000).verdict).toBe("n/a");
  });

  it("fails only past the five-second mark with nothing timed", () => {
    expect(transcriptVerdict(5, 0, 5001).verdict).toBe("fail");
  });
});

describe("stylesheetVerdict", () => {
  it("reflects whether the host-managed stylesheet is present", () => {
    expect(stylesheetVerdict(true).verdict).toBe("pass");
    expect(stylesheetVerdict(false).verdict).toBe("fail");
  });
});

describe("mountReplacementVerdict", () => {
  it("is n/a when nothing has had to be put back or moved", () => {
    const { verdict, detail } = mountReplacementVerdict("commit", 12, 0, 0, 0);
    expect(verdict).toBe("n/a");
    expect(detail).toContain("12 active");
  });

  it("passes when a re-placement happened, because that is the mechanism working", () => {
    const { verdict, detail } = mountReplacementVerdict("commit", 12, 3, 0, 0);
    expect(verdict).toBe("pass");
    expect(detail).toContain("3 re-placed");
  });

  it("reports drift separately from re-placement, since they answer different questions", () => {
    const { verdict, detail } = mountReplacementVerdict("commit", 12, 0, 7, 0);
    expect(verdict).toBe("pass");
    expect(detail).toContain("7 moved");
    expect(detail).not.toContain("re-placed");
    expect(mountReplacementVerdict("commit", 12, 3, 7, 0).detail).toContain("3 re-placed, 7 moved");
  });

  it("fails on a mount left detached from an anchor that is still there", () => {
    expect(mountReplacementVerdict("commit", 12, 3, 0, 1).verdict).toBe("fail");
  });

  it("names the driver, so the observer fallback is never silent", () => {
    expect(mountReplacementVerdict("observer", 1, 0, 0, 0).detail).toContain("observer");
  });
});

describe("anchorUniqueVerdict", () => {
  it("passes on an empty record, because that is a measurement and not an absence of one", () => {
    const { verdict, detail } = anchorUniqueVerdict({});
    expect(verdict).toBe("pass");
    expect(detail).toBe("one element each");
  });

  it("fails and names the anchor and the count, which is where somebody has to go and look", () => {
    const { verdict, detail } = anchorUniqueVerdict({ modelPill: 2 });
    expect(verdict).toBe("fail");
    expect(detail).toBe("modelPill matched 2");
  });

  it("names every offender, sorted, rather than only the first", () => {
    expect(anchorUniqueVerdict({ modelPill: 3, composer: 2 }).detail).toBe(
      "composer matched 2, modelPill matched 3",
    );
  });
});

describe("formatReport", () => {
  const facts = {
    extension: "2.1.270",
    surface: "editor",
    preAt: 12,
    postAt: 486,
    react: { hook: "installed", version: "19.1.0", commits: 4821, notified: 92 },
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
    meters: {
      commit: { peak: 142, peakAt: Date.parse("2026-09-14T06:26:38Z"), recent: 3 },
      sweep: { peak: 12, peakAt: Date.parse("2026-09-14T06:26:38Z"), recent: 0 },
      resend: { peak: 0, peakAt: null, recent: 0 },
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
  const checks = [{ name: "tables loaded", verdict: "pass" as const, detail: "2.1.270" }];

  it("leads with the facts a stranger needs before any check line", () => {
    const text = formatReport(facts, checks);
    expect(text).toContain("2.1.270, surface editor");
    expect(text).toContain("6 active, 1 re-placed, 0 lost, on commit");
    expect(text).toContain("14 writes");
  });

  it("ranks peaks by how busy they got and omits the ones that never fired", () => {
    const text = formatReport(facts, checks);
    const commit = text.indexOf("commit ");
    const sweep = text.indexOf("sweep ");
    expect(commit).toBeGreaterThan(-1);
    expect(commit).toBeLessThan(sweep);
    expect(text).not.toContain("resend ");
  });

  it("includes the previous run's tail, which is the whole reason it is persisted", () => {
    expect(formatReport(facts, checks)).toContain("previous run (");
    expect(formatReport(facts, checks)).toContain("outbound=900");
  });

  it("says so plainly when there are no host errors", () => {
    expect(formatReport(facts, checks)).toContain("host errors (0)");
    expect(formatReport(facts, checks)).toContain("(none)");
  });

  it("still reports when storage was unavailable and nothing has been counted", () => {
    const bare = {
      ...facts,
      storage: { ...facts.storage, available: false },
      meters: {},
      previous: null,
    };
    const text = formatReport(bare, checks);
    expect(text).toContain("storage    unavailable");
    expect(text).toContain("(nothing has been counted yet)");
    expect(text).not.toContain("previous run (");
  });
});
