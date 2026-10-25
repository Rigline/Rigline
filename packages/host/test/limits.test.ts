/**
 * The limits service against a fake bus: the panel's merge, the republish at a reset, and the
 * clear on a change of account (D129); and readings from the panel's own sessions and from other
 * panels on Node's real `BroadcastChannel` (D147). The harness runs it against the real bundle.
 */
import type { UsageLimits } from "@rigline/plugin-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bus, Diagnostics } from "../src/kernel/bridge.ts";
import { createLimitsService } from "../src/kernel/limits.ts";
import { createPeers, type Peers } from "../src/kernel/peers.ts";

const NOW = 1_800_000_000_000;
const IN_AN_HOUR = NOW / 1000 + 3600;
const IN_A_DAY = NOW / 1000 + 86_400;
const MINUTE = 60_000;

function counts(): Diagnostics["broadcast"] {
  return { open: false, posted: 0, heard: 0, types: {}, dropped: 0, lastDrop: null };
}

/** Peers with no channel, for a panel alone. */
const alone = (): Peers => createPeers({ name: null, counts: counts(), fail: () => {} });

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
    account: (email: string, organization: string) =>
      emit("update_state", {
        type: "update_state",
        state: { authStatus: { authMethod: "claudeai", email } },
        config: { account: { email, organization } },
      }),
    rateLimit: (unifiedWindows: unknown, hostForwardedAt?: number) =>
      emit("io_message", {
        type: "io_message",
        channelId: "c1",
        message: {
          type: "rate_limit_event",
          rate_limit_info: { status: "allowed", unifiedWindows },
        },
        hostForwardedAt,
      }),
  };
}

function follow(fake: ReturnType<typeof fakeBus>, peers: Peers = alone()) {
  const service = createLimitsService(fake.bus, peers);
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

  it("reads a session's own rate-limit event, observed when the extension forwarded it", () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.windows({ five_hour: { utilization: 0.6, resetsAt: IN_AN_HOUR } });
    vi.setSystemTime(NOW + MINUTE);
    fake.rateLimit({ five_hour: { utilization: 0.4, resetsAt: IN_AN_HOUR } }, NOW + MINUTE - 5);
    expect(last()?.fiveHour?.used).toBe(0.4);

    // The extension's windows carry no time, so they can raise the figure and never lower it.
    vi.setSystemTime(NOW + 2 * MINUTE);
    fake.windows({ five_hour: { utilization: 0.3, resetsAt: IN_AN_HOUR } });
    expect(last()?.fiveHour?.used).toBe(0.4);
    fake.windows({ five_hour: { utilization: 0.5, resetsAt: IN_AN_HOUR } });
    expect(last()?.fiveHour?.used).toBe(0.5);
  });

  it("takes an event the extension did not stamp as of unknown age", () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.rateLimit({ five_hour: { utilization: 0.6, resetsAt: IN_AN_HOUR } });
    fake.rateLimit({ five_hour: { utilization: 0.4, resetsAt: IN_AN_HOUR } });
    expect(last()?.fiveHour?.used).toBe(0.6);
  });
});

describe("readings between panels", () => {
  const NAME = "rigline-limits-test";
  const open: Peers[] = [];
  afterEach(() => {
    for (const p of open.splice(0)) p.close();
  });

  const delivered = () => new Promise((r) => setTimeout(r, 20));
  const inAnHour = () => Math.round(Date.now() / 1000) + 3600;

  function panel() {
    const fake = fakeBus();
    const c = counts();
    const peers = createPeers({ name: NAME, counts: c, fail: () => {} });
    open.push(peers);
    return { fake, counts: c, ...follow(fake, peers) };
  }

  it("carries a session's reading to another panel on the same account", async () => {
    const a = panel();
    const b = panel();
    a.fake.account("a@example.com", "Personal");
    b.fake.account("a@example.com", "Personal");
    await delivered();
    a.fake.rateLimit({ five_hour: { utilization: 0.42, resetsAt: inAnHour() } }, Date.now());
    await delivered();
    expect(b.last()?.fiveHour?.used).toBe(0.42);
    expect(b.counts.types.limits).toEqual({ posted: 0, heard: 1 });
  });

  it("keeps one account's readings from another under the same email address", async () => {
    const a = panel();
    const b = panel();
    a.fake.account("a@example.com", "Personal");
    b.fake.account("a@example.com", "Acme Team");
    a.fake.rateLimit({ five_hour: { utilization: 0.42, resetsAt: inAnHour() } }, Date.now());
    await delivered();
    expect(b.last()?.fiveHour).toBeNull();
  });

  it("posts nothing and takes nothing until it knows its account", async () => {
    const a = panel();
    const b = panel();
    b.fake.account("a@example.com", "Personal");
    a.fake.rateLimit({ five_hour: { utilization: 0.42, resetsAt: inAnHour() } }, Date.now());
    await delivered();
    expect(a.counts.types.limits).toBeUndefined();
    expect(b.last()?.fiveHour).toBeNull();
  });

  it("asks for the latest once it knows its account, and is answered", async () => {
    const a = panel();
    a.fake.account("a@example.com", "Personal");
    a.fake.rateLimit({ five_hour: { utilization: 0.42, resetsAt: inAnHour() } }, Date.now());
    await delivered();
    const b = panel();
    b.fake.account("a@example.com", "Personal");
    await delivered();
    expect(b.last()?.fiveHour?.used).toBe(0.42);
  });

  it("does not let its own stale seed lower a fresher figure from another panel", async () => {
    const a = panel();
    const b = panel();
    a.fake.account("a@example.com", "Personal");
    b.fake.account("a@example.com", "Personal");
    a.fake.rateLimit({ five_hour: { utilization: 0.6, resetsAt: inAnHour() } }, Date.now());
    await delivered();
    b.fake.windows({ five_hour: { utilization: 0.4, resetsAt: inAnHour() } });
    expect(b.last()?.fiveHour?.used).toBe(0.6);
  });

  it("never passes on a reading it heard", async () => {
    const a = panel();
    const b = panel();
    const c = panel();
    for (const p of [a, b, c]) p.fake.account("a@example.com", "Personal");
    await delivered();
    a.fake.rateLimit({ five_hour: { utilization: 0.42, resetsAt: inAnHour() } }, Date.now());
    await delivered();
    expect(b.counts.types.limits?.posted ?? 0).toBe(0);
    expect(c.counts.types.limits).toEqual({ posted: 0, heard: 1 });
  });
});
