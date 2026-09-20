/**
 * The verdict logic behind every line the host contributes under `core`.
 *
 * Pure functions over plain data, so a verdict is arguable without a browser and without the
 * kernel. What wires them to diagnostics and to the kernel's services is in checks.ts and in each
 * capability module, and is exercised by the harness against the real bundle.
 */
import { describe, expect, it } from "vitest";
import {
  acquireVerdict,
  anchorsResolveVerdict,
  anchorUniqueVerdict,
  bufferSealedVerdict,
  busTrafficVerdict,
  hostErrorsVerdict,
  mountReplacementVerdict,
  mountsInPlaceVerdict,
  pluginStatusVerdict,
  preHookOrderVerdict,
  reactVerdict,
  sessionIdVerdict,
  stylesheetsVerdict,
  tablesLoadedVerdict,
  toolCallsVerdict,
  transcriptVerdict,
  watchesFoundVerdict,
} from "../src/kernel/verdicts.ts";

describe("preHookOrderVerdict", () => {
  it("is n/a while either child count is -1", () => {
    expect(preHookOrderVerdict(-1, 3).verdict).toBe("n/a");
    expect(preHookOrderVerdict(0, -1).verdict).toBe("n/a");
    expect(preHookOrderVerdict(0, null).verdict).toBe("n/a");
  });

  it("passes when the root was empty at pre and non-empty at post", () => {
    expect(preHookOrderVerdict(0, 1)).toEqual({ verdict: "pass", detail: "#root kids 0 -> 1" });
  });

  it("fails when the root already had children at pre", () => {
    expect(preHookOrderVerdict(2, 3).verdict).toBe("fail");
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
    expect(busTrafficVerdict(3, 4).verdict).toBe("pass");
    expect(busTrafficVerdict(0, 4).verdict).toBe("fail");
    expect(busTrafficVerdict(3, 0).verdict).toBe("fail");
  });
});

describe("bufferSealedVerdict", () => {
  it("passes when sealed", () => {
    expect(bufferSealedVerdict(true, 12)).toEqual({ verdict: "pass", detail: "buffered=12" });
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
      { name: "a", status: "loaded" },
      { name: "b", status: "inactive", reason: "not for the sidebar surface" },
    ]);
    expect(result.verdict).toBe("pass");
    expect(result.detail).toContain("2 plugin(s)");
  });

  it("fails and names every refused or error entry with its reason", () => {
    const result = pluginStatusVerdict([
      { name: "a", status: "loaded" },
      { name: "b", status: "refused", reason: "anchor gone" },
      { name: "c", status: "error", reason: "setup() threw" },
    ]);
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("b refused: anchor gone");
    expect(result.detail).toContain("c error: setup() threw");
  });

  it("passes vacuously with no plugins", () => {
    expect(pluginStatusVerdict([]).verdict).toBe("pass");
  });

  // The silent case the panel had no line for: the plugin works, one of its decorations does not
  // appear, and going without is exactly what an optional declaration means (D41).
  it("names a loaded plugin going without an optional declaration, without failing it", () => {
    const result = pluginStatusVerdict([
      { name: "session-id", status: "loaded", missingOptional: ["anchor footerMenuItem is gone"] },
    ]);
    expect(result.verdict).toBe("pass");
    expect(result.detail).toContain("session-id without 1");
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
    const known = reactVerdict({ hook: "installed", version: "19.1.0", commits: 4, notified: 2 });
    expect(known.verdict).toBe("pass");
    expect(known.detail).toContain("19.1.0");
    const unknown = reactVerdict({ hook: "chained", version: null, commits: 0, notified: 0 });
    expect(unknown.verdict).toBe("fail");
    expect(unknown.detail).toContain("no version");
  });
});

describe("anchorsResolveVerdict", () => {
  it("passes when every entry in the table resolved", () => {
    const result = anchorsResolveVerdict({ modelPill: "modelPill_a", footerSpacer: "sp_b" }, {});
    expect(result).toEqual({ verdict: "pass", detail: "2 of 2" });
  });

  // The repair path starts at this line: an entry that stopped resolving is the shipped table
  // having expired for this version, and ~/.rigline/anchors.json fixes it without a release (D44).
  it("fails and names the anchors that did not, with the harvest's own reason", () => {
    const result = anchorsResolveVerdict(
      { modelPill: "modelPill_a", footerSpacer: null },
      { footerSpacer: "no module defines it" },
    );
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("1 of 2");
    expect(result.detail).toContain("footerSpacer (no module defines it)");
  });

  it("caps the naming at three and counts the rest", () => {
    const result = anchorsResolveVerdict({ a: null, b: null, c: null, d: null, e: null }, {});
    expect(result.detail).toContain("and 2 more");
  });

  it("fails on an empty table rather than passing vacuously", () => {
    expect(anchorsResolveVerdict({}, {}).verdict).toBe("fail");
  });
});

describe("mountsInPlaceVerdict", () => {
  const live = { owner: "probe", anchorConnected: true, positioned: true, abandoned: false };

  it("is n/a when no mount has a live anchor, which is the app's business and not a fault", () => {
    expect(mountsInPlaceVerdict([{ ...live, anchorConnected: false }]).verdict).toBe("n/a");
    expect(mountsInPlaceVerdict([]).verdict).toBe("n/a");
  });

  it("passes when every live mount is where the service means it to be", () => {
    expect(mountsInPlaceVerdict([live, { ...live, owner: "time-marks" }])).toEqual({
      verdict: "pass",
      detail: "2 in place",
    });
  });

  it("fails and names the owners of anything out of position", () => {
    const result = mountsInPlaceVerdict([
      live,
      { ...live, owner: "time-marks", positioned: false },
    ]);
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("1 of 2 out of place: time-marks");
  });

  // An abandoned mount has already been reported by name through mountReplacementVerdict (D54).
  // Counting it here too would render one decision as two red lines.
  it("leaves an abandoned mount to the re-placement check", () => {
    expect(mountsInPlaceVerdict([{ ...live, positioned: false, abandoned: true }]).verdict).toBe(
      "n/a",
    );
  });
});

