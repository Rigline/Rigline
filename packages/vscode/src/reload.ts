/**
 * Offering a reload, and never taking one (D82).
 *
 * The patch usually lands behind a window that is running the *previous* extension directory, so
 * the ordinary weekly update needs no reload and gets no prompt. This decides the rest, and asks.
 *
 * Nothing here imports `vscode`, and nothing here reloads anything without an answer.
 */
import type { Editor } from "./editor.ts";
import type { Stamps, WatchReason } from "./watch.ts";

/** What would put this window right. A window reload covers both; a webview reload covers one. */
export type Reload = "webviews" | "window";

export interface ReloadQuestion {
  readonly reason: WatchReason["kind"];
  readonly before: Stamps;
  readonly after: Stamps;
  /** Whether Claude Code has activated, sampled after the install (D82). */
  readonly active: boolean;
}

/**
 * Which reload this window wants, or none.
 *
 * `moved` is never an offer: a directory that changed while this host was running is not the one
 * this host loaded, so the webview in front of the user is the old, still-patched one (D82).
 */
export function reloadWanted(question: ReloadQuestion): Reload | null {
  if (question.reason !== "start" || !question.active) return null;
  if (question.after.host !== question.before.host) return "window";
  if (question.after.bundle !== question.before.bundle) return "webviews";
  return null;
}

const LATER = "Not now";

const OFFER: Record<Reload, { readonly message: string; readonly action: string }> = {
  webviews: {
    message:
      "This window loaded Claude Code before Rigline patched it, so the panel has no plugins. " +
      "Reloading its webviews puts them back without reloading the window, and ends any turn " +
      "running in this window.",
    action: "Reload webviews",
  },
  window: {
    message:
      "This window loaded Claude Code before Rigline patched it, and a plugin changed the " +
      "extension host. Only a window reload picks that up, and it ends every session in this " +
      "window.",
    action: "Reload window",
  },
};

const STALE: Record<Reload, string> = {
  webviews: "Click to reload this window's webviews. It ends any turn running in this window.",
  window: "Click to reload the window. It ends every session in this window.",
};

export interface ReloadOffer {
  /**
   * What `acquireAndInject` found, once it has found it. A reload wanted becomes the outstanding
   * offer and a notification; none re-asserts an offer an earlier run left outstanding, because a
   * second update does not make the first window any less stale.
   */
  settle(reload: Reload | null, engine: string): Promise<void>;
  /** The outstanding offer, put up again. What the status item's click runs. */
  again(): Promise<void>;
}

/**
 * The offer, and the one place a reload can be taken from.
 *
 * Its promise is deliberately not awaited by the watcher: a notification nobody answers would
 * otherwise hold the reaction lock for as long as it stands, and the next update would be dropped
 * as a follower.
 */
export function reloadOffer(editor: Editor): ReloadOffer {
  let outstanding: { reload: Reload; engine: string } | null = null;

  async function put(): Promise<void> {
    if (outstanding === null) return;
    const { reload, engine } = outstanding;
    const { message, action } = OFFER[reload];
    const chosen = await editor.ask("info", message, action, LATER);
    if (chosen !== action) {
      editor.log(`reload offered (${reload}) and declined`);
      stale();
      return;
    }
    // Only here, and only for the button that was pressed.
    if (reload === "window") await editor.reloadWindow();
    else await editor.reloadWebviews();
    outstanding = null;
    editor.status("ok", "Rigline", `Injected by engine ${engine}, and this window has caught up`);
  }

  function stale(): void {
    if (outstanding === null) return;
    editor.status("stale", "Rigline: reload to apply", STALE[outstanding.reload]);
  }

  return {
    async settle(reload, engine) {
      if (reload === null) {
        stale();
        return;
      }
      outstanding = { reload, engine };
      await put();
    },
    again: put,
  };
}
