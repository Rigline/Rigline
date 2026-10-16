/**
 * Which models this install offers and which one is live, derived once for every plugin that asks
 * (D120 as amended).
 *
 * Two messages, because the list arrives on one and is replaced on the other: the reply to
 * `get_claude_state` seeds it, and every `update_state` carries both a config and the state the live
 * model and effort are read from. Tapped on first use, as the other services are.
 *
 * The two-config structure is the panel's own and is not a detail to simplify. A reply saying
 * `stored` lands in a different slot from a live one, what the picker draws is the live one falling
 * back to the stored one, and an `update_state` clears the stored slot. One slot would show an empty
 * model list at every cold start, since the first reply is usually the cached one.
 */
import {
  type Configs,
  configsAfterReply,
  configsAfterState,
  type ModelState,
  modelStateOf,
  NO_CONFIGS,
  NO_MODEL_STATE,
  effortOf,
  sameModelState,
  settingOf,
} from "@rigline/plugin-api/internal";
import type { Bus } from "./bridge.ts";

const REPLY = "get_claude_state_response";
const STATE = "update_state";

export interface ModelsStats {
  /** Config replies seen, and how many of them were the cached form. */
  readonly replies: number;
  readonly stored: number;
  readonly updates: number;
}

export interface ModelsService {
  /** Call `handler` now with the current state and again on every change. Returns the removal. */
  subscribe(handler: (state: ModelState) => void): () => void;
  readonly current: ModelState;
  readonly stats: ModelsStats;
}

export function createModelsService(bus: Bus): ModelsService {
  const handlers = new Set<(state: ModelState) => void>();
  let tapped = false;
  let replies = 0;
  let stored = 0;
  let updates = 0;
  let configs: Configs = NO_CONFIGS;
  let setting: string | null = null;
  let effort: string | null = null;
  let state = NO_MODEL_STATE;

  function publish(): void {
    const next = modelStateOf(configs, setting, effort);
    if (sameModelState(next, state)) return;
    state = next;
    // A copy: a handler may unsubscribe itself, which is what being disabled does.
    for (const handler of [...handlers]) handler(next);
  }

  function tap(): void {
    if (tapped) return;
    tapped = true;
    bus.on(REPLY, (payload) => {
      replies++;
      const next = configsAfterReply(configs, payload);
      if (next === configs) return;
      if (next.stored !== configs.stored) stored++;
      configs = next;
      publish();
    });
    bus.on(STATE, (payload) => {
      updates++;
      // Already the inner request: the bus records an envelope under its inner type with the
      // inner payload as the value, so this is what the app reads as `message.request`.
      configs = configsAfterState(configs, payload);
      const named = settingOf(payload);
      if (named !== null) setting = named;
      const level = effortOf(payload);
      if (level !== null) effort = level;
      publish();
    });
  }

  return {
    subscribe(handler) {
      tap();
      handlers.add(handler);
      handler(state);
      return () => void handlers.delete(handler);
    },
    get current() {
      return state;
    },
    get stats(): ModelsStats {
      return { replies, stored, updates };
    },
  };
}
