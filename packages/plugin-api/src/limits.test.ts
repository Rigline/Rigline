/**
 * The plan's usage windows, merged and read as the panel does. `panel_usage_update`'s type is
 * harvested and its body is not, so these tests are what pins the body.
 */

import { describe, expect, it } from "vitest";
import {
  identityChanged,
  identityOf,
  limitsAt,
  mergeWindows,
  nextReset,
  type RawWindows,
} from "./limits.ts";

const update = (unifiedWindows: unknown) => ({ type: "panel_usage_update", unifiedWindows });

const NOW = 1_800_000_000_000;
const IN_AN_HOUR = NOW / 1000 + 3600;
const IN_A_DAY = NOW / 1000 + 86_400;

describe("mergeWindows", () => {
  it("takes the windows an update states", () => {
    const merged = mergeWindows(
      {},
      update({
        five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR },
        seven_day: { utilization: 0.18, resetsAt: IN_A_DAY },
      }),
    );
    expect(merged).toEqual({
      five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR },
      seven_day: { utilization: 0.18, resetsAt: IN_A_DAY },
    });
  });

  it("keeps a window the update leaves out, and deletes one it sends as null", () => {
    const current: RawWindows = {
      five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR },
      seven_day: { utilization: 0.18, resetsAt: IN_A_DAY },
    };
    expect(mergeWindows(current, update({ five_hour: null }))).toEqual({
      seven_day: { utilization: 0.18, resetsAt: IN_A_DAY },
    });
  });

  it("never replaces a window that has a reset time with one that has none", () => {
    const current: RawWindows = { five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR } };
    expect(mergeWindows(current, update({ five_hour: { utilization: 0.5 } }))).toBe(current);
    expect(mergeWindows({}, update({ five_hour: { utilization: 0.5 } }))).toEqual({
      five_hour: { utilization: 0.5, resetsAt: null },
    });
  });

  it("returns the same windows for an update that changes nothing", () => {
    const current: RawWindows = { five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR } };
    expect(mergeWindows(current, update({}))).toBe(current);
    expect(mergeWindows(current, update({ seven_day: null }))).toBe(current);
    expect(mergeWindows(current, update(null))).toBe(current);
    expect(mergeWindows(current, update({ five_hour: { utilization: "lots" } }))).toBe(current);
  });

  it("ignores the window it does not expose", () => {
    const merged = mergeWindows(
      {},
      update({ seven_day_overage_included: { utilization: 0.9, resetsAt: IN_A_DAY } }),
    );
    expect(merged).toEqual({});
  });
});

describe("limitsAt", () => {
  it("reads each window's use and its reset in milliseconds", () => {
    const raw: RawWindows = { five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR } };
    expect(limitsAt(raw, NOW)).toEqual({
      fiveHour: { used: 0.42, resetsAt: IN_AN_HOUR * 1000 },
      sevenDay: null,
    });
  });

  it("reads a window past its reset as unused, as the panel's bars do", () => {
    const raw: RawWindows = { five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR } };
    expect(limitsAt(raw, IN_AN_HOUR * 1000).fiveHour).toEqual({ used: 0, resetsAt: null });
  });
});

describe("nextReset", () => {
  it("is the earliest reset still to come", () => {
    const raw: RawWindows = {
      five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR },
      seven_day: { utilization: 0.18, resetsAt: IN_A_DAY },
    };
    expect(nextReset(raw, NOW)).toBe(IN_AN_HOUR * 1000);
    expect(nextReset(raw, IN_AN_HOUR * 1000)).toBe(IN_A_DAY * 1000);
    expect(nextReset(raw, IN_A_DAY * 1000)).toBeNull();
    expect(nextReset({ five_hour: { utilization: 0.1, resetsAt: null } }, NOW)).toBeNull();
  });
});

describe("identity", () => {
  it("tells accounts apart as the panel does", () => {
    expect(identityOf({ authMethod: "claudeai", email: "a@example.com" })).toBe("a@example.com");
    expect(identityOf({ authMethod: "3p", email: null })).toBe("3p");
    expect(identityOf({ authMethod: "api-key", email: null })).toBeUndefined();
    expect(identityOf(null)).toBeNull();
  });

  it("changes only from one known identity to anything else", () => {
    expect(identityChanged("a@example.com", "b@example.com")).toBe(true);
    expect(identityChanged("a@example.com", null)).toBe(true);
    expect(identityChanged("a@example.com", "a@example.com")).toBe(false);
    expect(identityChanged("a@example.com", undefined)).toBe(false);
    expect(identityChanged(null, "a@example.com")).toBe(false);
    expect(identityChanged(undefined, "a@example.com")).toBe(false);
  });
});
