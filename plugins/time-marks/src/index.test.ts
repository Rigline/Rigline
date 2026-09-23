/**
 * Pure-function tests for this plugin's entire decision logic: what a duration reads as, whether
 * an entry gets a marker and what kind, and the one CSS rule this plugin ever writes over an
 * app-owned element. No DOM and no ctx here — packages/harness/test/time-marks.test.ts drives the
 * real webview tier.
 */
import type { TranscriptEntry } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import { gapName, markFor, styleRules } from "./index.tsx";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Local noon on day-of-month `day` in September 2026: chosen so nothing sits near a midnight or a DST boundary. */
function noon(day: number): number {
  return new Date(2026, 8, day, 12, 0, 0, 0).getTime();
}

/** Alternating user/assistant entries at the given epoch times, `null` where a record has no time yet. */
function entriesAt(...times: readonly (number | null)[]): TranscriptEntry[] {
  return times.map(
    (at, index): TranscriptEntry => ({
      id: `entry-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      at,
      index,
    }),
  );
}

/** `entries[i]`, asserted present: every test below builds its own fixed-length list by hand. */
function at(entries: readonly TranscriptEntry[], index: number): TranscriptEntry {
  const entry = entries[index];
  if (entry === undefined) throw new Error(`fixture has no entry at index ${index}`);
  return entry;
}

describe("gapName", () => {
  it("formats minutes under an hour as Nm", () => {
    expect(gapName(11 * MINUTE)).toBe("11m");
    expect(gapName(59 * MINUTE)).toBe("59m");
  });

  it("formats an exact hour as Nh, never 60m", () => {
    expect(gapName(HOUR)).toBe("1h");
    expect(gapName(2 * HOUR)).toBe("2h");
  });

  it("formats hours with minutes, and never trails a spurious 0m on an exact hour", () => {
    expect(gapName(23 * HOUR + 59 * MINUTE)).toBe("23h 59m");
    expect(gapName(3 * HOUR)).toBe("3h");
  });

  it("coarsens past 24h to days, dropping a leftover-minute remainder entirely", () => {
    expect(gapName(DAY)).toBe("1d");
    expect(gapName(DAY + 4 * HOUR)).toBe("1d 4h");
    // The kind of thing that reaches a screen through some other caller: the 30 leftover minutes
    // are absorbed into the hour count before the day/hour split, and 9d + 30min lands on exactly
    // 9 days with a zero hour remainder, which does not trail either.
    expect(gapName(9 * DAY + 30 * MINUTE)).toBe("9d");
  });

  it("rounds to the nearest minute rather than truncating", () => {
    expect(gapName(50 * 1000)).toBe("1m");
  });
});

describe("markFor", () => {
  it("gives every timed entry in a continuous run a time", () => {
    const entries = entriesAt(noon(10), noon(10) + 2 * MINUTE, noon(10) + 4 * MINUTE);
    for (const entry of entries) {
      expect(markFor(entry, entries)?.time).toMatch(/\d/);
    }
  });

  it("gives the first timed entry a non-null lead", () => {
    const entries = entriesAt(noon(10));
    expect(markFor(at(entries, 0), entries)?.lead).not.toBeNull();
  });

  it("gives entries close together in one conversation no lead", () => {
    const entries = entriesAt(noon(10), noon(10) + 3 * MINUTE);
    expect(markFor(at(entries, 1), entries)?.lead).toBeNull();
  });

  it("names a long pause's duration", () => {
    const entries = entriesAt(noon(10), noon(10) + 3 * HOUR + 12 * MINUTE);
    expect(markFor(at(entries, 1), entries)?.lead).toBe("3h 12m later");
  });

  it("prefers the day name over a duration when a short gap also crosses midnight", () => {
    // "20h later" is true and useless; the day boundary wins regardless of how small the gap is.
    const beforeMidnight = new Date(2026, 8, 10, 23, 58, 0).getTime();
    const afterMidnight = new Date(2026, 8, 11, 0, 3, 0).getTime();
    const entries = entriesAt(beforeMidnight, afterMidnight);
    const mark = markFor(at(entries, 1), entries);
    expect(mark?.lead).not.toBeNull();
    expect(mark?.lead).not.toMatch(/later/);
  });

  it("marks nothing for an entry with no time yet — there is no time to put on it either", () => {
    const entries = entriesAt(noon(10), null);
    expect(markFor(at(entries, 1), entries)).toBeNull();
  });

  it("measures the gap against the last entry that has a time, not literally the previous one", () => {
    const entries = entriesAt(noon(10), null, noon(10) + 3 * MINUTE);
    expect(markFor(at(entries, 2), entries)?.lead).toBeNull();
  });

  it("gives the opening divider to the first entry that actually has a time", () => {
    const entries = entriesAt(null, null, noon(10));
    expect(markFor(at(entries, 0), entries)).toBeNull();
    expect(markFor(at(entries, 1), entries)).toBeNull();
    expect(markFor(at(entries, 2), entries)?.lead).not.toBeNull();
  });

  it("does not divide on time running backwards across an out-of-order resume", () => {
    // A negative gap is already < GAP_MS, so this needs no special case in markFor itself — it is
    // the same branch an ordinary short gap takes.
    const entries = entriesAt(noon(10), noon(10) - 3 * HOUR);
    expect(markFor(at(entries, 1), entries)?.lead).toBeNull();
  });
});

describe("styleRules", () => {
  const ROW_CLASS = "message_07S1Yg";

  it("never narrows the row: no padding-right, padding-left, width, max-width or margin-right", () => {
    // The hard constraint this got wrong once: a reserved gutter for the time made every line
    // wrap earlier and the whole transcript taller. Nothing generated here may touch any of these
    // properties again.
    const css = styleRules(ROW_CLASS);
    for (const forbidden of [
      "padding-right",
      "padding-left",
      "width",
      "max-width",
      "margin-right",
    ]) {
      expect(css).not.toContain(forbidden);
    }
  });

  it("scopes the rule to rows this plugin itself put a divider on", () => {
    expect(styleRules(ROW_CLASS)).toMatch(/^\.message_07S1Yg:has\(> \./);
  });

  it("sets both the custom property and a literal padding-top together", () => {
    const css = styleRules(ROW_CLASS);
    expect(css).toMatch(/--message-padding-top:\d+px/);
    expect(css).toMatch(/(^|;)padding-top:\d+px/);
  });

  it("takes the row class from the caller rather than hardcoding it", () => {
    expect(styleRules("otherRow_ABCDEF")).not.toContain("07S1Yg");
  });
});
