/**
 * The meter's arithmetic and words. The figures are the host's (D129) and are tested there;
 * `packages/harness/test/usage-meter.test.ts` draws them against the real bundle.
 */
import type { LimitWindow, ModelCost, SessionCost } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import {
  band,
  costLabel,
  costTooltip,
  elapsed,
  percentUsed,
  projected,
  windowTooltip,
} from "./index.tsx";

const HOUR = 3_600_000;
const FIVE_HOURS = 5 * HOUR;
const NOW = 1_800_000_000_000;

const model = (usd: number, over: Partial<ModelCost> = {}): ModelCost => ({
  usd,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearches: 0,
  basis: "list",
  ...over,
});

const cost = (over: Partial<SessionCost>): SessionCost => ({
  usd: 1.234,
  models: { "claude-opus-5-5": model(1.234) },
  metered: true,
  ...over,
});

/** A five-hour window `gone` of the way through, `used` of the way to the limit. */
const reading = (used: number, gone: number): LimitWindow => ({
  used,
  resetsAt: NOW + (1 - gone) * FIVE_HOURS,
});

describe("costLabel", () => {
  it("reads dollars, with a tilde where the figure is list price", () => {
    expect(costLabel(cost({}))).toBe("$1.23");
    expect(costLabel(cost({ metered: false }))).toBe("~$1.23");
    expect(costLabel(cost({ usd: 1234.5 }))).toBe("$1,235");
  });

  it("holds its place before the first result", () => {
    expect(costLabel(cost({ usd: null }))).toBe("$–");
  });
});

describe("costTooltip", () => {
  it("states the figure and nothing about it", () => {
    expect(costTooltip(cost({}))).toBe("Session cost: $1.23");
    expect(costTooltip(cost({ metered: false }))).toBe("Session cost: $1.23");
  });

  it("splits by model only when there is more than one, most costly first", () => {
    const split = costTooltip(
      cost({
        models: { haiku: model(0.2), opus: model(1.034), other: model(0, { basis: "unknown" }) },
      }),
    );
    expect(split).toBe(
      "Session cost: $1.23\nopus: $1.03\nhaiku: $0.20\nother: $0.00 (main model's price)",
    );
  });

  it("marks managed rates on the total", () => {
    const managed = { "claude-opus-5-5": model(1.234, { basis: "managed" }) };
    expect(costTooltip(cost({ models: managed }))).toBe("Session cost: $1.23 at managed rates");
  });

  it("says what it is waiting for", () => {
    expect(costTooltip(cost({ usd: null }))).toContain("a turn that carries cost data");
  });
});

describe("pace", () => {
  it("is how far through its period a window is", () => {
    expect(elapsed(reading(0.3, 0.5), FIVE_HOURS, NOW)).toBeCloseTo(0.5);
    expect(elapsed({ used: 0.3, resetsAt: null }, FIVE_HOURS, NOW)).toBeNull();
  });

  it("projects to the reset only once a tenth of the window has gone", () => {
    expect(projected(reading(0.3, 0.5), FIVE_HOURS, NOW)).toBeCloseTo(0.6);
    expect(projected(reading(0.3, 0.05), FIVE_HOURS, NOW)).toBeNull();
  });
});

describe("band", () => {
  it("colours by where the window is heading", () => {
    expect(band(reading(0.3, 0.5), FIVE_HOURS, NOW)).toBe("low");
    expect(band(reading(0.45, 0.5), FIVE_HOURS, NOW)).toBe("mid");
    expect(band(reading(0.6, 0.5), FIVE_HOURS, NOW)).toBe("high");
  });

  it("colours by what is used before the pace says anything, and once the window has reset", () => {
    expect(band(reading(0.3, 0.05), FIVE_HOURS, NOW)).toBe("low");
    expect(band(reading(0.85, 0.05), FIVE_HOURS, NOW)).toBe("mid");
    expect(band({ used: 0, resetsAt: null }, FIVE_HOURS, NOW)).toBe("low");
  });
});

describe("percentUsed", () => {
  it("floors as the panel's bars do, and stops at a hundred", () => {
    expect(percentUsed({ used: 0.429, resetsAt: null })).toBe(42);
    expect(percentUsed({ used: 1.2, resetsAt: null })).toBe(100);
  });
});

describe("windowTooltip", () => {
  it("says what is used, when it resets, and where it is heading", () => {
    const tip = windowTooltip("fiveHour", reading(0.3, 0.5), NOW);
    expect(tip).toMatch(/^Five-hour limit: 30% used, resets .+\nPace: ~60% at reset$/);
    expect(windowTooltip("fiveHour", reading(0.6, 0.5), NOW)).toMatch(
      /\nPace: runs out before reset$/,
    );
  });

  it("says nothing of pace before there is one", () => {
    expect(windowTooltip("fiveHour", reading(0.3, 0.05), NOW)).not.toContain("Pace");
  });

  it("states a missing reading and a reset window, and explains neither", () => {
    expect(windowTooltip("fiveHour", null, NOW)).toBe("Five-hour limit: no reading yet");
    expect(windowTooltip("sevenDay", { used: 0, resetsAt: null }, NOW)).toBe("Weekly limit: reset");
  });
});
