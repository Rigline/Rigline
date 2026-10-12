/**
 * The limits service against a fake bus: the panel's merge, the republish at a reset, and the
 * clear on a change of account (D129). The harness runs it against the real bundle.
 */
import type { UsageLimits } from "@rigline/plugin-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bus } from "../src/kernel/bridge.ts";
import { createLimitsService } from "../src/kernel/limits.ts";

const NOW = 1_800_000_000_000;
const IN_AN_HOUR = NOW / 1000 + 3600;
const IN_A_DAY = NOW / 1000 + 86_400;

function fakeBus() {
  const handlers = new Map<string, ((payload: unknown) => void)[]>();
  const bus: Bus = {
    on(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
      return () => {};
    },
    sealBuffer() {},
    rewriters: { add: () => () => {}, resend: () => false, outboundSeen: () => 0 },
    ask: () => Promise.resolve(null),
  };
  const emit = (type: string, payload: unknown) => {
    for (const handler of handlers.get(type) ?? []) handler(payload);
  };
  return {
    bus,
    emit,
    windows: (unifiedWindows: unknown) =>
      emit("panel_usage_update", { type: "panel_usage_update", unifiedWindows }),
    signIn: (email: string | null) =>
      emit("update_state", {
        type: "update_state",
        state: { authStatus: email === null ? null : { authMethod: "claudeai", email } },
      }),
  };
}

function follow(fake: ReturnType<typeof fakeBus>) {
  const service = createLimitsService(fake.bus);
  const seen: UsageLimits[] = [];
  service.subscribe((limits) => seen.push(limits));
  return { service, seen, last: () => seen.at(-1) };
}

describe("the limits service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is unknown until the extension sends windows, then reads them", () => {
    const fake = fakeBus();
    const { service, last } = follow(fake);
    expect(last()).toEqual({ fiveHour: null, sevenDay: null });

    fake.windows({
      five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR },
      seven_day: { utilization: 0.18, resetsAt: IN_A_DAY },
    });
    expect(last()).toEqual({
      fiveHour: { used: 0.42, resetsAt: IN_AN_HOUR * 1000 },
      sevenDay: { used: 0.18, resetsAt: IN_A_DAY * 1000 },
    });
    expect(service.stats.updates).toBe(1);
  });

  it("merges a partial update into what it has", () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.windows({
      five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR },
      seven_day: { utilization: 0.18, resetsAt: IN_A_DAY },
    });
    fake.windows({ five_hour: { utilization: 0.5, resetsAt: IN_AN_HOUR } });
    expect(last()).toEqual({
      fiveHour: { used: 0.5, resetsAt: IN_AN_HOUR * 1000 },
      sevenDay: { used: 0.18, resetsAt: IN_A_DAY * 1000 },
    });
    fake.windows({ seven_day: null });
    expect(last()?.sevenDay).toBeNull();
  });

  it("republishes a window as unused when its reset comes", () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.windows({
      five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR },
      seven_day: { utilization: 0.18, resetsAt: IN_A_DAY },
    });
    vi.advanceTimersByTime(3600 * 1000);
    expect(last()?.fiveHour).toEqual({ used: 0, resetsAt: null });
    expect(last()?.sevenDay?.used).toBe(0.18);

    vi.advanceTimersByTime(86_400 * 1000);
    expect(last()?.sevenDay).toEqual({ used: 0, resetsAt: null });
  });

  it("clears every window when the signed-in account changes, and not when it signs in", () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.signIn("a@example.com");
    fake.windows({ five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR } });
    fake.signIn("a@example.com");
    expect(last()?.fiveHour?.used).toBe(0.42);

    fake.signIn("b@example.com");
    expect(last()).toEqual({ fiveHour: null, sevenDay: null });

    fake.windows({ five_hour: { utilization: 0.1, resetsAt: IN_AN_HOUR } });
    fake.signIn(null);
    expect(last()?.fiveHour).toBeNull();
  });

  it("publishes only on a change", () => {
    const fake = fakeBus();
    const { seen } = follow(fake);
    fake.windows({ five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR } });
    fake.windows({ five_hour: { utilization: 0.42, resetsAt: IN_AN_HOUR } });
    fake.windows({});
    expect(seen).toHaveLength(2);
  });
});
