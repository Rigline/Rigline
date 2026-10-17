/**
 * Which models this install offers and which is live, read off the panel's own session, and a
 * choice applied through that session's own setters (D120 as amended).
 *
 * The composer footer is handed the session as its `session` prop. Its signals are what Claude
 * Code's own picker draws and its setters are what that picker calls, so nothing here can disagree
 * with the panel: a request sent around the session left its picker showing the old choice while the
 * CLI ran the new one. Every member named here is asserted at harvest by the panel-session layer (P1).
 *
 * Whether this session has chosen a model is kept here too, so the gate is one more reader of the
 * state rather than a second owner of it: a choice applied here, Claude Code's own picker seen on the
 * bus, or the gate's override, each until the panel launches its next channel. A channel resuming a
 * session has chosen already: it carries the choice the session started with.
 */
import {
  type ChoiceResult,
  type ClaudeConfig,
  choiceProblem,
  choosesModel,
  type FiberLike,
  findModel,
  type ModelChoice,
  type ModelSettings,
  type ModelState,
  modelStateOf,
  NO_MODEL_SETTINGS,
  NO_MODEL_STATE,
  onScreen,
  sameModelState,
} from "@rigline/plugin-api/internal";
import type { Bus, ReactBridge } from "./bridge.ts";
import { followChannel } from "./channel.ts";

/** The settings key whose write is a choice of effort, in the panel's own `apply_settings`. */
const EFFORT_KEY = "effortLevel";

/** How far above the footer spacer's fiber the footer's own may sit: two in 2.1.301, and slack. */
const SESSION_DEPTH = 4;

/** A signal as the panel's library makes one. */
interface Signal {
  readonly value: unknown;
  subscribe(fn: (value: unknown) => void): () => void;
}

/** The members of the panel's session this reads and calls. */
export interface PanelSession {
  readonly modelSelection: Signal;
  readonly effortLevel: Signal;
  readonly claudeConfig: Signal;
  /** The live config falling back to the stored one, from 2.1.300. */
  readonly drawnClaudeConfig?: unknown;
  setModel(model: unknown): Promise<unknown>;
  setEffortLevel(level: string): Promise<unknown>;
  setThinkingLevel(level: string): Promise<unknown>;
  /** From 2.1.284. */
  readonly setUltracode?: unknown;
}

function isSignal(value: unknown): value is Signal {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof (value as { readonly subscribe?: unknown }).subscribe === "function"
  );
}

/** The session `props` carry, or null where they carry none of this shape. */
export function sessionOfProps(props: unknown): PanelSession | null {
  const session = (props as { readonly session?: unknown } | null)?.session;
  if (typeof session !== "object" || session === null) return null;
  const s = session as Record<string, unknown>;
  const shaped =
    typeof s.setModel === "function" &&
    typeof s.setEffortLevel === "function" &&
    typeof s.setThinkingLevel === "function" &&
    isSignal(s.modelSelection) &&
    isSignal(s.effortLevel) &&
    isSignal(s.claudeConfig);
  return shaped ? (session as unknown as PanelSession) : null;
}

function sessionAbove(fiber: FiberLike | null): PanelSession | null {
  let node = fiber;
  for (let step = 0; node !== null && step <= SESSION_DEPTH; step++) {
    const found = sessionOfProps(node.memoizedProps);
    if (found !== null) return found;
    node = node.return ?? null;
  }
  return null;
}

/**
 * The session above a fiber of React's pair: the one both halves name, the one only one names, or
 * where they name two, the one on screen (D103).
 */
export function sessionOf(fiber: FiberLike | null): PanelSession | null {
  const own = sessionAbove(fiber);
  const alternate = fiber?.alternate ?? null;
  if (alternate === null) return own;
  const other = sessionAbove(alternate);
  if (own === other || other === null) return own;
  if (own === null) return other;
  if (onScreen(fiber) !== onScreen(alternate)) return onScreen(fiber) ? own : other;
  return null;
}