describe("watchesFoundVerdict", () => {
  const found = { owner: "session-id", anchor: "footerSpacer", found: true, abandoned: false };

  it("is n/a when nothing is watching", () => {
    expect(watchesFoundVerdict([]).verdict).toBe("n/a");
  });

  it("passes when every watch has an element", () => {
    expect(watchesFoundVerdict([found])).toEqual({ verdict: "pass", detail: "1 anchored" });
  });

  it("fails and names plugin and anchor, which is where somebody has to go and look", () => {
    const result = watchesFoundVerdict([found, { ...found, owner: "time-marks", found: false }]);
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("time-marks/footerSpacer");
  });
});

describe("stylesheetsVerdict", () => {
  it("is n/a when no plugin asked for one", () => {
    expect(stylesheetsVerdict([]).verdict).toBe("n/a");
  });

  it("passes when every sheet is still in the document", () => {
    expect(stylesheetsVerdict([{ owner: "probe", present: true }]).verdict).toBe("pass");
  });

  it("fails and names the owner of a sheet something removed", () => {
    const result = stylesheetsVerdict([
      { owner: "probe", present: true },
      { owner: "time-marks", present: false },
    ]);
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("time-marks");
  });
});

describe("toolCallsVerdict", () => {
  it("says so when no plugin on this surface uses tool calls at all", () => {
    expect(toolCallsVerdict(false, 0, null).detail).toContain("no plugin here");
  });

  it("is n/a until a tool call has been seen", () => {
    expect(toolCallsVerdict(true, 0, null).verdict).toBe("n/a");
  });

  it("passes with the count and last name once seen", () => {
    const result = toolCallsVerdict(true, 3, "Read");
    expect(result.verdict).toBe("pass");
    expect(result.detail).toContain('last "Read"');
  });
});

describe("sessionIdVerdict", () => {
  it("distinguishes nobody asking from nobody answering", () => {
    expect(sessionIdVerdict(false, null).detail).toContain("no plugin here");
    expect(sessionIdVerdict(true, null).detail).toBe("no session");
  });

  it("passes with the first 8 characters", () => {
    expect(sessionIdVerdict(true, "abcdefgh-1234")).toEqual({
      verdict: "pass",
      detail: "abcdefgh",
    });
  });
});

describe("transcriptVerdict", () => {
  it("is n/a with nobody decorating, or with no rows yet", () => {
    expect(transcriptVerdict(false, 0, 0, null).detail).toContain("no plugin here");
    expect(transcriptVerdict(true, 0, 0, null).verdict).toBe("n/a");
  });

  it("passes once anything is timed", () => {
    expect(transcriptVerdict(true, 12, 9, null).verdict).toBe("pass");
  });

  it("stays n/a while untimed rows are still young", () => {
    expect(transcriptVerdict(true, 12, 0, 1200).verdict).toBe("n/a");
  });

  it("fails only past the five-second mark with nothing timed", () => {
    const result = transcriptVerdict(true, 12, 0, 9000);
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("9000ms");
  });
});

describe("mountReplacementVerdict", () => {
  it("is n/a when nothing has had to be put back or moved", () => {
    expect(mountReplacementVerdict("commit", 4, 0, 0, 0)).toEqual({
      verdict: "n/a",
      detail: "nothing detached or moved yet, 4 active, on commit",
    });
  });

  it("passes when a re-placement happened, because that is the mechanism working", () => {
    const result = mountReplacementVerdict("commit", 4, 2, 0, 0);
    expect(result.verdict).toBe("pass");
    expect(result.detail).toContain("2 re-placed");
  });

  it("reports drift separately from re-placement, since they answer different questions", () => {
    const result = mountReplacementVerdict("commit", 4, 0, 3, 0);
    expect(result.verdict).toBe("pass");
    expect(result.detail).toContain("3 moved");
    expect(result.detail).not.toContain("re-placed");
  });

  it("fails on a mount left detached from an anchor that is still there", () => {
    expect(mountReplacementVerdict("commit", 4, 1, 0, 2).verdict).toBe("fail");
  });

  // D54: the name, not a count. A count says how bad; the name says which plugin and which anchor.
  it("outranks everything else with an abandoned mount, by name", () => {
    const result = mountReplacementVerdict("commit", 4, 9, 0, 2, ["time-marks: the mount before"]);
    expect(result.verdict).toBe("fail");
    expect(result.detail).toContain("gave up on time-marks: the mount before");
  });

  it("names the driver, so the observer fallback is never silent", () => {
    expect(mountReplacementVerdict("observer", 1, 0, 0, 0).detail).toContain("on observer");
  });
});

describe("anchorUniqueVerdict", () => {
  it("passes on an empty record, because that is a measurement and not an absence of one", () => {
    expect(anchorUniqueVerdict({})).toEqual({ verdict: "pass", detail: "one element each" });
  });

  it("fails and names the anchor and the count, which is where somebody has to go and look", () => {
    const result = anchorUniqueVerdict({ modelPill: 2 });
    expect(result.verdict).toBe("fail");
    expect(result.detail).toBe("modelPill matched 2");
  });

  it("names every offender, sorted, rather than only the first", () => {
    expect(anchorUniqueVerdict({ zed: 3, modelPill: 2 }).detail).toBe(
      "modelPill matched 2, zed matched 3",
    );
  });
});
