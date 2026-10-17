/**
 * The model gate: switched on in `config.yaml` or Rigline's settings tab, a prompt waits for a model
 * to be chosen in its session before the composer sends it (D139). Only the send is held, never the typing, and the
 * override is drawn before anything is held, so nobody is ever stuck.
 *
 * Capture-phase listeners on `window`, as `guardLinks` is, so the app's own handlers never see a
 * held send and the text stays where it was. The send keystroke is mirrored rather than wrapped:
 * Enter reaches the send from a React key handler, not through the composer's form.
 */
import {
  comboLabel,
  type ModelSettings,
  type ModelState,
  NO_MODEL_STATE,
  RIGLINE,
  type RequireChoice,
} from "@rigline/plugin-api/internal";
import type { Bus } from "./bridge.ts";
import type { ModelsService } from "./models.ts";
import type { MountService } from "./mounts.ts";

/** What the gate reads off the bus. A version renaming one loses what it carries, and says so. */
export const GATE_TYPES = [
  "launch_claude",
  "update_state",
  "init_response",
  "get_claude_state_response",
  "set_model",
  "apply_settings",
] as const;

/**
 * A popup the composer's own Enter goes to rather than the send: the editor names a list it
 * controls, or a control in the box has its popup open. Each of the composer's popups is pinned to
 * one of these in the harness, and one that shows neither has its Enter held, loudly.
 */
const OPEN_POPUP = '[aria-haspopup][aria-expanded="true"]';

const CSS = `
.rigline-gate {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin-bottom: 6px;
  padding: 5px 8px;
  border: 1px solid var(--vscode-inputValidation-warningBorder, #b89500);
  border-radius: 4px;
  background: var(--vscode-inputValidation-warningBackground, transparent);
  color: var(--vscode-foreground);
  font-size: 0.9em;
}
.rigline-gate[hidden] {
  display: none;
}
.rigline-gate-send {
  padding: 2px 8px;
  border: none;
  border-radius: 2px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  font: inherit;
  cursor: pointer;
}
.rigline-gate-send:hover {
  background: var(--vscode-button-hoverBackground);
}
`;

export interface GateStats {
  /** Sends held back for want of a choice. */
  readonly held: number;
  /** Sends the person let through with what was live. */
  readonly overridden: number;
}

export interface GateService {
  readonly mode: RequireChoice;
  /** Why nothing is held although the mode asks for it, or null when the gate is running. */
  readonly idle: string | null;
  /** The types in `GATE_TYPES` this extension does not have. */
  readonly missing: readonly string[];
  readonly stats: GateStats;
  /** Rigline's model settings changed: the interception goes in or comes out with the mode. */
  configure(settings: ModelSettings): void;
}

export interface GateOptions {
  readonly settings: ModelSettings;
  readonly models: ModelsService;
  readonly bus: Bus;
  readonly mounts: MountService;
  /** The `composerBox` anchor's selector, or null where this extension has no such element. */
  readonly composerBox: string | null;
  readonly messageTypes: readonly string[];
  readonly fail: (reason: string) => void;
}

/** The send keystroke as the composer decides it: Enter, unshifted, outside an IME composition. */
function isSendKey(e: KeyboardEvent, ctrlEnterToSend: boolean): boolean {
  return (
    e.key === "Enter" &&
    !e.shiftKey &&
    !e.isComposing &&
    (!ctrlEnterToSend || e.metaKey || e.ctrlKey)
  );
}

/** What the strip says and what its button reads, from the model state. */
function wording(state: ModelState, mode: RequireChoice): { text: string; button: string } {
  const { current } = state;
  if (current === null) return { text: "The models are still loading.", button: "Send anyway" };
  const live = comboLabel(current, state.effort);
  if (mode !== "unlessDefault") {
    return { text: "No model chosen for this session.", button: `Send with ${live}` };
  }
  const usual = state.default;
  return {
    text:
      usual === null
        ? "No default model is set."
        : `Not your default, ${comboLabel(usual.model, usual.choice.effort ?? null)}.`,
    button: `Send with ${live}`,
  };
}

