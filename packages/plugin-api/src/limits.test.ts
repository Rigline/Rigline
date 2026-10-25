/**
 * The plan's usage windows, merged and read as the panel does, and readings from other panels
 * weighed by when they were observed (D147). `panel_usage_update`'s type is harvested and its body
 * is not, so these tests are what pins the body.
 */

import { describe, expect, it } from "vitest";
import {
  identityChanged,
  identityOf,
  limitsAt,
  mergeReadings,
  nextReset,
  type RawWindows,
  type Reading,
  type Readings,
  readingFrom,
  statedAt,
  supersedes,
} from "./limits.ts";

const NOW = 1_800_000_000_000;
const IN_AN_HOUR = NOW / 1000 + 3600;
const IN_A_DAY = NOW / 1000 + 86_400;
const MINUTE = 60_000;

/** What a `panel_usage_update` states, as arriving now with no time of its own. */
const update = (unifiedWindows: unknown) => statedAt(unifiedWindows, NOW, false);

function reading(utilization: number, at: number, exact: boolean, resetsAt = IN_AN_HOUR): Reading {
  return { utilization, resetsAt, at, exact };
}

describe("statedAt", () => {
  it("reads each window a message sends, observed when it says", () => {
    expect(
      statedAt(
        {
          five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR },
          seven_day: { utilization: 0.18, resetsAt: IN_A_DAY },
        },
        NOW,
        true,
      ),
    ).toEqual({
      five_hour: reading(0.42, NOW, true),
      seven_day: reading(0.18, NOW, true, IN_A_DAY),
    });
  });

  it("states a window sent as null as deleted, and leaves out one it cannot read", () => {
    expect(update({ five_hour: null, seven_day: { utilization: "lots" } })).toEqual({
      five_hour: null,
    });
    expect(update(null)).toEqual({});
  });

  it("ignores the window it does not expose", () => {
    expect(
      update({ seven_day_overage_included: { utilization: 0.9, resetsAt: IN_A_DAY } }),
    ).toEqual({});
  });
});

describe("readingFrom", () => {
  it("takes a reading another panel sent, and nothing without its time", () => {
    expect(readingFrom(reading(0.42, NOW, true))).toEqual(reading(0.42, NOW, true));
    expect(readingFrom({ utilization: 0.42, resetsAt: IN_AN_HOUR, at: NOW })).toBeNull();
    expect(readingFrom({ utilization: 0.42, resetsAt: IN_AN_HOUR, exact: true })).toBeNull();
    expect(readingFrom({ utilization: 0.42, at: -1, exact: true })).toBeNull();
    expect(readingFrom([])).toBeNull();
  });
});

describe("supersedes", () => {
  it("takes the newer of two stamped readings, whichever way the figure moves", () => {
    expect(supersedes(reading(0.6, NOW, true), reading(0.4, NOW + MINUTE, true))).toBe(true);
    expect(supersedes(reading(0.4, NOW + MINUTE, true), reading(0.6, NOW, true))).toBe(false);
    expect(supersedes(reading(0.4, NOW, true), reading(0.6, NOW, true))).toBe(false);
  });

  it("takes a stamped reading newer than an unstamped one could be, lower or not", () => {
    expect(supersedes(reading(0.6, NOW, false), reading(0.4, NOW + MINUTE, true))).toBe(true);
  });

  it("lets a reading of unknown age raise a figure and never lower it", () => {
    const held = reading(0.4, NOW, true);
    expect(supersedes(held, reading(0.6, NOW + MINUTE, false))).toBe(true);
    expect(supersedes(held, reading(0.2, NOW + MINUTE, false))).toBe(false);
  });

  it("lets a stamped reading no newer than an unstamped one only raise it", () => {
    const seed = reading(0.4, NOW, false);
    expect(supersedes(seed, reading(0.6, NOW - MINUTE, true))).toBe(true);
    expect(supersedes(seed, reading(0.2, NOW - MINUTE, true))).toBe(false);
  });

  it("orders by reset before use where it can only raise, so a new period stands", () => {
    const held = reading(0.9, NOW, false);
    expect(supersedes(held, reading(0.1, NOW, false, IN_AN_HOUR + 18_000))).toBe(true);
    expect(supersedes(held, reading(0.95, NOW, false, IN_AN_HOUR - 18_000))).toBe(false);
  });

  it("takes resets a second apart as one period, as two of the extension's sources round", () => {
    const held = reading(0.6, NOW, false);
    expect(supersedes(held, reading(0.4, NOW, false, IN_AN_HOUR + 1))).toBe(false);
    expect(supersedes(held, reading(0.7, NOW, false, IN_AN_HOUR - 1))).toBe(true);
  });

  it("never lets a window without a reset time stand over one with", () => {
    const held = reading(0.42, NOW, false);
    const none: Reading = { utilization: 0.5, resetsAt: null, at: NOW + MINUTE, exact: true };
    expect(supersedes(held, none)).toBe(false);
    expect(supersedes(undefined, none)).toBe(true);
  });
});

describe("mergeReadings", () => {
  it("takes what supersedes, keeps a window left out, and deletes one stated as null", () => {
    const held: Readings = {
      five_hour: reading(0.42, NOW, false),
      seven_day: reading(0.18, NOW, false, IN_A_DAY),
    };
    expect(
      mergeReadings(held, update({ five_hour: { utilization: 0.5, resetsAt: IN_AN_HOUR } })),
    ).toEqual({ ...held, five_hour: reading(0.5, NOW, false) });
    expect(mergeReadings(held, update({ five_hour: null }))).toEqual({
      seven_day: held.seven_day,
    });
  });

  it("returns what it held for a message that changes nothing", () => {
    const held: Readings = { five_hour: reading(0.42, NOW, false) };
    expect(mergeReadings(held, update({}))).toBe(held);
    expect(mergeReadings(held, update({ seven_day: null }))).toBe(held);
    expect(
      mergeReadings(held, update({ five_hour: { utilization: 0.3, resetsAt: IN_AN_HOUR } })),
    ).toBe(held);
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
