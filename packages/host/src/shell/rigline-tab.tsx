/**
 * Rigline's own settings tab: the gate's mode and the default model (D139). Drawn from the kit and
 * added through the path a plugin's tab takes, so the screen has one mechanism and this is its first
 * user. The draft is `{ model }`, which the screen's Save carries beside the plugins' sections.
 */
import {
  comboLabel,
  type DefaultChoice,
  type ModelSettings,
  NO_MODEL_SETTINGS,
  type RequireChoice,
  sameValue,
} from "@rigline/plugin-api/internal";
import {
  Button,
  Choice,
  ModelChooser,
  SettingRow,
  useSettingsDraft,
  useStore,
} from "@rigline/plugin-api/ui";
import type { ReactNode } from "react";
import type { RiglineTab } from "./types.ts";

const MODES: readonly { readonly value: RequireChoice; readonly label: string; hint?: string }[] = [
  { value: "off", label: "Never" },
  {
    value: "unlessDefault",
    label: "When it isn't my default",
    hint: "Compared with the default below",
  },
  { value: "always", label: "Every session" },
];

export const riglineTab: RiglineTab = (models) =>
  function RiglineSettings(): ReactNode {
    const [draft, setDraft] = useSettingsDraft();
    const state = useStore(models);
    const model = (draft.model as ModelSettings | undefined) ?? NO_MODEL_SETTINGS;
    const update = (next: Partial<ModelSettings>): void =>
      setDraft({ ...draft, model: { ...model, ...next } });
    const live: DefaultChoice | null =
      state.current === null
        ? null
        : {
            model: state.current.value,
            ...(state.effort === null ? {} : { effort: state.effort }),
          };
    return (
      <>
        <SettingRow
          label="Ask for a model before sending"
          hint="The prompt waits until a model is chosen for the session. Typing never does."
        >
          <Choice
            options={MODES}
            value={model.requireChoice}
            onChange={(mode) => update({ requireChoice: mode as RequireChoice })}
          />
        </SettingRow>
        <SettingRow
          label="Default model"
          hint={
            model.requireChoice === "unlessDefault" && model.default === null
              ? "With none, every session asks."
              : "Matched on model and effort. Plugins offer it as yours."
          }
        >
          <ModelChooser
            state={state}
            value={model.default}
            onChange={(choice) => update({ default: choice })}
            none="No default"
          />
          {live !== null && state.current !== null && !sameValue(live, model.default) && (
            <Button onClick={() => update({ default: live })}>
              Use {comboLabel(state.current, state.effort)}
            </Button>
          )}
        </SettingRow>
      </>
    );
  };
