/**
 * The person's usual model and effort combinations, one click each, and what is live with its
 * version. The list of models and what is live are the host's (D120), a choice is applied by the host
 * on a person's click, and the default is Rigline's (D139); this keeps the person's list and draws
 * it.
 */
import {
  choiceOf,
  comboLabel,
  type DefaultChoice,
  definePlugin,
  findModel,
  isLive,
  type ModelEntry,
  type ModelState,
  NO_MODEL_STATE,
  type PluginContext,
  type Store,
  storeFrom,
  supportsEffort,
} from "@rigline/plugin-api";
import {
  Actions,
  Button,
  Hint,
  ListEditor,
  MenuItem,
  ModelChooser,
  Pill,
  SettingRow,
  useFlash,
  useSettingsDraft,
  useStore,
} from "@rigline/plugin-api/ui";
import { type MouseEvent, type ReactNode, useState } from "react";

type Section = Readonly<Record<string, unknown>>;

/** The key in this plugin's settings that holds the list. */
const KEY = "favourites";

/** The list as written, whatever it holds, so an edit loses nothing a person wrote by hand. */
export function entriesOf(section: Section): readonly unknown[] {
  const list = section[KEY];
  return Array.isArray(list) ? list : [];
}

/** The favourites that read as choices, in the person's order. */
export function favouritesOf(section: Section): readonly DefaultChoice[] {
  return entriesOf(section).flatMap((entry) => choiceOf(entry) ?? []);
}

/** What a favourite reads as: the version its model resolves to now, else the alias it stores. */
export function favouriteLabel(choice: DefaultChoice, models: readonly ModelEntry[]): string {
  const model = findModel(models, choice.model);
  const effort = choice.effort ?? null;
  return [
    model === null ? choice.model : comboLabel(model, null),
    ...(effort === null ? [] : [effort]),
    ...(choice.thinkingLevel === undefined ? [] : [`thinking ${choice.thinkingLevel}`]),
    ...(choice.ultracode === true ? ["ultracode"] : []),
  ].join(" · ");
}

/** Why `choice` cannot be applied with this list, or null. Before the list arrives, nothing is known. */
export function unavailable(choice: DefaultChoice, models: readonly ModelEntry[]): string | null {
  if (models.length === 0) return null;
  const model = findModel(models, choice.model);
  if (model === null) return "not offered by this install";
  if (choice.effort !== undefined && !supportsEffort(model, choice.effort)) {
    return model.supportsEffort ? `no effort ${choice.effort} for this model` : "takes no effort";
  }
  return null;
}

/** Whether two choices name the same model, resolved where the list has it, and the same effort. */
export function sameChoice(
  a: DefaultChoice,
  b: DefaultChoice,
  models: readonly ModelEntry[],
): boolean {
  const model = (choice: DefaultChoice) => findModel(models, choice.model)?.value ?? choice.model;
  return model(a) === model(b) && a.effort === b.effort && a.thinkingLevel === b.thinkingLevel;
}

/** What is live as a choice, to add or to compare, or null before it is known. */
export function liveChoice(state: ModelState): DefaultChoice | null {
  if (state.current === null) return null;
  return { model: state.current.value, ...(state.effort === null ? {} : { effort: state.effort }) };
}

/**
 * Whether what is live is known: the list has arrived, and so has the setting or an entry for no
 * setting at all. Until then a missing entry is the cold start, not a model gone.
 */
export function liveKnown(state: ModelState): boolean {
  return state.models.length > 0 && (state.current !== null || state.setting !== null);
}

/** What is live, by its version, or the setting as it is where this install does not offer it. */
export function liveLabel(state: ModelState): string {
  return state.current === null
    ? (state.setting ?? "default")
    : comboLabel(state.current, state.effort);
}

/**
 * Whether what is live is one of the favourites or the default. A warning needs something to be off,
 * so with neither set nothing is.
 */
export function offList(state: ModelState, favourites: readonly DefaultChoice[]): boolean {
  if (!liveKnown(state)) return false;
  if (favourites.length === 0 && state.default === null) return false;
  const known = state.default === null ? favourites : [...favourites, state.default.choice];
  return !known.some((choice) => isLive(state, choice));
}

