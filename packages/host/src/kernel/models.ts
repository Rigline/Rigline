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
  type AppliedChoice,
  appliedModelOf,
  type ChoiceResult,
  choiceProblem,
  type Configs,
  configsAfterReply,
  configsAfterState,
  type ModelState,
  modelStateOf,
  NO_CONFIGS,
  NO_MODEL_STATE,
  effortOf,
  sameModelState,
  type ModelChoice,
  setModelField,
  settingOf,
} from "@rigline/plugin-api/internal";
import { followChannel } from "./channel.ts";
import type { Bus } from "./bridge.ts";

const REPLY = "get_claude_state_response";
const STATE = "update_state";

/** The two settings keys this composes, both of Claude Code's own six writable ones. */
const EFFORT_KEY = "effortLevel";
const ULTRACODE_KEY = "ultracode";

/** The request types this sends. Both are declared by the capability, so a rename refuses it. */
const SET_MODEL = "set_model";
const SET_THINKING = "set_thinking_level";
const APPLY_SETTINGS = "apply_settings";

export interface ModelsStats {
  /** Config replies seen, and how many of them were the cached form. */
  readonly replies: number;
  readonly stored: number;
  readonly updates: number;
  /** Choices applied, and choices refused before anything was sent. */
  readonly applied: number;
  readonly refused: number;
}

export interface ModelsService {
  /** Call `handler` now with the current state and again on every change. Returns the removal. */
  subscribe(handler: (state: ModelState) => void): () => void;
  /**
   * Apply a choice, validated against the live list, and resolve with what was applied.
   *
   * The host composes every payload: the caller names a model and an effort, never a message type,
   * a settings key or a field. Refuses before sending anything, so a half-applied favourite is not
   * reachable from here.
   */
  apply(choice: ModelChoice): Promise<ChoiceResult>;
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
  let applied = 0;
  let refused = 0;
  let channel: string | null = null;

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
    // The channel a request goes on, which is the one the panel's own controls use.
    followChannel(bus, {
      start: (next) => {
        channel = next;
      },
      record: () => {},
    });
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

  /**
   * One `apply_settings`, where the choice names anything that goes through it.
   *
   * Effort and ultracode sit on different layers of Claude Code's own table — `userSettings` and
   * `flags` — and `flagsOnly` selects the second, so a choice naming both is two requests rather
   * than one. That is the extension's division and not ours to collapse.
   */
  async function applySettings(
    on: string,
    settings: Readonly<Record<string, unknown>>,
    flagsOnly: boolean,
  ): Promise<void> {
    if (Object.keys(settings).length === 0) return;
    await bus.ask(on, APPLY_SETTINGS, { settings, ...(flagsOnly ? { flagsOnly: true } : {}) });
  }

  return {
    subscribe(handler) {
      tap();
      handlers.add(handler);
      handler(state);
      return () => void handlers.delete(handler);
    },
    async apply(choice) {
      tap();
      const problem = choiceProblem(state, choice);
      if (problem !== null) {
        refused++;
        return { refused: problem };
      }
      if (channel === null) {
        refused++;
        return { refused: "no Claude session is running in this panel yet" };
      }
      const on = channel;
      const result: {
        model: string | null;
        effort: string | null;
        thinkingLevel: string | null;
        ultracode: boolean | null;
      } = { model: null, effort: null, thinkingLevel: null, ultracode: null };
      // The model first: the effort that goes with it is only coherent once it is the live one.
      if (choice.model !== undefined) {
        const reply = await bus.ask(on, SET_MODEL, { model: setModelField(choice.model) });
        result.model = appliedModelOf(reply);
      }
      if (choice.effort !== undefined) {
        await applySettings(on, { [EFFORT_KEY]: choice.effort }, false);
        result.effort = choice.effort;
      }
      if (choice.thinkingLevel !== undefined) {
        await bus.ask(on, SET_THINKING, { thinkingLevel: choice.thinkingLevel });
        result.thinkingLevel = choice.thinkingLevel;
      }
      if (choice.ultracode !== undefined) {
        await applySettings(on, { [ULTRACODE_KEY]: choice.ultracode }, true);
        result.ultracode = choice.ultracode;
      }
      applied++;
      return { applied: result satisfies AppliedChoice };
    },
    get current() {
      return state;
    },
    get stats(): ModelsStats {
      return { replies, stored, updates, applied, refused };
    },
  };
}
