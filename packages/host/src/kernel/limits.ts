/**
 * How much of the plan's usage limits is used, derived once for every plugin that asks (D129), as
 * the newest reading any panel on this machine has for the same account (D147).
 *
 * Readings come from this panel's sessions, stamped as the extension forwarded them; from the windows
 * the extension pushes to every panel in its window, which carry no time; and from the other panels.
 * A timer republishes at each reset, and a change of signed-in account clears them, as the panel's
 * own state is cleared. Tapped on first use, as the other services are.
 */
import {
  AUTH_TYPES,
  authStatusOf,
  identityChanged,
  identityOf,
  type LimitWindow,
  limitsAt,
  mergeReadings,
  nextReset,
  type Reading,
  type Readings,
  readingFrom,
  type Stated,
  statedAt,
  UNKNOWN_LIMITS,
  type UsageLimits,
  WINDOW_KEYS,
} from "@rigline/plugin-api/internal";
import type { Bus } from "./bridge.ts";
import type { Peers } from "./peers.ts";

const UPDATE = "panel_usage_update";
const CONFIG_TYPES = ["update_state", "get_claude_state_response"] as const;
const SHARED = "limits";
const ASK = "limits-ask";

export interface LimitsStats {
  readonly updates: number;
}

export interface LimitsService {
  /** Call `handler` now with the current limits and again on every change. Returns the removal. */
  subscribe(handler: (limits: UsageLimits) => void): () => void;
  readonly current: UsageLimits;
  readonly stats: LimitsStats;
}

interface Shared {
  readonly who: string;
  readonly readings: Readings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameWindow(a: LimitWindow | null, b: LimitWindow | null): boolean {
  return a === b || (a !== null && b !== null && a.used === b.used && a.resetsAt === b.resetsAt);
}

/**
 * The account a message's config names, as its email address and organisation joined; null where
 * it names no whole account, and undefined where the message carries no config.
 */
function accountOf(payload: unknown): string | null | undefined {
  if (!isRecord(payload) || !isRecord(payload.config)) return undefined;
  const account = isRecord(payload.config.account) ? payload.config.account : {};
  const { email, organization } = account;
  return typeof email === "string" && typeof organization === "string"
    ? `${email}\n${organization}`
    : null;
}

/** The windows a session's `rate_limit_event` states, and when the extension forwarded it. */
function rateLimitOf(payload: unknown): { windows: unknown; at: unknown } | null {
  if (!isRecord(payload) || !isRecord(payload.message)) return null;
  const { message } = payload;
  if (message.type !== "rate_limit_event" || !isRecord(message.rate_limit_info)) return null;
  return { windows: message.rate_limit_info.unifiedWindows, at: payload.hostForwardedAt };
}

function readShared(body: unknown): Shared | string {
  if (!isRecord(body)) return "a body that is not an object";
  if (typeof body.who !== "string") return "no account";
  if (!isRecord(body.readings)) return "readings that do not hold";
  const readings: { five_hour?: Reading; seven_day?: Reading } = {};
  for (const name of WINDOW_KEYS) {
    if (body.readings[name] === undefined) continue;
    const reading = readingFrom(body.readings[name]);
    if (reading === null) return "a reading that does not hold";
    readings[name] = reading;
  }
  return { who: body.who, readings };
}

function readAsk(body: unknown): { who: string } | string {
  return isRecord(body) && typeof body.who === "string" ? { who: body.who } : "no account";
}

export function createLimitsService(bus: Bus, peers: Peers): LimitsService {
  const handlers = new Set<(limits: UsageLimits) => void>();
  let tapped = false;
  let updates = 0;
  let held: Readings = {};
  let identity: string | null | undefined;
  let who: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let limits = UNKNOWN_LIMITS;

  function publish(): void {
    const now = Date.now();
    if (timer !== null) clearTimeout(timer);
    const reset = nextReset(held, now);
    timer = reset === null ? null : setTimeout(publish, reset - now);
    const next = limitsAt(held, now);
    if (sameWindow(next.fiveHour, limits.fiveHour) && sameWindow(next.sevenDay, limits.sevenDay)) {
      return;
    }
    limits = next;
    // A copy: a handler may unsubscribe itself, which is what being disabled does.
    for (const handler of [...handlers]) handler(next);
  }

  /** Merges `stated`, and tells the other panels what it changed when it came from this one. */
  function take(stated: Stated, own: boolean): void {
    const next = mergeReadings(held, stated);
    if (next === held) return;
    const changed = WINDOW_KEYS.filter(
      (name) => next[name] !== undefined && next[name] !== held[name],
    );
    held = next;
    publish();
    if (own && who !== null && changed.length > 0) {
      peers.post(SHARED, { who, readings: Object.fromEntries(changed.map((n) => [n, next[n]])) });
    }
  }

  // Heard from the start, so a panel whose plugins never ask drops nothing as unknown.
  peers.on(SHARED, readShared, (shared) => {
    if (who !== null && shared.who === who) take(shared.readings, false);
  });
  peers.on(ASK, readAsk, (ask) => {
    if (who === null || ask.who !== who || WINDOW_KEYS.every((n) => held[n] === undefined)) return;
    peers.post(SHARED, { who, readings: held });
  });

  function tap(): void {
    if (tapped) return;
    tapped = true;
    // Auth first: each tap replays its own buffered messages, and a switch of account at boot is
    // older than the windows sent for the new one.
    for (const type of AUTH_TYPES) {
      bus.on(type, (payload) => {
        const status = authStatusOf(payload);
        if (status === undefined) return;
        const next = identityOf(status);
        const changed = identityChanged(identity, next);
        if (next !== undefined) identity = next;
        if (!changed) return;
        held = {};
        publish();
      });
    }
    for (const type of CONFIG_TYPES) {
      bus.on(type, (payload) => {
        const next = accountOf(payload);
        if (next === undefined || next === who) return;
        who = next;
        if (who !== null) peers.post(ASK, { who });
      });
    }
    bus.on(UPDATE, (payload) => {
      updates++;
      take(statedAt(isRecord(payload) ? payload.unifiedWindows : null, Date.now(), false), true);
    });
    bus.on("io_message", (payload) => {
      const event = rateLimitOf(payload);
      if (event === null) return;
      const at = typeof event.at === "number" && Number.isFinite(event.at) ? event.at : null;
      take(statedAt(event.windows, at ?? Date.now(), at !== null), true);
    });
  }

  return {
    subscribe(handler) {
      tap();
      handlers.add(handler);
      handler(limits);
      return () => void handlers.delete(handler);
    },
    get current() {
      return limits;
    },
    get stats(): LimitsStats {
      return { updates };
    },
  };
}
