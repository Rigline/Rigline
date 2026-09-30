import { describe, expect, it } from "vitest";
import { chainComposeVerdict, errorMessage, immutabilityVerdict, leakVerdict } from "./checks.ts";

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
    expect(leakVerdict(false, false).verdict).toBe("n/a");
  });

  it("passes when the tap never saw the mark", () => {
    expect(leakVerdict(true, false)).toEqual({ verdict: "pass", detail: "clean" });
  });

  // The title is the session's, and every detail goes into the copied report (D53).
  it("fails without quoting the title when the mark reached the wire", () => {
    expect(leakVerdict(true, true)).toEqual({
      verdict: "fail",
      detail: "a title carried the mark onto the wire",
    });
  });
});
