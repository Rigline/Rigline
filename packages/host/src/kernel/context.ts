/**
 * How full the panel's session's context is, derived once for every plugin that asks (D121).
 *
 * Follows one channel: the last `launch_claude` the panel sent, or the first `io_message` channel
 * when no launch has been seen. A new channel starts from nothing. Tapped on first use, as the
 * session and tool services are.
 *
 * The limit is Claude Code's own answer to `get_context_usage` where it has given one, and the
 * panel's formula over the main model's window otherwise. It asks when a channel starts, after a
 * compaction and when the main model changes: never on a timer, since answering counts tokens with
 * Anthropic's API.
 */
import {
  type ContextUsage,
  contextAnswer,
  contextReading,
  formulaLimit,
  ioChannel,
  type MessageTokens,
  type ModelWindow,
  mergeTokens,
  UNKNOWN_USAGE,
} from "@rigline/plugin-api/internal";
import type { Bus } from "./bridge.ts";

/** The one request the host asks, and its reply, both of which must be harvested (D120). */
const ASK = "get_context_usage";
const ASK_REPLY = "get_context_usage_response";

export interface ContextStats {
  readonly readings: number;
  readonly asked: number;
  readonly answered: number;
  readonly canAsk: boolean;
  readonly limitFrom: "Claude Code" | "the panel's formula" | null;
}

export interface ContextService {
  /** Call `handler` now with the current usage and again on every change. Returns the removal. */
  subscribe(handler: (usage: ContextUsage) => void): () => void;
  readonly current: ContextUsage;
  readonly stats: ContextStats;
}

export function createContextService(bus: Bus, messageTypes: readonly string[]): ContextService {
  const canAsk = messageTypes.includes(ASK) && messageTypes.includes(ASK_REPLY);
  const handlers = new Set<(usage: ContextUsage) => void>();
  let tapped = false;

  let channel: string | null = null;
  let tokens: MessageTokens | null = null;
  let answeredUsed: number | null = null;
  let answered: { readonly limit: number | null; readonly autoCompact: boolean } | null = null;
  let mainModel: string | null = null;
  let servedModel: string | null = null;
  let windows: Readonly<Record<string, ModelWindow>> = {};
  let stale = false;
  let wanted = false;
  let asking = false;
  let readings = 0;
  let asked = 0;
  let answers = 0;
  let usage = UNKNOWN_USAGE;

  function formula(): number | null {
    const window =
      (mainModel !== null ? windows[mainModel] : undefined) ??
      (servedModel !== null ? windows[servedModel] : undefined);
    return window ? formulaLimit(window) : null;
  }

  function publish(): void {
    const next: ContextUsage = {
      used: tokens !== null ? tokens.input + tokens.output : answeredUsed,
      limit: answered?.limit ?? formula(),
      autoCompact: answered?.autoCompact ?? true,
      stale,
    };
    if (
      next.used === usage.used &&
      next.limit === usage.limit &&
      next.autoCompact === usage.autoCompact &&
      next.stale === usage.stale
    ) {
      return;
    }
    usage = next;
    // A copy: a handler may unsubscribe itself, which is what being disabled does.
    for (const handler of [...handlers]) handler(next);
  }

  function ask(): void {
    if (!wanted || asking || !canAsk || channel === null) return;
    wanted = false;
    asking = true;
    asked++;
    const on = channel;
    const since = readings;
    void bus.ask(on, ASK).then((reply) => {
      asking = false;
      const answer = channel === on ? contextAnswer(reply) : null;
      if (answer !== null) {
        answers++;
        answered = { limit: answer.limit, autoCompact: answer.autoCompact };
        // A reading that arrived while this was in flight is newer than the answer's count.
        if (readings === since && answer.used !== null) {
          tokens = null;
          answeredUsed = answer.used;
          stale = false;
        }
        publish();
      }
      ask();
    });
  }

  function start(next: string): void {
    channel = next;
    tokens = null;
    answeredUsed = null;
    answered = null;
    mainModel = null;
    servedModel = null;
    windows = {};
    stale = false;
    wanted = true;
    publish();
    ask();
  }

  function tap(): void {
    if (tapped) return;
    tapped = true;
    bus.on("launch_claude", (payload) => {
      const next = (payload as { channelId?: unknown }).channelId;
      if (typeof next === "string" && next !== channel) start(next);
    });
    bus.on("io_message", (payload) => {
      const on = ioChannel(payload);
      if (on === null) return;
      if (channel === null) start(on);
      if (on !== channel) return;
      const reading = contextReading(payload);
      if (reading === null) return;
      switch (reading.kind) {
        case "tokens":
          readings++;
          tokens = mergeTokens(tokens, reading);
          if (reading.model !== null) servedModel = reading.model;
          stale = false;
          break;
        case "windows":
          windows = reading.windows;
          break;
        case "model":
          if (mainModel !== null && reading.model !== mainModel) {
            answered = null;
            wanted = true;
          }
          mainModel = reading.model;
          break;
        case "compacted":
          stale = true;
          wanted = true;
          break;
      }
      publish();
      ask();
    });
  }

  return {
    subscribe(handler) {
      tap();
      handlers.add(handler);
      handler(usage);
      return () => void handlers.delete(handler);
    },
    get current() {
      return usage;
    },
    get stats(): ContextStats {
      return {
        readings,
        asked,
        answered: answers,
        canAsk,
        limitFrom:
          answered?.limit != null
            ? "Claude Code"
            : formula() !== null
              ? "the panel's formula"
              : null,
      };
    },
  };
}
