/**
 * Reading the session's cost off the stream. None of these shapes is harvested: the `result` is the
 * CLI's and the auth status the extension's, so these tests are what pins them.
 */

import { describe, expect, it } from "vitest";
import { authStatusOf, costReading, meteredOf } from "./cost.ts";

const io = (message: unknown) => ({ type: "io_message", channelId: "ch-1", done: false, message });

const result = (extra: Record<string, unknown> = {}) =>
  io({
    type: "result",
    subtype: "success",
    total_cost_usd: 1.2345,
    modelUsage: {
      "claude-opus-5-5": {
        inputTokens: 1_200,
        outputTokens: 34_000,
        cacheReadInputTokens: 2_100_000,
        cacheCreationInputTokens: 180_000,
        webSearchRequests: 2,
        costUSD: 1.1,
        contextWindow: 1_000_000,
        maxOutputTokens: 64_000,
        costBasis: "list",
      },
      "claude-haiku-4-5": {
        inputTokens: 900,
        outputTokens: 300,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0.1345,
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
      },
    },
    ...extra,
  });

describe("costReading", () => {
  it("reads the running total and each model's share", () => {
    expect(costReading(result())).toEqual({
      usd: 1.2345,
      models: {
        "claude-opus-5-5": {
          usd: 1.1,
          inputTokens: 1_200,
          outputTokens: 34_000,
          cacheReadTokens: 2_100_000,
          cacheWriteTokens: 180_000,
          webSearches: 2,
          basis: "list",
        },
        "claude-haiku-4-5": {
          usd: 0.1345,
          inputTokens: 900,
          outputTokens: 300,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          webSearches: 0,
          basis: null,
        },
      },
    });
  });

  it("reads a total with no models, and skips a model without a cost", () => {
    expect(costReading(result({ modelUsage: undefined }))).toEqual({ usd: 1.2345, models: {} });
    expect(costReading(result({ modelUsage: { m: { inputTokens: 5 } } }))).toEqual({
      usd: 1.2345,
      models: {},
    });
  });

  it("reads nothing from a result without a usable total", () => {
    expect(costReading(result({ total_cost_usd: undefined }))).toBeNull();
    expect(costReading(result({ total_cost_usd: Number.NaN }))).toBeNull();
    expect(costReading(result({ total_cost_usd: -1 }))).toBeNull();
  });

  it("reads nothing from a subagent's result, another record, or another envelope", () => {
    expect(costReading(result({ parent_tool_use_id: "toolu_1" }))).toBeNull();
    expect(costReading(io({ type: "assistant", message: { usage: {} } }))).toBeNull();
    expect(costReading({ type: "result", total_cost_usd: 1 })).toBeNull();
  });
});

describe("authStatusOf", () => {
  const status = { authMethod: "claudeai", email: "a@example.com", subscriptionType: "max" };

  it("reads each message where the panel reads it", () => {
    expect(authStatusOf({ type: "init_response", state: { authStatus: status } })).toEqual(status);
    expect(authStatusOf({ type: "update_state", state: { authStatus: status } })).toEqual(status);
    expect(authStatusOf({ type: "login_response", auth: status })).toEqual(status);
  });

  it("reads signed out as null, and a message that does not say as undefined", () => {
    expect(authStatusOf({ type: "update_state", state: {} })).toBeNull();
    expect(authStatusOf({ type: "login_response", auth: null })).toBeNull();
    expect(authStatusOf({ type: "init_response", state: {} })).toBeUndefined();
    expect(authStatusOf({ type: "init_response" })).toBeUndefined();
    expect(authStatusOf({ type: "something_else", state: { authStatus: status } })).toBeUndefined();
  });
});

describe("meteredOf", () => {
  it("is false on a claude.ai plan and true for every per-token method", () => {
    expect(meteredOf({ authMethod: "claudeai" })).toBe(false);
    expect(meteredOf({ authMethod: "claudeai-skip-login" })).toBe(false);
    for (const authMethod of ["api-key", "console", "3p"]) {
      expect(meteredOf({ authMethod })).toBe(true);
    }
  });

  it("does not guess", () => {
    expect(meteredOf({ authMethod: "not-specified" })).toBeNull();
    expect(meteredOf({})).toBeNull();
    expect(meteredOf(null)).toBeNull();
  });
});
