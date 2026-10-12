/**
 * What the panel's session has cost, derived once for every plugin that asks (D129).
 *
 * Claude Code's own running total, from the latest `result` on the panel's channel (`channel.ts`),
 * never summed; a new channel starts from nothing. `metered` follows the panel's auth status.
 * Tapped on first use, as the other services are.
 */
import {
  AUTH_TYPES,
  authStatusOf,
  costReading,
  meteredOf,
  type SessionCost,
  UNKNOWN_COST,
} from "@rigline/plugin-api/internal";
import type { Bus } from "./bridge.ts";
import { followChannel } from "./channel.ts";

export interface CostStats {
  readonly results: number;
}

export interface CostService {
  /** Call `handler` now with the current cost and again on every change. Returns the removal. */
  subscribe(handler: (cost: SessionCost) => void): () => void;
  readonly current: SessionCost;
  readonly stats: CostStats;
}

export function createCostService(bus: Bus): CostService {
  const handlers = new Set<(cost: SessionCost) => void>();
  let tapped = false;
  let results = 0;
  let cost = UNKNOWN_COST;

  function publish(next: SessionCost): void {
    if (next.usd === cost.usd && next.models === cost.models && next.metered === cost.metered) {
      return;
    }
    cost = next;
    // A copy: a handler may unsubscribe itself, which is what being disabled does.
    for (const handler of [...handlers]) handler(next);
  }

  function tap(): void {
    if (tapped) return;
    tapped = true;
    followChannel(bus, {
      start: () => publish({ ...cost, usd: null, models: UNKNOWN_COST.models }),
      record(payload) {
        const reading = costReading(payload);
        if (reading === null) return;
        results++;
        publish({ ...cost, ...reading });
      },
    });
    for (const type of AUTH_TYPES) {
      bus.on(type, (payload) => {
        const status = authStatusOf(payload);
        if (status !== undefined) publish({ ...cost, metered: meteredOf(status) });
      });
    }
  }

  return {
    subscribe(handler) {
      tap();
      handlers.add(handler);
      handler(cost);
      return () => void handlers.delete(handler);
    },
    get current() {
      return cost;
    },
    get stats(): CostStats {
      return { results };
    },
  };
}
