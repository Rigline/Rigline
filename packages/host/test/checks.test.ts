/**
 * The check registry: what it does with a contributor's answer, and what order it hands the lines
 * back in.
 *
 * The two behaviours here that are decisions rather than plumbing are the ones worth reading: a
 * check that throws produces a failing line and nothing else, and `core` sorts first however late
 * it registered.
 */
import { describe, expect, it } from "vitest";
import { CORE, createCheckService } from "../src/kernel/checks.ts";

const pass = () => ({ verdict: "pass" as const, detail: "fine" });
const fail = () => ({ verdict: "fail" as const, detail: "broken" });

describe("running a check", () => {
  it("carries the verdict and detail through, and defaults an absent detail to empty", () => {
    const checks = createCheckService();
    checks.add("probe", "with detail", pass);
    checks.add("probe", "without detail", () => ({ verdict: "n/a" }));
    const [group] = checks.run();
    expect(group?.results).toEqual([
      { contributor: "probe", name: "with detail", verdict: "pass", detail: "fine" },
      { contributor: "probe", name: "without detail", verdict: "n/a", detail: "" },
    ]);
  });

  /**
   * The decision this file exists to pin. `guard` disables a plugin whose callback throws, because
   * a throw in the app's message flow means the plugin is broken at its job. A throw here means the
   * *diagnostic* is broken — tearing down a working decoration on that evidence would inflict the
   * failure the panel is reporting.
   */
  it("turns a throw into a failing line and does not touch the plugin", () => {
    const checks = createCheckService();
    checks.add("probe", "throws", () => {
      throw new Error("no such element");
    });
    const [group] = checks.run();
    expect(group?.results[0]?.verdict).toBe("fail");
    expect(group?.results[0]?.detail).toBe("check threw: no such element");
  });

  it("treats a malformed return the same way, and says what came back", () => {
    const checks = createCheckService();
    checks.add("probe", "wrong shape", () => ({ verdict: "green" }) as never);
    checks.add("probe", "not an object", (() => "pass") as never);
    const results = checks.run()[0]?.results ?? [];
    expect(results.map((r) => r.verdict)).toEqual(["fail", "fail"]);
    expect(results[0]?.detail).toContain('"green"');
    expect(results[1]?.detail).toContain("not a verdict");
  });

  it("keeps running after one contributor's check has thrown", () => {
    const checks = createCheckService();
    checks.add("probe", "throws", () => {
      throw new Error("x");
    });
    checks.add("probe", "fine", pass);
    expect(checks.run()[0]?.results.map((r) => r.verdict)).toEqual(["fail", "pass"]);
  });
});

describe("grouping and order", () => {
  it("puts core first however late it registered, then first-appearance order", () => {
    const checks = createCheckService();
    checks.add("time-marks", "a", pass);
    checks.add("probe", "b", pass);
    checks.add(CORE, "c", pass);
    checks.add("time-marks", "d", pass);
    expect(checks.run().map((g) => g.contributor)).toEqual([CORE, "time-marks", "probe"]);
  });

  // A check registered later — from a message handler, say — joins its own contributor rather than
  // starting a second group, so the list a person is reading does not reorder underneath them.
  it("keeps a contributor's lines together in registration order", () => {
    const checks = createCheckService();
    checks.add("probe", "first", pass);
    checks.add("time-marks", "other", pass);
    checks.add("probe", "second", pass);
    const probe = checks.run().find((g) => g.contributor === "probe");
    expect(probe?.results.map((r) => r.name)).toEqual(["first", "second"]);
  });

  it("counts the failures in each group, which is what the badge sums", () => {
    const checks = createCheckService();
    checks.add(CORE, "ok", pass);
    checks.add(CORE, "bad", fail);
    checks.add("probe", "also bad", fail);
    expect(checks.run().map((g) => [g.contributor, g.failing])).toEqual([
      [CORE, 1],
      ["probe", 1],
    ]);
  });

  it("returns nothing at all when nothing has been contributed", () => {
    expect(createCheckService().run()).toEqual([]);
  });
});

describe("removal", () => {
  it("takes a check out, and drops the group once it is empty", () => {
    const checks = createCheckService();
    const off = checks.add("probe", "only", pass);
    checks.add(CORE, "kept", pass);
    off();
    expect(checks.run().map((g) => g.contributor)).toEqual([CORE]);
  });

  it("removes every check a contributor added at once through addAll", () => {
    const checks = createCheckService();
    const off = checks.addAll("probe", [
      { name: "a", run: pass },
      { name: "b", run: pass },
    ]);
    expect(checks.run()[0]?.results).toHaveLength(2);
    off();
    expect(checks.run()).toEqual([]);
  });

  // A plugin disabled mid-run splices its own checks out of the array being walked, and a check may
  // register another. Neither may make the walk skip a line or throw.
  it("survives a check that removes one during the run", () => {
    const checks = createCheckService();
    let off = () => {};
    checks.add("probe", "removes the next", () => {
      off();
      return { verdict: "pass" as const };
    });
    off = checks.add("probe", "removed mid-run", pass);
    checks.add("probe", "still reached", pass);
    expect(checks.run()[0]?.results.map((r) => r.name)).toEqual([
      "removes the next",
      "removed mid-run",
      "still reached",
    ]);
  });
});
