/**
 * How full the session's context is, read off the conversation stream (decisions.md, D121).
 *
 * Pure: what one `io_message` says about context, and the arithmetic over it. The host's context
 * service holds the state and decides when to ask the extension; this is the part that can be
 * tested without a bus.
 */

/** How full the session's context is. */
export interface ContextUsage {
  /** Tokens in context at the latest reading, or null before the first. */
  readonly used: number | null;
  /** Where Claude Code compacts on its own, or the whole window while auto-compact is off. */
  readonly limit: number | null;
  /** Whether Claude Code compacts on its own at `limit`. */
  readonly autoCompact: boolean;
  /** From a compaction until the next reading, during which `used` is from before it. */
  readonly stale: boolean;
}

export const UNKNOWN_USAGE: ContextUsage = Object.freeze({
  used: null,
  limit: null,
  autoCompact: true,
  stale: false,
});

/** A model's window, as a `result` record's `modelUsage` states it. */
export interface ModelWindow {
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
}

/**
 * What one record says about context. `messageId` null on a token reading means the API message
 * already being read; `input` or `output` null means the record did not state it.
 */
export type ContextReading =
  | {
      readonly kind: "tokens";
      readonly messageId: string | null;
      readonly model: string | null;
      readonly input: number | null;
      readonly output: number | null;
    }
  | { readonly kind: "windows"; readonly windows: Readonly<Record<string, ModelWindow>> }
  | { readonly kind: "model"; readonly model: string }
  | { readonly kind: "compacted" };

/** The CLI's stand-in model for a message it wrote itself, whose usage is all zeroes. */
const SYNTHETIC_MODEL = "<synthetic>";

/** The CLI's output reserve and auto-compact buffer, which the panel copies too (D121). */
export const OUTPUT_RESERVE_CAP = 20_000;
export const AUTO_COMPACT_BUFFER = 13_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `input`, both cache counts and `output` from an Anthropic `usage`, each null when absent. */
function tokensOf(
  usage: unknown,
  messageId: string | null,
  model: string | null,
): ContextReading | null {
  const u = asRecord(usage);
  if (u === null) return null;
  const parts = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens].map(
    count,
  );
  const input = parts.every((p) => p === null)
    ? null
    : parts.reduce<number>((a, p) => a + (p ?? 0), 0);
  const output = count(u.output_tokens);
  if (input === null && output === null) return null;
  return { kind: "tokens", messageId, model, input, output };
}

/** The channel an `io_message` came down, or null for anything else. */
export function ioChannel(message: unknown): string | null {
  const envelope = asRecord(message);
  return envelope?.type === "io_message" ? text(envelope.channelId) : null;
}

/** What one `io_message` says about the main conversation's context, or null. */
export function contextReading(message: unknown): ContextReading | null {
  const envelope = asRecord(message);
  if (envelope?.type !== "io_message") return null;
  const record = asRecord(envelope.message);
  if (record === null || text(record.parent_tool_use_id) !== null) return null;

  if (record.type === "stream_event") {
    const event = asRecord(record.event);
    if (event?.type === "message_start") {
      const started = asRecord(event.message);
      return tokensOf(started?.usage, text(started?.id), text(started?.model));
    }
    if (event?.type === "message_delta") return tokensOf(event.usage, null, null);
    return null;
  }
  if (record.type === "assistant") {
    const msg = asRecord(record.message);
    const model = text(msg?.model);
    if (model === SYNTHETIC_MODEL) return null;
    return tokensOf(msg?.usage, text(msg?.id), model);
  }
  if (record.type === "result") {
    const usage = asRecord(record.modelUsage);
    if (usage === null) return null;
    const windows: Record<string, ModelWindow> = {};
    for (const [model, entry] of Object.entries(usage)) {
      const e = asRecord(entry);
      const contextWindow = count(e?.contextWindow);
      const maxOutputTokens = count(e?.maxOutputTokens);
      if (contextWindow && maxOutputTokens !== null) {
        windows[model] = { contextWindow, maxOutputTokens };
      }
    }
    return Object.keys(windows).length > 0 ? { kind: "windows", windows } : null;
  }
  if (record.type === "system") {
    if (record.subtype === "compact_boundary") return { kind: "compacted" };
    const model = text(record.model);
    if (record.subtype === "init" && model !== null) return { kind: "model", model };
  }
  return null;
}

/** The API message being read, and its token counts so far. */
export interface MessageTokens {
  readonly messageId: string | null;
  readonly input: number;
  readonly output: number;
}

/**
 * The counts after `reading`. A new message replaces the last; more of the same message only
 * raises them, since its records restate counts that grow. A count with no message to belong to
 * changes nothing.
 */
export function mergeTokens(
  current: MessageTokens | null,
  reading: Extract<ContextReading, { kind: "tokens" }>,
): MessageTokens | null {
  const fresh = reading.messageId !== null && reading.messageId !== current?.messageId;
  if (fresh) {
    return {
      messageId: reading.messageId,
      input: reading.input ?? 0,
      output: reading.output ?? 0,
    };
  }
  if (current === null) return null;
  return {
    messageId: current.messageId,
    input: Math.max(current.input, reading.input ?? 0),
    output: Math.max(current.output, reading.output ?? 0),
  };
}

/** Where Claude Code compacts for a model with this window: the panel's own arithmetic. */
export function formulaLimit(window: ModelWindow): number | null {
  const limit =
    window.contextWindow -
    Math.min(window.maxOutputTokens, OUTPUT_RESERVE_CAP) -
    AUTO_COMPACT_BUFFER;
  return limit > 0 ? limit : null;
}

/** What a `get_context_usage_response` says, or null when it carries no usage. */
export interface ContextAnswer {
  readonly used: number | null;
  readonly limit: number | null;
  readonly autoCompact: boolean;
}

export function contextAnswer(response: unknown): ContextAnswer | null {
  const usage = asRecord(asRecord(response)?.usage);
  if (usage === null) return null;
  const autoCompact = usage.isAutoCompactEnabled !== false;
  const limit = autoCompact
    ? count(usage.autoCompactThreshold)
    : (count(usage.rawMaxTokens) ?? count(usage.maxTokens));
  return { used: count(usage.totalTokens), limit: limit || null, autoCompact };
}
