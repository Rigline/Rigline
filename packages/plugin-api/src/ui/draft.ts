/**
 * A settings tab's draft. The host holds it, so it outlives switching tabs and closing the screen,
 * and a tab is a controlled view over it: the screen's one Save writes every draft that differs from
 * what is saved, each stamped with the tab's owner.
 */
import { createContext, useContext, useSyncExternalStore } from "react";

/** What the screen provides around one tab. Null outside one, and in any copy a plugin bundled. */
export interface SettingsDraft {
  /** The tab's owner, whose section the draft is. */
  readonly owner: string;
  readonly get: () => Readonly<Record<string, unknown>>;
  readonly set: (next: Readonly<Record<string, unknown>>) => void;
  readonly subscribe: (onChange: () => void) => () => void;
}

export const DraftContext = createContext<SettingsDraft | null>(null);

/**
 * This tab's settings as the person is editing them: the whole section, frozen, and a setter that
 * replaces it. What is saved is the starting point, so a key a person wrote by hand is in here too;
 * keep the keys you do not know when you set.
 */
export function useSettingsDraft(): readonly [
  Readonly<Record<string, unknown>>,
  (next: Readonly<Record<string, unknown>>) => void,
] {
  const draft = useContext(DraftContext);
  if (draft === null) {
    throw new Error(
      "useSettingsDraft works only inside a settings tab. A plugin that bundles @rigline/plugin-api/ui has its own copy, which the screen cannot see: leave it external.",
    );
  }
  return [useSyncExternalStore(draft.subscribe, draft.get), draft.set];
}