function configOf(session: PanelSession): ClaudeConfig | undefined {
  const signal = isSignal(session.drawnClaudeConfig)
    ? session.drawnClaudeConfig
    : session.claudeConfig;
  const value = signal.value;
  return typeof value === "object" && value !== null ? value : undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The config's own entry for `alias`, which is what the panel's picker hands its `setModel`. */
function entryFor(session: PanelSession, alias: string): unknown {
  const models: unknown = configOf(session)?.models;
  const found = Array.isArray(models)
    ? (models as readonly unknown[]).find(
        (m) => (m as { readonly value?: unknown } | null)?.value === alias,
      )
    : undefined;
  return found ?? { value: alias };
}

export interface ModelsStats {
  /** Sessions found, counting each new one. */
  readonly sessions: number;
  /** Choices applied, and choices refused, before or by the panel. */
  readonly applied: number;
  readonly refused: number;
}

export interface ModelsService {
  /** Call `handler` now with the current state and again on every change. Returns the removal. */
  subscribe(handler: (state: ModelState) => void): () => void;
  /**
   * Apply a choice through the panel's own setters, validated against the panel's list, and resolve
   * with what the panel's controls hold afterwards. The caller names a model and an effort; the
   * panel composes and sends whatever its own picker would.
   */
  apply(choice: ModelChoice): Promise<ChoiceResult>;
  /** The gate's override: the person sent with what is live, which is this session's choice. */
  confirm(): void;
  /** Rigline's model settings changed, read from a save or another window's. */
  configure(settings: ModelSettings): void;
  readonly current: ModelState;
  readonly stats: ModelsStats;
}

export interface ModelsOptions {
  readonly bus: Bus;
  readonly react: Pick<ReactBridge, "onCommit" | "fiberFor">;
  /** The composer footer's spacer, which the session is found above, or null where it is not. */
  readonly spacer: () => Element | null;
  readonly settings?: ModelSettings;
  /** A fault in a handler, which must never reach the panel's own signals. */
  readonly fail: (reason: string) => void;
}

export function createModelsService(options: ModelsOptions): ModelsService {
  const { bus, react, spacer, fail } = options;
  let settings = options.settings ?? NO_MODEL_SETTINGS;
  const handlers = new Set<(state: ModelState) => void>();
  let tapped = false;
  let session: PanelSession | null = null;
  let unfollow: (() => void)[] = [];
  let sessions = 0;
  let chosen = false;
  let state = NO_MODEL_STATE;
  let applied = 0;
  let refused = 0;
  let scheduled = false;

  function publish(): void {
    const next =
      session === null
        ? modelStateOf(undefined, null, null, settings, chosen)
        : modelStateOf(
            configOf(session),
            text(session.modelSelection.value),
            text(session.effortLevel.value),
            settings,
            chosen,
          );
    if (sameModelState(next, state)) return;
    state = next;
    // A copy: a handler may unsubscribe itself, which is what being disabled does.
    for (const handler of [...handlers]) {
      try {
        handler(next);
      } catch (e) {
        fail(`a model state handler threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /**
   * Publish once the panel's own update has finished. A signal's subscriber runs inside the panel's
   * setter, so anything thrown there would be thrown at Claude Code's own code.
   */
  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      publish();
    });
  }

  function adopt(next: PanelSession): void {
    if (next === session) return;
    for (const stop of unfollow) stop();
    session = next;
    sessions++;
    const config = isSignal(next.drawnClaudeConfig) ? next.drawnClaudeConfig : next.claudeConfig;
    unfollow = [next.modelSelection, next.effortLevel, config].map((signal) =>
      signal.subscribe(schedule),
    );
    publish();
  }

  function find(): void {
    const element = spacer();
    if (element === null) return;
    const found = sessionOf(react.fiberFor(element) as FiberLike | null);
    // None found keeps the last: the footer comes and goes with the views, the session does not.
    if (found !== null) adopt(found);
  }

  function choose(): void {
    if (chosen) return;
    chosen = true;
    publish();
  }

  function tap(): void {
    if (tapped) return;
    tapped = true;
    followChannel(bus, {
      start: (_channel, resumed) => {
        chosen = resumed;
        publish();
      },
      record: () => {},
    });
    // The panel's own requests, which its picker and a choice applied here both send. Claude
    // Code's picker sends nothing when re-pointed at what is already set, so confirming the
    // current model there is not a choice.
    bus.on("set_model", choose);
    bus.on("apply_settings", (payload) => {
      const sent = (payload as { readonly settings?: Record<string, unknown> } | null)?.settings;
      if (typeof sent?.[EFFORT_KEY] === "string") choose();
    });
    react.onCommit(find);
    find();
  }

  function refuse(reason: string): ChoiceResult {
    refused++;
    return { refused: reason };
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
      find();
      publish();
      const problem = choiceProblem(state, choice);
      if (problem !== null) return refuse(problem);
      const panel = session;
      if (panel === null) return refuse("Claude Code's panel has no session here to apply it to");
      if (choice.ultracode !== undefined && typeof panel.setUltracode !== "function") {
        return refuse("this version of Claude Code has no ultracode switch");
      }
      const target = choice.model === undefined ? null : findModel(state.models, choice.model);
      try {
        // The model first: the effort that goes with it is only coherent once it is the live one.
        if (target !== null) await panel.setModel(entryFor(panel, target.value));
        if (choice.effort !== undefined) await panel.setEffortLevel(choice.effort);
        if (choice.thinkingLevel !== undefined) await panel.setThinkingLevel(choice.thinkingLevel);
        if (choice.ultracode !== undefined) {
          await (panel.setUltracode as (on: boolean) => Promise<unknown>).call(
            panel,
            choice.ultracode,
          );
        }
      } catch (e) {
        return refuse(
          `Claude Code did not apply it: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      // The panel rolls a setter back where Claude Code refused it, and says why itself.
      const model = text(panel.modelSelection.value);
      const effort = text(panel.effortLevel.value);
      if (target !== null && findModel(state.models, model)?.value !== target.value) {
        return refuse(`Claude Code kept ${model ?? "its model"}; the panel says why`);
      }
      if (choice.effort !== undefined && effort !== choice.effort) {
        return refuse(`Claude Code kept the effort ${effort ?? "it had"}; the panel says why`);
      }
      applied++;
      // Even a choice of what is already set: it is a person choosing, which is what the gate
      // waits for, and the panel sends nothing for an effort that has not changed.
      if (choosesModel(choice)) choose();
      publish();
      return {
        applied: {
          model: target === null ? null : model,
          effort: choice.effort === undefined ? null : effort,
          thinkingLevel: choice.thinkingLevel ?? null,
          ultracode: choice.ultracode ?? null,
        },
      };
    },
    confirm() {
      tap();
      choose();
    },
    configure(next) {
      settings = next;
      publish();
    },
    get current() {
      return state;
    },
    get stats(): ModelsStats {
      return { sessions, applied, refused };
    },
  };
}
