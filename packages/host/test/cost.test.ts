/**
 * The cost service against a fake bus: which channel it follows, that the latest `result` wins,
 * and where `metered` comes from (D129). The harness runs it against the real bundle.
 */
import type { SessionCost } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import type { Bus } from "../src/kernel/bridge.ts";
import { createCostService } from "../src/kernel/cost.ts";

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
    launch: (channelId: string) => emit("launch_claude", { type: "launch_claude", channelId }),
    record: (message: unknown, channelId = "ch-1") =>
      emit("io_message", { type: "io_message", channelId, done: false, message }),
  };
}

const result = (usd: number) => ({
  type: "result",
  total_cost_usd: usd,
  modelUsage: { opus: { costUSD: usd, inputTokens: 10, outputTokens: 20 } },
});

function follow(fake: ReturnType<typeof fakeBus>) {
  const service = createCostService(fake.bus);
  const seen: SessionCost[] = [];
  service.subscribe((cost) => seen.push(cost));
  return { service, seen, last: () => seen.at(-1) };
}

describe("the cost service", () => {
  it("is unknown until a result, then reads Claude Code's running total", () => {
    const fake = fakeBus();
    const { service, last } = follow(fake);
    expect(last()).toEqual({ usd: null, models: {}, metered: null });

    fake.launch("ch-1");
    fake.record({ type: "assistant", message: { usage: { output_tokens: 5 } } });
    expect(last()?.usd).toBeNull();

    fake.record(result(0.42));
    expect(last()?.usd).toBe(0.42);
    expect(last()?.models.opus).toMatchObject({ usd: 0.42, inputTokens: 10, outputTokens: 20 });
    expect(service.stats.results).toBe(1);
  });

  it("takes the latest result rather than adding them, including one that falls on /clear", () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.launch("ch-1");
    fake.record(result(0.42));
    fake.record(result(1.1));
    expect(last()?.usd).toBe(1.1);
    fake.record(result(0.05));
    expect(last()?.usd).toBe(0.05);
  });

  it("follows the panel's channel and starts again on a new one", () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.launch("ch-1");
    fake.record(result(0.42));
    fake.record(result(9), "ch-other");
    expect(last()?.usd).toBe(0.42);

    fake.launch("ch-2");
    expect(last()?.usd).toBeNull();
    fake.record(result(0.1), "ch-2");
    expect(last()?.usd).toBe(0.1);
  });

  it("follows the first channel it sees when no launch has been", () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.record(result(0.3), "ch-9");
    expect(last()?.usd).toBe(0.3);
  });

  it("reads metered from each message that carries the auth status, and keeps it across channels", () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.emit("init_response", {
      type: "init_response",
      state: { authStatus: { authMethod: "claudeai" } },
    });
    expect(last()?.metered).toBe(false);

    fake.emit("update_state", {
      type: "update_state",
      state: { authStatus: { authMethod: "api-key" } },
    });
    expect(last()?.metered).toBe(true);

    fake.launch("ch-2");
    expect(last()?.metered).toBe(true);

    fake.emit("login_response", { type: "login_response", auth: null });
    expect(last()?.metered).toBeNull();
  });

  it("publishes only on a change", () => {
    const fake = fakeBus();
    const { seen } = follow(fake);
    fake.launch("ch-1");
    fake.emit("init_response", { type: "init_response", state: {} });
    fake.record({ type: "system", subtype: "init", model: "opus" });
    expect(seen).toHaveLength(1);
  });
});
