/**
 * State that cannot live in a component: shared between a plugin's contributions, which have no
 * common React parent, or caught from boot, which an effect runs too late for. React reads one with
 * `useStore` from `@rigline/plugin-api/ui`; everything else is ordinary React state.
 */
import type { Teardown } from "./context.ts";

export interface Store<T> {
  get(): T;
  /** Replace the value, and tell every subscriber unless it is the same value. */
  set(next: T): void;
  /** Call `listener` after every change. Returns the removal. */
  subscribe(listener: () => void): Teardown;
}

export function store<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      // A copy: a listener may unsubscribe itself.
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/**
 * A store fed by a `ctx.on*` subscription, subscribed as this is called — so called in `setup`, it
 * sees what the host replays from boot. The subscription lasts as long as the plugin, like any other.
 *
 *     const sessionId = storeFrom(ctx.onSessionId, null);
 *     const renames = storeFrom((handler) => ctx.onMessage("rename_tab", handler), null);
 */
export function storeFrom<T, I = T>(
  subscribe: (handler: (value: T) => void) => Teardown,
  initial: I,
): Store<T | I> {
  const result = store<T | I>(initial);
  subscribe((value) => result.set(value));
  return result;
}
