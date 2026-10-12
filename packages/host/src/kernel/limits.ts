/**
 * How much of the plan's usage limits is used, derived once for every plugin that asks (D129).
 *
 * The windows the extension pushes to every panel in `panel_usage_update`, merged as the panel
 * merges them. A timer republishes at each reset, and a change of signed-in account clears them,
 * as the panel's own state is cleared. Tapped on first use, as the other services are.
 */
import {
  AUTH_TYPES,
  authStatusOf,
  identityChanged,
  identityOf,
  type LimitWindow,
  limitsAt,
  mergeWindows,
  nextReset,
  type RawWindows,
  UNKNOWN_LIMITS,
  type UsageLimits,
} from "@rigline/plugin-api/internal";
import type { Bus } from "./bridge.ts";

const UPDATE = "panel_usage_update";

export interface LimitsStats {
  readonly updates: number;
}

export interface LimitsService {
  /** Call `handler` now with the current limits and again on every change. Returns the removal. */
  subscribe(handler: (limits: UsageLimits) => void): () => void;
  readonly current: UsageLimits;
  readonly stats: LimitsStats;
}

function sameWindow(a: LimitWindow | null, b: LimitWindow | null): boolean {
  return a === b || (a !== null && b !== null && a.used === b.used && a.resetsAt === b.resetsAt);
}

export function createLimitsService(bus: Bus): LimitsService {
  const handlers = new Set<(limits: UsageLimits) => void>();
  let tapped = false;
  let updates = 0;
  let raw: RawWindows = {};
  let identity: string | null | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let limits = UNKNOWN_LIMITS;

  function publish(): void {
    const now = Date.now();
    if (timer !== null) clearTimeout(timer);
    const reset = nextReset(raw, now);
    timer = reset === null ? null : setTimeout(publish, reset - now);
    const next = limitsAt(raw, now);
    if (sameWindow(next.fiveHour, limits.fiveHour) && sameWindow(next.sevenDay, limits.sevenDay)) {
      return;
    }
    limits = next;
    // A copy: a handler may unsubscribe itself, which is what being disabled does.
    for (const handler of [...handlers]) handler(next);
  }

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
        raw = {};
        publish();
      });
    }
    bus.on(UPDATE, (payload) => {
      updates++;
      const merged = mergeWindows(raw, payload);
      if (merged === raw) return;
      raw = merged;
      publish();
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
