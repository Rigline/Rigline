/**
 * Reading context fullness off the stream. None of these shapes is harvested: they are the CLI's
 * and Anthropic's, so these tests are what pins them.
 */

import { describe, expect, it } from "vitest";
import {
  contextAnswer,
  contextReading,
  formulaLimit,
  ioChannel,
  type MessageTokens,
  mergeTokens,
} from "./usage.ts";

const io = (message: unknown) => ({ type: "io_message", channelId: "ch-1", done: false, message });

const usage = {
  input_tokens: 3,
  cache_creation_input_tokens: 500,
  cache_read_input_tokens: 40_000,
  output_tokens: 1,
};

const messageStart = (extra: Record<string, unknown> = {}) =>
  io({
    type: "stream_event",
    event: { type: "message_start", message: { id: "msg_1", model: "claude-opus-5-5", usage } },
    ...extra,
  });

describe("contextReading", () => {
  it("reads a message_start's whole prompt", () => {
    expect(contextReading(messageStart())).toEqual({
      kind: "tokens",
      messageId: "msg_1",
      model: "claude-opus-5-5",
      input: 40_503,
      output: 1,
    });
  });

  it("reads a message_delta as more of the message being read", () => {
    const delta = io({
      type: "stream_event",
      event: {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 812 },
      },
    });
    expect(contextReading(delta)).toEqual({
      kind: "tokens",
      messageId: null,
      model: null,
      input: null,
      output: 812,
    });
  });

  it("reads an assistant record's usage, for windows that get no stream events", () => {
    const record = io({
      type: "assistant",
      message: { id: "msg_2", model: "claude-opus-5-5", role: "assistant", content: [], usage },
    });
    expect(contextReading(record)).toMatchObject({
      kind: "tokens",
      messageId: "msg_2",
      input: 40_503,
    });
  });

  it("skips a subagent's records, which are not this context", () => {
    expect(contextReading(messageStart({ parent_tool_use_id: "toolu_01" }))).toBeNull();
  });

  it("skips the CLI's synthetic messages, whose usage is all zeroes", () => {
    const record = io({
      type: "assistant",
      message: {
        id: "msg_3",
        model: "<synthetic>",
        content: [],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    expect(contextReading(record)).toBeNull();
  });

  it("reads each model's window from a result", () => {
    const result = io({
      type: "result",
      modelUsage: {
        "claude-opus-5-5": { contextWindow: 200_000, maxOutputTokens: 64_000, inputTokens: 9 },
        "claude-haiku-4-5": { contextWindow: 200_000, maxOutputTokens: 8_192 },
        broken: { contextWindow: 0, maxOutputTokens: 1 },
      },
    });
    expect(contextReading(result)).toEqual({
      kind: "windows",
      windows: {
        "claude-opus-5-5": { contextWindow: 200_000, maxOutputTokens: 64_000 },
        "claude-haiku-4-5": { contextWindow: 200_000, maxOutputTokens: 8_192 },
      },
    });
  });

  it("reads the main model from init, and a compaction from its boundary", () => {
    expect(
      contextReading(io({ type: "system", subtype: "init", model: "claude-opus-5-5[1m]" })),
    ).toEqual({
      kind: "model",
      model: "claude-opus-5-5[1m]",
    });
    expect(
      contextReading(
        io({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto" } }),
      ),
    ).toEqual({ kind: "compacted" });
  });

  it("ignores everything else", () => {
    expect(contextReading({ type: "update_session_state" })).toBeNull();
    expect(
      contextReading(io({ type: "user", message: { role: "user", content: "hi" } })),
    ).toBeNull();
    expect(
      contextReading(io({ type: "stream_event", event: { type: "content_block_delta" } })),
    ).toBeNull();
    expect(contextReading(io(null))).toBeNull();
  });
});

describe("ioChannel", () => {
  it("names an io_message's channel, and nothing else's", () => {
    expect(ioChannel(io({}))).toBe("ch-1");
    expect(ioChannel({ type: "launch_claude", channelId: "ch-1" })).toBeNull();
  });
});

describe("mergeTokens", () => {
  const tokens = (messageId: string | null, input: number | null, output: number | null) =>
    ({ kind: "tokens", messageId, model: null, input, output }) as const;
  const at: MessageTokens = { messageId: "msg_1", input: 40_000, output: 1 };

  it("replaces the counts for a new message, which may be smaller after a compaction", () => {
    expect(mergeTokens(at, tokens("msg_2", 9_000, 1))).toEqual({
      messageId: "msg_2",
      input: 9_000,
      output: 1,
    });
  });

  it("only raises the counts within one message", () => {
    expect(mergeTokens(at, tokens(null, null, 812))).toEqual({
      messageId: "msg_1",
      input: 40_000,
      output: 812,
    });
    const restated = mergeTokens({ ...at, output: 812 }, tokens("msg_1", 40_000, 1));
    expect(restated).toEqual({ messageId: "msg_1", input: 40_000, output: 812 });
  });

  it("drops a count with no message to belong to", () => {
    expect(mergeTokens(null, tokens(null, null, 812))).toBeNull();
  });
});

describe("formulaLimit", () => {
  it("is the panel's own arithmetic", () => {
    expect(formulaLimit({ contextWindow: 200_000, maxOutputTokens: 64_000 })).toBe(167_000);
    expect(formulaLimit({ contextWindow: 200_000, maxOutputTokens: 8_192 })).toBe(178_808);
  });

  it("is null for a window too small to have one", () => {
    expect(formulaLimit({ contextWindow: 20_000, maxOutputTokens: 64_000 })).toBeNull();
  });
});

describe("contextAnswer", () => {
  const answer = (usage: Record<string, unknown>) => ({
    type: "get_context_usage_response",
    usage,
  });

  it("takes the CLI's own threshold while auto-compact is on", () => {
    const usage = {
      totalTokens: 52_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autoCompactThreshold: 167_000,
      isAutoCompactEnabled: true,
    };
    expect(contextAnswer(answer(usage))).toEqual({
      used: 52_000,
      limit: 167_000,
      autoCompact: true,
    });
  });

  it("takes the whole window while auto-compact is off", () => {
    const usage = {
      totalTokens: 52_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      isAutoCompactEnabled: false,
    };
    expect(contextAnswer(answer(usage))).toEqual({
      used: 52_000,
      limit: 200_000,
      autoCompact: false,
    });
  });

  it("is null for an error", () => {
    expect(
      contextAnswer({ type: "get_context_usage_response", error: "Channel not found: x" }),
    ).toBeNull();
  });
});
