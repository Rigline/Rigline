/**
 * Which session the panel is hosting, derived once for every plugin that asks.
 *
 * Host-maintained state rather than a pass-through, because the farewell rule behind it
 * (`nextSessionId`) is read off minified code and inverts silently. One bus tap serves every
 * plugin, subscribed on first use rather than at boot: the pre hook clones a message only when a
 * tap exists, so an unconditional tap would charge every panel for a value no plugin read.
 * Subscribing late costs nothing, since `bus.on` replays the buffer and plugins register before it
 * is sealed.
 */
import { nextSessionId } from "@rigline/plugin-api";
import type { Bus } from "./bridge.ts";

export interface SessionService {
  /** Call `handler` now with the current id and again on every change. Returns the removal. */
  subscribe(handler: (id: string | null) => void): () => void;
  readonly current: string | null;
}

export function createSessionService(bus: Bus): SessionService {
  let id: string | null = null;
  let tapped = false;
  const handlers = new Set<(id: string | null) => void>();

  function tap(): void {
    if (tapped) return;
    tapped = true;
    bus.on("update_session_state", (payload) => {
      const next = nextSessionId(id, payload);
      if (next === id) return;
      id = next;
      // A copy: a handler may unsubscribe itself, which is what being disabled does.
      for (const handler of [...handlers]) handler(next);
    });
  }

  return {
    subscribe(handler) {
      // Tap before the handler joins the set, so the buffer replay derives the current id without
      // delivering every intermediate value it passed through.
      tap();
      handlers.add(handler);
      handler(id);
      return () => void handlers.delete(handler);
    },
    get current() {
      return id;
    },
  };
}
