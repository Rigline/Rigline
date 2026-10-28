import { describe, expect, it } from "vitest";
import { ciGate } from "./ci.mjs";

const SHA = "1012343abcdef";

describe("ciGate", () => {
  it("carries on only on green", () => {
    expect(ciGate("success", SHA)).toEqual({ action: "proceed" });
  });

  it("waits for a run that has not finished", () => {
    expect(ciGate("queued", SHA)).toEqual({ action: "wait" });
    expect(ciGate("in_progress", SHA)).toEqual({ action: "wait" });
  });

  it("refuses a commit CI never saw, which is one that was never pushed", () => {
    const gate = ciGate("no run", SHA);
    expect(gate.action).toBe("refuse");
    expect(gate.reason).toContain("Push it");
  });

  it("refuses without gh rather than releasing unchecked", () => {
    expect(ciGate("gh unavailable", SHA).reason).toContain("gh auth login");
  });

  it("refuses every finished run that is not green", () => {
    for (const verdict of ["failure", "cancelled", "timed_out", "startup_failure"]) {
      const gate = ciGate(verdict, SHA);
      expect(gate.action, verdict).toBe("refuse");
      expect(gate.reason, verdict).toContain("1012343a");
    }
  });
});
