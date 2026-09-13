/**
 * Lifting tool calls out of the nested stream. The envelope is three deep and none of it is
 * harvested, so this is the only thing pinning it: if the CLI reshapes what it forwards, these
 * fail rather than every plugin quietly seeing no tools.
 */

import { describe, expect, it } from "vitest";
import { toolUses } from "./stream.ts";

/** The real wire shape the extension host forwards for one assistant record. */
const streamed = (...content: unknown[]) => ({
  type: "io_message",
  channelId: "ch-1",
  done: false,
  message: {
    type: "assistant",
    sessionId: "s-1",
    message: { role: "assistant", content },
  },
});

const enterWorktree = {
  type: "tool_use",
  id: "toolu_01",
  name: "EnterWorktree",
  input: { name: "TD-2637-random-ticket-work" },
};

describe("toolUses", () => {
  it("finds one completed tool call with its input intact", () => {
    expect(toolUses(streamed(enterWorktree))).toEqual([
      { id: "toolu_01", name: "EnterWorktree", input: { name: "TD-2637-random-ticket-work" } },
    ]);
  });

  it("finds every tool_use block in order, skipping interleaved text blocks", () => {
    const bash = { type: "tool_use", id: "toolu_02", name: "Bash", input: { command: "ls" } };
    const uses = toolUses(streamed({ type: "text", text: "one moment" }, enterWorktree, bash));
    expect(uses).toEqual([
      { id: "toolu_01", name: "EnterWorktree", input: { name: "TD-2637-random-ticket-work" } },
      { id: "toolu_02", name: "Bash", input: { command: "ls" } },
    ]);
  });

  it("ignores non-tool_use blocks entirely", () => {
    expect(toolUses(streamed({ type: "text", text: "hi" }, { type: "thinking" }))).toEqual([]);
  });

  it("ignores an io_message whose inner CLI record is not an assistant record", () => {
    expect(
      toolUses({ type: "io_message", message: { type: "system", message: { content: [] } } }),
    ).toEqual([]);
    expect(
      toolUses({ type: "io_message", message: { type: "user", message: { content: [] } } }),
    ).toEqual([]);
  });

  it("ignores a non-io_message envelope", () => {
    expect(toolUses({ type: "rename_tab", title: "x" })).toEqual([]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a bare string", "io_message"],
    ["an array", []],
    ["an io_message with no inner message", { type: "io_message" }],
  ])("never throws on malformed input (%s)", (_label, message) => {
    expect(toolUses(message)).toEqual([]);
  });

  it.each([
    ["null", null],
    ["a number", 7],
    ["missing id and name", { type: "tool_use" }],
  ])("drops a content block missing id or name (%s)", (_label, block) => {
    expect(toolUses(streamed(block))).toEqual([]);
  });

  it("reads a missing input as empty rather than dropping the call", () => {
    expect(toolUses(streamed({ type: "tool_use", id: "toolu_03", name: "Glob" }))).toEqual([
      { id: "toolu_03", name: "Glob", input: {} },
    ]);
  });
});