/** Why a favourite cannot be added: no model yet, no effort for one that takes one, or a repeat. */
export function addProblem(
  choice: DefaultChoice | null,
  favourites: readonly DefaultChoice[],
  models: readonly ModelEntry[],
): string | null {
  if (choice === null) return "Choose a model first";
  if (findModel(models, choice.model)?.supportsEffort === true && choice.effort === undefined) {
    return "Choose an effort too, so the favourite sets both";
  }
  if (favourites.some((f) => sameChoice(f, choice, models))) return "Already a favourite";
  return null;
}

interface Stores {
  readonly ctx: PluginContext;
  readonly models: Store<ModelState>;
  readonly settings: Store<Section>;
}

/**
 * Applies `choice` on the person's click. A refusal comes back with its reason rather than
 * disappearing, and a failure to ask at all reads as one.
 */
function apply(
  ctx: PluginContext,
  choice: DefaultChoice,
  event: MouseEvent<HTMLButtonElement>,
  refused: (reason: string) => void,
): void {
  ctx.applyChoice(choice, event.nativeEvent).then(
    (result) => {
      if ("refused" in result) refused(result.refused);
    },
    (e: unknown) => refused(e instanceof Error ? e.message : String(e)),
  );
}

function Chip(props: {
  readonly stores: Stores;
  readonly choice: DefaultChoice;
  readonly state: ModelState;
}): ReactNode {
  const { stores, choice, state } = props;
  const [flash, show] = useFlash();
  const [reason, setReason] = useState<string | null>(null);
  const label = favouriteLabel(choice, state.models);
  const usual = state.default !== null && sameChoice(choice, state.default.choice, state.models);
  const text = usual ? `${label} (default)` : label;
  if (state.models.length === 0) {
    return (
      <Pill muted title="Waiting for Claude Code's model list">
        {text}
      </Pill>
    );
  }
  const problem = unavailable(choice, state.models);
  if (problem !== null) {
    return (
      <Pill muted title={`${label}: ${problem}`}>
        {text}
      </Pill>
    );
  }
  const live = isLive(state, choice);
  return (
    <Pill
      current={live}
      flash={flash}
      title={reason ?? (live ? `${label}: live now` : `Switch to ${label}`)}
      onClick={(event) => {
        setReason(null);
        apply(stores.ctx, choice, event, (why) => {
          setReason(why);
          show("refused");
        });
      }}
    >
      {text}
    </Pill>
  );
}

function Chips(props: { readonly stores: Stores }): ReactNode {
  const { stores } = props;
  const state = useStore(stores.models);
  const favourites = favouritesOf(useStore(stores.settings));
  if (favourites.length === 0) {
    return (
      <Pill
        muted
        title="Add favourites in Rigline's settings"
        onClick={() => stores.ctx.openSettings()}
      >
        No favourites
      </Pill>
    );
  }
  const onAFavourite = favourites.some((choice) => isLive(state, choice));
  const usual = state.default !== null && isLive(state, state.default.choice);
  return (
    <>
      {liveKnown(state) && !onAFavourite && (
        <Pill warning={!usual} title={`Live now: ${liveTooltip(state, usual)}`}>
          {usual ? `${liveLabel(state)} (default)` : liveLabel(state)}
        </Pill>
      )}
      {favourites.map((choice, i) => (
        <Chip key={i} stores={stores} choice={choice} state={state} />
      ))}
    </>
  );
}

/** What the live pill leading the chips says about what is live. */
function liveTooltip(state: ModelState, usual: boolean): string {
  if (state.current === null) return `${liveLabel(state)}, which this install does not offer`;
  return usual ? "your default" : "none of your favourites";
}

/** The tooltip's lines: what is live, what is wrong with it, and what a click does. */
export function statusTooltip(state: ModelState, favourites: readonly DefaultChoice[]): string {
  if (!liveKnown(state)) return "Waiting for Claude Code's model list";
  const lines = [`Live: ${liveLabel(state)}`];
  if (state.current === null) lines.push("This install does not offer that model");
  else if (offList(state, favourites)) lines.push("Not one of your favourites");
  if (state.choiceRequired) lines.push("Not chosen for this session yet");
  lines.push(
    state.default === null
      ? "No default model: click to choose one in Rigline's settings"
      : `Click for your default: ${favouriteLabel(state.default.choice, state.models)}`,
  );
  return lines.join("\n");
}

