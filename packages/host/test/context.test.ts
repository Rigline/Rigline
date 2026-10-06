/**
 * The context service against a fake bus: which channel it follows, what it asks and when, and
 * which of an answer and a live reading wins (D121). The harness runs it against the real bundle.
 */
import type { ContextUsage } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import type { Bus } from "../src/kernel/bridge.ts";
import { createContextService } from "../src/kernel/context.ts";

const HARVESTED = [
  "io_message",
  "launch_claude",
  "get_context_usage",
  "get_context_usage_response",
];

function fakeBus() {
  const handlers = new Map<string, ((payload: unknown) => void)[]>();
  const asks: { channelId: string; type: string; answer: (reply: unknown) => void }[] = [];
  const bus: Bus = {
    on(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
      return () => {};
    },
    sealBuffer() {},
    rewriters: { add: () => () => {}, resend: () => false, outboundSeen: () => 0 },
    ask(channelId, type) {
      return new Promise((resolve) => asks.push({ channelId, type, answer: resolve }));
    },
  };
  const emit = (type: string, payload: unknown) => {
    for (const handler of handlers.get(type) ?? []) handler(payload);
  };
  return {
    bus,
    asks,
    launch: (channelId: string) => emit("launch_claude", { type: "launch_claude", channelId }),
    record: (message: unknown, channelId = "ch-1") =>
      emit("io_message", { type: "io_message", channelId, done: false, message }),
  };
}

const start = (id: string, input: number, output = 1) => ({
  type: "stream_event",
  event: {
    type: "message_start",
    message: { id, model: "opus", usage: { input_tokens: input, output_tokens: output } },
  },
});

const result = {
  type: "result",
  modelUsage: { opus: { contextWindow: 200_000, maxOutputTokens: 64_000 } },
};

const answer = (totalTokens: number, autoCompactThreshold = 160_000) => ({
  type: "get_context_usage_response",
  usage: {
    totalTokens,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    autoCompactThreshold,
    isAutoCompactEnabled: true,
  },
});

/** Past the answer's promise. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function follow(fake: ReturnType<typeof fakeBus>, types = HARVESTED) {
  const service = createContextService(fake.bus, types);
  const seen: ContextUsage[] = [];
  service.subscribe((usage) => seen.push(usage));
  return { service, seen, last: () => seen.at(-1) };
}

describe("the context service", () => {
  it("asks when a channel starts, and takes Claude Code's count and limit", async () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.launch("ch-1");
    expect(fake.asks).toMatchObject([{ channelId: "ch-1", type: "get_context_usage" }]);

    fake.asks[0]?.answer(answer(21_000));
    await settle();
    expect(last()).toEqual({ used: 21_000, limit: 160_000, autoCompact: true, stale: false });
  });

  it("falls back to the panel's formula when nothing has been answered", () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.launch("ch-1");
    fake.record({ type: "system", subtype: "init", model: "opus" });
    fake.record(start("msg_1", 50_100));
    fake.record(result);
    expect(last()).toEqual({ used: 50_101, limit: 167_000, autoCompact: true, stale: false });
  });

  it("keeps Claude Code's limit over the formula, and a live reading over a late answer", async () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.launch("ch-1");
    fake.record(start("msg_1", 50_000));
    fake.record(result);
    fake.asks[0]?.answer(answer(21_000));
    await settle();
    expect(last()).toMatchObject({ used: 50_001, limit: 160_000 });
  });

  it("goes stale at a compaction, asks again, and freshens on the answer", async () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.launch("ch-1");
    fake.asks[0]?.answer(answer(120_000));
    await settle();

    fake.record({ type: "system", subtype: "compact_boundary" });
    expect(last()).toMatchObject({ used: 120_000, stale: true });
    expect(fake.asks).toHaveLength(2);

    fake.asks[1]?.answer(answer(18_000));
    await settle();
    expect(last()).toMatchObject({ used: 18_000, stale: false });
  });

  it("asks again when the main model changes, and not when init repeats it", () => {
    const fake = fakeBus();
    follow(fake);
    fake.launch("ch-1");
    fake.asks[0]?.answer(null);
    fake.record({ type: "system", subtype: "init", model: "opus" });
    fake.record({ type: "system", subtype: "init", model: "opus" });
    return settle().then(() => {
      expect(fake.asks).toHaveLength(1);
      fake.record({ type: "system", subtype: "init", model: "opus[1m]" });
      expect(fake.asks).toHaveLength(2);
    });
  });

  it("asks one at a time", () => {
    const fake = fakeBus();
    follow(fake);
    fake.launch("ch-1");
    fake.record({ type: "system", subtype: "compact_boundary" });
    expect(fake.asks).toHaveLength(1);
  });

  it("follows the newest channel from nothing, and ignores the old one's records", () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.launch("ch-1");
    fake.record(start("msg_1", 90_000));
    fake.launch("ch-2");
    expect(last()).toMatchObject({ used: null, limit: null });
    fake.record(start("msg_2", 70_000), "ch-1");
    expect(last()).toMatchObject({ used: null });
  });

  it("takes the first io_message channel when no launch was seen", () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.record(start("msg_1", 30_000), "ch-9");
    expect(last()).toMatchObject({ used: 30_001 });
    expect(fake.asks).toMatchObject([{ channelId: "ch-9" }]);
  });

  it("never asks a version that has not got the request", () => {
    const fake = fakeBus();
    const { service } = follow(fake, ["io_message", "launch_claude"]);
    fake.launch("ch-1");
    expect(fake.asks).toHaveLength(0);
    expect(service.stats.canAsk).toBe(false);
  });

  it("drops an answer for a channel it has left", async () => {
    const fake = fakeBus();
    const { last } = follow(fake);
    fake.launch("ch-1");
    fake.launch("ch-2");
    fake.asks[0]?.answer(answer(99_000));
    await settle();
    expect(last()).toMatchObject({ used: null });
  });
});
