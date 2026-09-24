/**
 * `@rigline/plugin-api/ui`: the React half of the plugin API.
 *
 * The panel serves this module, so every plugin runs the one copy Rigline shipped (D87); `rigline
 * build` leaves imports of it for `install` to point there. The root, `@rigline/plugin-api`, never
 * imports React, which is what lets core use it in Node.
 */
import { useSyncExternalStore } from "react";
import type { Store } from "../store.ts";

export {
  MenuItem,
  type MenuItemProps,
  MenuNote,
  type MenuNoteProps,
  type MenuSelectEvent,
  Submenu,
  type SubmenuProps,
} from "./menu.tsx";
export { Pill, type PillProps } from "./pill.tsx";

/** A store's current value, re-rendering whenever it changes. */
export function useStore<T>(source: Store<T>): T {
  return useSyncExternalStore(source.subscribe, source.get);
}
