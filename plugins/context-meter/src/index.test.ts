/**
 * The meter's arithmetic and words. The counts are the host's (D121) and are tested there;
 * `packages/harness/test/context-meter.test.ts` draws them against the real bundle.
 */
import type { ContextUsage } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import { band, percentUsed, tooltip } from "./index.tsx";

const usage = (over: Partial<ContextUsage>): ContextUsage => ({
  used: 41_750,
  limit: 167_000,
  autoCompact: true,
  stale: false,
  ...over,
});

describe("percentUsed", () => {
  it("rounds as the panel does, and stops at a hundred", () => {
    expect(percentUsed(usage({}))).toBe(25);
    expect(percentUsed(usage({ used: 170_000 }))).toBe(100);
  });

  it("is null until both counts are known, and while stale", () => {
    expect(percentUsed(usage({ used: null }))).toBeNull();
    expect(percentUsed(usage({ limit: null }))).toBeNull();
    expect(percentUsed(usage({ stale: true }))).toBeNull();
  });
});

describe("band", () => {
  it("changes where the panel's own indicator changes its glyph", () => {
    expect(band(62)).toBe("low");
    expect(band(63)).toBe("mid");
    expect(band(86)).toBe("mid");
    expect(band(87)).toBe("high");
  });
});

describe("tooltip", () => {
  it("says what the percentage is of", () => {
    expect(tooltip(usage({}))).toBe(
      "Context: 25% of the way to auto-compact\n41.8k of 167k tokens",
    );
    expect(tooltip(usage({ limit: 200_000, autoCompact: false }))).toContain("auto-compact is off");
  });

  it("says what it is waiting for", () => {
    expect(tooltip(usage({ used: null }))).toContain("first reading");
    expect(tooltip(usage({ limit: null }))).toContain("not known yet");
    expect(tooltip(usage({ stale: true }))).toContain("compacted");
  });
});