function Status(props: { readonly stores: Stores }): ReactNode {
  const { stores } = props;
  const state = useStore(stores.models);
  const favourites = favouritesOf(useStore(stores.settings));
  const [flash, show] = useFlash();
  const [reason, setReason] = useState<string | null>(null);
  const waiting = !liveKnown(state);
  const warning = !waiting && (state.current === null || offList(state, favourites));
  return (
    <Pill
      muted={waiting || (!warning && state.choiceRequired)}
      warning={warning}
      flash={flash}
      title={reason ?? statusTooltip(state, favourites)}
      onClick={
        waiting
          ? undefined
          : (event) => {
              setReason(null);
              if (state.default === null) {
                stores.ctx.openSettings("rigline");
                return;
              }
              apply(stores.ctx, state.default.choice, event, (why) => {
                setReason(why);
                show("refused");
              });
            }
      }
    >
      {waiting ? "–" : liveLabel(state)}
    </Pill>
  );
}

/** One row of the list: what it reads as, and what qualifies it. */
function Row(props: { readonly entry: unknown; readonly state: ModelState }): ReactNode {
  const { entry, state } = props;
  const choice = choiceOf(entry);
  if (choice === null) {
    return <Hint>Not a favourite Rigline can read: {JSON.stringify(entry)}</Hint>;
  }
  const problem = unavailable(choice, state.models);
  const usual = state.default !== null && sameChoice(choice, state.default.choice, state.models);
  return (
    <>
      {favouriteLabel(choice, state.models)}
      {usual && " (default)"}
      {problem !== null && <Hint> — {problem}</Hint>}
    </>
  );
}

function Tab(props: { readonly stores: Stores }): ReactNode {
  const { stores } = props;
  const [draft, setDraft] = useSettingsDraft();
  const state = useStore(stores.models);
  const [pending, setPending] = useState<DefaultChoice | null>(null);
  const entries = entriesOf(draft);
  const favourites = favouritesOf(draft);
  const save = (next: readonly unknown[]): void => setDraft({ ...draft, [KEY]: next });
  const add = (choice: DefaultChoice): void => save([...entries, choice]);
  const live = liveChoice(state);
  const pendingProblem = addProblem(pending, favourites, state.models);
  const liveProblem =
    live === null
      ? "Waiting for Claude Code's model list"
      : addProblem(live, favourites, state.models);
  return (
    <>
      <SettingRow label="Favourites" hint="Each is a chip under the composer; a click applies it.">
        <ListEditor
          items={entries}
          onChange={save}
          noun="favourite"
          empty="None yet."
          render={(entry) => <Row entry={entry} state={state} />}
        />
      </SettingRow>
      <SettingRow label="Add a favourite" hint="A model, then the effort to use it at.">
        <ModelChooser state={state} value={pending} onChange={setPending} />
        <Actions>
          <Button
            disabled={pendingProblem !== null}
            title={pendingProblem ?? undefined}
            onClick={() => {
              if (pending === null) return;
              add(pending);
              setPending(null);
            }}
          >
            Add
          </Button>
          <Button
            disabled={liveProblem !== null}
            title={liveProblem ?? undefined}
            onClick={() => {
              if (live !== null) add(live);
            }}
          >
            {state.current === null
              ? "Add current model"
              : `Add current model (${liveLabel(state)})`}
          </Button>
        </Actions>
      </SettingRow>
      <SettingRow
        label="Default"
        hint="Rigline's own setting: the status pill applies it, and the gate can compare against it."
      >
        <span>
          {state.default === null ? "None set" : favouriteLabel(state.default.choice, state.models)}
        </span>
        <Button onClick={() => stores.ctx.openSettings("rigline")}>
          Change in Rigline's settings
        </Button>
      </SettingRow>
    </>
  );
}

export default definePlugin({
  setup(ctx: PluginContext) {
    const stores: Stores = {
      ctx,
      models: storeFrom(ctx.onModelState, NO_MODEL_STATE),
      settings: storeFrom(ctx.onSettings, ctx.settings),
    };
    ctx.element("chips", () => <Chips stores={stores} />);
    ctx.element("status", () => <Status stores={stores} />);
    ctx.menu(() => <MenuItem label="Model favourites…" onSelect={() => ctx.openSettings()} />);
    ctx.settingsTab("Model favourites", () => <Tab stores={stores} />);
  },
});
