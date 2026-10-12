/**
 * What the session has cost, as Claude Code estimates it, read off the conversation stream
 * (decisions.md, D129).
 *
 * Pure: what one `result` record and one auth status say. The host's cost service follows the
 * channel and holds the state.
 */

/** What a model's share is priced at. */
export type CostBasis = "list" | "managed" | "unknown";

/** One model's share of the session, as Claude Code states it. */
export interface ModelCost {
  /** US dollars. */
  readonly usd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly webSearches: number;
  /**
   * `list` is Anthropic's list price, `managed` an organisation's own rates, and `unknown` the main
   * model's price for a model Claude Code had none for. Null where Claude Code did not say.
   */
  readonly basis: CostBasis | null;
}

/** What the panel's session has cost so far. */
export interface SessionCost {
  /**
   * Claude Code's running estimate in US dollars, or null before this panel's first `result`. It
   * moves when a turn finishes and falls on `/clear`. An estimate, not a bill.
   */
  readonly usd: number | null;
  /** The same by model, keyed by the model id Claude Code reports. */
  readonly models: Readonly<Record<string, ModelCost>>;
  /**
   * True where the account pays per token (an API key, Console or a cloud provider), false on a
   * claude.ai plan, where `usd` is list price rather than what is paid, and null until the panel
   * says.
   */
  readonly metered: boolean | null;
}

export const UNKNOWN_COST: SessionCost = Object.freeze({
  usd: null,
  models: Object.freeze({}),
  metered: null,
});

/** What one `result` says the session has cost. */
export interface CostReading {
  readonly usd: number;
  readonly models: Readonly<Record<string, ModelCost>>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function basisOf(value: unknown): CostBasis | null {
  return value === "list" || value === "managed" || value === "unknown" ? value : null;
}

/** What one `io_message` says the main conversation has cost; null for anything but a `result`. */
export function costReading(message: unknown): CostReading | null {
  const envelope = asRecord(message);
  if (envelope?.type !== "io_message") return null;
  const record = asRecord(envelope.message);
  if (record?.type !== "result" || typeof record.parent_tool_use_id === "string") return null;
  const usd = count(record.total_cost_usd);
  if (usd === null) return null;
  const models: Record<string, ModelCost> = {};
  for (const [model, entry] of Object.entries(asRecord(record.modelUsage) ?? {})) {
    const e = asRecord(entry);
    const cost = count(e?.costUSD);
    if (e === null || cost === null) continue;
    models[model] = {
      usd: cost,
      inputTokens: count(e.inputTokens) ?? 0,
      outputTokens: count(e.outputTokens) ?? 0,
      cacheReadTokens: count(e.cacheReadInputTokens) ?? 0,
      cacheWriteTokens: count(e.cacheCreationInputTokens) ?? 0,
      webSearches: count(e.webSearchRequests) ?? 0,
      basis: basisOf(e.costBasis),
    };
  }
  return { usd, models };
}

/** The message types that state the panel's auth status, each where the panel reads it. */
export const AUTH_TYPES = ["init_response", "update_state", "login_response"] as const;

/**
 * The auth status one of `AUTH_TYPES` states: a record, null for signed out, or undefined where the
 * message does not say. `init_response` without one is left alone, as the panel leaves it.
 */
export function authStatusOf(payload: unknown): Record<string, unknown> | null | undefined {
  const p = asRecord(payload);
  if (p === null) return undefined;
  if (p.type === "login_response") return p.auth === undefined ? undefined : asRecord(p.auth);
  const state = asRecord(p.state);
  if (state === null) return undefined;
  if (p.type === "update_state") return asRecord(state.authStatus);
  if (p.type === "init_response") {
    return state.authStatus === undefined ? undefined : asRecord(state.authStatus);
  }
  return undefined;
}

const PLAN_METHODS: readonly unknown[] = ["claudeai", "claudeai-skip-login"];
/** The extension's own gate for showing session totals. */
const METERED_METHODS: readonly unknown[] = ["api-key", "console", "3p"];

/** Whether an auth status pays per token, or null where it does not say. */
export function meteredOf(status: Record<string, unknown> | null): boolean | null {
  const method = status?.authMethod;
  if (PLAN_METHODS.includes(method)) return false;
  return METERED_METHODS.includes(method) ? true : null;
}
