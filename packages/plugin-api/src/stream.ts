/**
 * Reading tool calls out of the conversation stream.
 *
 * `io_message` is a protocol nested inside ours: `{ type: "io_message", channelId, done, message }`
 * carries the Claude Code CLI's own record, `{ type: "assistant", sessionId, message }`, which in
 * turn carries the Anthropic message format, `{ role: "assistant", content: [blocks] }`. None of
 * those names are Rigline message types and none of them are harvested; what this module does is
 * make the shape the host's problem rather than every plugin's, so a plugin that wants to react to
 * a tool call writes `ctx.onToolUse(...)` and matches a name, instead of learning three layers of
 * envelope.
 *
 * Tool names are deliberately not typed and not checked. They belong to the CLI and to whoever
 * wrote the tool, not to the VS Code extension, so there is nothing to harvest them from and no
 * version to pin them to — a plugin may reasonably watch for a tool that only exists on the
 * machine it runs on. A misspelled name therefore matches nothing, silently; that is the accepted
 * trade for the capability existing at all, and it is why everything above the name — the
 * envelope, the block shape, the id and the input — is pinned here where it can be tested.
 *
 * The host forwards complete assistant records, so a finished `tool_use` block arrives with its
 * whole input. Partially streamed blocks are not assembled: the same call arrives complete
 * moments later, and reacting to half an input is worse than reacting a beat late.
 */

/** One tool call lifted out of an assistant record. */
export interface ToolUse {
  /** The stream's id for this call. Stable within a session; useful for de-duplicating. */
  readonly id: string;
  /** The tool's name, exactly as emitted. Matched by a plugin, checked by nothing. */
  readonly name: string;
  /** The tool's arguments. Its own business, so untyped beyond being an object. */
  readonly input: Readonly<Record<string, unknown>>;
}

/** A value that might be an object, without asserting anything about its contents. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The tool calls carried by one `io_message`, or none if it carries something else.
 *
 * The envelope nests three deep — `io_message` > the CLI's record > the Anthropic message — and
 * each level is checked rather than assumed, because this runs against every message on a busy
 * channel and a wrong guess about one level would throw inside a plugin's handler.
 *
 * `io_message` travels in both directions and only the assistant's records carry tool calls, so
 * anything else falls out here rather than at the call site.
 */
export function toolUses(message: unknown): ToolUse[] {
  const envelope = asRecord(message);
  if (envelope === null || envelope.type !== "io_message") {
    return [];
  }
  const record = asRecord(envelope.message);
  if (record === null || record.type !== "assistant") {
    return [];
  }
  const content = asRecord(record.message)?.content;
  if (!Array.isArray(content)) {
    return [];
  }
  const uses: ToolUse[] = [];
  for (const block of content) {
    const entry = asRecord(block);
    if (entry === null || entry.type !== "tool_use") {
      continue;
    }
    const { id, name, input } = entry;
    if (typeof id !== "string" || typeof name !== "string") {
      continue;
    }
    uses.push({ id, name, input: asRecord(input) ?? {} });
  }
  return uses;
}