export function installGate(options: GateOptions): GateService {
  const { models, bus, mounts, composerBox, fail } = options;
  const missing = GATE_TYPES.filter((type) => !options.messageTypes.includes(type));
  const stats = { held: 0, overridden: 0 };
  let ctrlEnterToSend = false;
  let stop: (() => void) | null = null;

  // Read from boot whatever the mode: switched on later, the gate would otherwise take a plain Enter
  // for a send from somebody who sends with Ctrl+Enter, and the replay buffer has sealed by then.
  const readSendKey = (payload: unknown): void => {
    const value = (payload as { readonly state?: { readonly useCtrlEnterToSend?: unknown } } | null)
      ?.state?.useCtrlEnterToSend;
    if (typeof value === "boolean") ctrlEnterToSend = value;
  };
  bus.on("init_response", readSendKey);
  bus.on("update_state", readSendKey);

  let mode: RequireChoice = "off";
  let idle: string | null = null;
  const service: GateService = {
    get mode() {
      return mode;
    },
    get idle() {
      return idle;
    },
    missing,
    stats,
    configure(settings) {
      mode = settings.requireChoice;
      idle = null;
      if (mode === "off") {
        stop?.();
        stop = null;
        return;
      }
      if (composerBox === null) {
        idle = "the composer is not one element in this extension, so no send is held";
        return;
      }
      stop ??= intercept(composerBox);
    },
  };

  /** The strip and the two listeners, and how to take them all away again. */
  function intercept(selector: string): () => void {
    let state: ModelState = NO_MODEL_STATE;
    /** A send has been held in this session, so the strip shows until a choice lifts it. */
    let shown = false;

    const style = document.createElement("style");
    style.setAttribute("data-rigline-style", "gate");
    style.textContent = CSS;
    document.head.appendChild(style);

    const strip = document.createElement("div");
    strip.className = "rigline-gate";
    strip.setAttribute("data-rigline-gate", "");
    strip.setAttribute("role", "status");
    strip.hidden = true;
    const text = strip.appendChild(document.createElement("span"));
    const send = strip.appendChild(document.createElement("button"));
    // The strip sits inside the composer's form, where a button of no type would submit it.
    send.type = "button";
    send.className = "rigline-gate-send";
    send.title = "Sends this prompt with what is live, which counts as this session's choice";

    const box = (): Element | null => document.querySelector(selector);
    const form = (): HTMLFormElement | null => box()?.closest("form") ?? null;

    function render(): void {
      const { text: said, button } = wording(state, mode);
      text.textContent = said;
      send.textContent = button;
      strip.hidden = !(shown && state.choiceRequired);
    }

    /** Hold `e` back, but only once the strip and its override are on screen. */
    function hold(e: Event): void {
      try {
        shown = true;
        render();
      } catch (error) {
        fail(`the model gate could not draw its strip: ${String(error)}`);
        return;
      }
      if (strip.hidden || !strip.isConnected) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stats.held += 1;
    }

    const unsubscribe = models.subscribe((next) => {
      state = next;
      if (!next.choiceRequired) shown = false;
      render();
    });

    const unwatch = mounts.watch(
      { anchor: "composerBox", selector, unique: true },
      RIGLINE,
      (found) =>
        mounts.attach(found, "before", 0, RIGLINE, () => strip, fail, "the model gate") ??
        undefined,
      fail,
    );

    send.addEventListener("click", () => {
      stats.overridden += 1;
      models.confirm();
      // The send button's own path, so the app composes the message as it does for any send.
      form()?.requestSubmit();
    });

    const onKeyDown = (e: KeyboardEvent): void => {
      if (!state.choiceRequired || !isSendKey(e, ctrlEnterToSend)) return;
      const target = e.target;
      const within = box();
      if (!(target instanceof HTMLElement) || !target.isContentEditable) return;
      if (within === null || !within.contains(target)) return;
      if (target.hasAttribute("aria-controls") || within.querySelector(OPEN_POPUP) !== null) return;
      hold(e);
    };
    const onSubmit = (e: SubmitEvent): void => {
      if (!state.choiceRequired || e.target === null || e.target !== form()) return;
      hold(e);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("submit", onSubmit, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("submit", onSubmit, true);
      unsubscribe();
      unwatch();
      strip.remove();
      style.remove();
    };
  }

  service.configure(options.settings);
  return service;
}
