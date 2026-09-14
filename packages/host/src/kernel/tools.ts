/**
 * Tool calls and their outcomes, read once for every plugin that asks (decisions.md, D51).
 *
 * A `tool_result` block names no tool: it carries a `tool_use_id`, the output and `is_error`, and
 * nothing else. Joining it back to the call that produced it is therefore the difference between
 * "something finished" and "EnterWorktree succeeded", and it is the host's job for the reason P5
 * gives — getting the correlation wrong is silent, and the visible symptom is a plugin acting
 * confidently on the wrong answer.
 *
 * One tap serves every plugin, subscribed on first use rather than at boot, exactly as the session
 * service is: the pre hook clones a message only when a tap exists, so an unconditional tap would
 * charge every panel for a stream no plugin read.
 *
 * The map of calls awaiting a result is bounded and drops its oldest entries. A result follows its
 * call within seconds; the extension keeps the real history and this does not need to. An unbounded
 * map would be the replay buffer's mistake made a second time (D3), and on a long-running panel
 * with `retainContextWhenHidden` it would be the larger of the two.
 */
import {
  PENDING_TOOL_LIMIT,
  type ToolResult,
  type ToolUse,
  toolResults,
  toolUses,
} from "@rigline/plugin-api";
import type { Bus } from "./bridge.ts";

export interface ToolService {
  /** Every completed tool call the assistant makes. Returns the removal. */
  onUse(handler: (tool: ToolUse) => void): () => void;
  /** Every tool call's outcome, joined to the call it answers. Returns the removal. */
  onResult(handler: (result: ToolResult) => void): () => void;
}

export function createToolService(bus: Bus): ToolService {
  const uses = new Set<(tool: ToolUse) => void>();
  const results = new Set<(result: ToolResult) => void>();
  // Insertion-ordered, which is what makes "drop the oldest" a `keys().next()` rather than a sort.
  const pending = new Map<string, ToolUse>();
  let tapped = false;

  function remember(tool: ToolUse): void {
    // Deleting first keeps re-insertion honest about age: a repeated id moves to the back rather
    // than keeping the position it had when it was first seen.
    pending.delete(tool.id);
    pending.set(tool.id, tool);
    while (pending.size > PENDING_TOOL_LIMIT) {
      const oldest = pending.keys().next();
      if (oldest.done) break;
      pending.delete(oldest.value);
    }
  }

  function tap(): void {
    if (tapped) return;
    tapped = true;
    bus.on("io_message", (payload) => {
      for (const tool of toolUses(payload)) {
        remember(tool);
        // A copy: a handler may unsubscribe itself, which is what being disabled does.
        for (const handler of [...uses]) handler(tool);
      }
      for (const raw of toolResults(payload)) {
        const call = pending.get(raw.id);
        // No call remembered: the result belongs to a call made before this panel connected, or one
        // aged out of the map. There is nothing truthful to report — the tool's own name is exactly
        // what is missing — so it is dropped rather than delivered with a guessed name (P5).
        if (!call) continue;
        pending.delete(raw.id);
        const result: ToolResult = {
          id: raw.id,
          name: call.name,
          input: call.input,
          ok: raw.ok,
          content: raw.content,
        };
        for (const handler of [...results]) handler(result);
      }
    });
  }

  return {
    onUse(handler) {
      tap();
      uses.add(handler);
      return () => void uses.delete(handler);
    },
    onResult(handler) {
      tap();
      results.add(handler);
      return () => void results.delete(handler);
    },
  };
}
