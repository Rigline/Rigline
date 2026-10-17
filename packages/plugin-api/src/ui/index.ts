/**
 * `@rigline/plugin-api/ui`: the React half of the plugin API.
 *
 * The panel serves this module, so every plugin runs the one copy Rigline shipped (D87); `rigline
 * build` leaves imports of it for `install` to point there. The root, `@rigline/plugin-api`, never
 * imports React, which is what lets core use it in Node.
 */
import { useSyncExternalStore } from "react";
import type { Store } from "../store.ts";

export { copyText, useFlash } from "./copy.ts";
export { useSettingsDraft } from "./draft.ts";
export {
  Actions,
  type ActionsProps,
  Button,
  type ButtonProps,
  Choice,
  type ChoiceOption,
  type ChoiceProps,
  Hint,
  type HintProps,
  ListEditor,
  type ListEditorProps,
  ModelChooser,
  type ModelChooserProps,
  SettingRow,
  type SettingRowProps,
  TextField,
  type TextFieldProps,
  Toggle,
  type ToggleProps,
} from "./kit.tsx";
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
export { SaveSettings, type SaveSettingsProps } from "./settings.tsx";

/** A store's current value, re-rendering whenever it changes. */
export function useStore<T>(source: Store<T>): T {
  return useSyncExternalStore(source.subscribe, source.get);
}
