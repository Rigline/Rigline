import { describe, expect, it } from "vitest";
import {
  acquireVerdict,
  anchorResolvesVerdict,
  bufferSealedVerdict,
  busTrafficVerdict,
  chainComposeVerdict,
  errorMessage,
  failingCount,
  formatLine,
  hostErrorsVerdict,
  immutabilityVerdict,
  leakVerdict,
  mountOrderVerdict,
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
