/**
 * The person's usual model and effort combinations as one pill split into segments, a click each,
 * and their default beside it. The list of models and what is live are the panel's own (D120), a
 * choice is applied through the panel's own controls on a person's click, and the default is
 * Rigline's (D139); this keeps the person's list and draws it.
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
  PillGroup,
  SettingRow,
  useFlash,
  useSettingsDraft,
  useStore,
} from "@rigline/plugin-api/ui";
import { Fragment, type MouseEvent, type ReactNode, useState } from "react";

type Section = Readonly<Record<string, unknown>>;

/** The key in this plugin's settings that holds the list. */
const KEY = "favourites";

const WAITING = "Waiting for Claude Code's model list";

/** The list as written, whatever it holds, so an edit loses nothing a person wrote by hand. */
export function entriesOf(section: Section): readonly unknown[] {
  const list = section[KEY];
  return Array.isArray(list) ? list : [];
}

/** The favourites that read as choices, in the person's order. */
export function favouritesOf(section: Section): readonly DefaultChoice[] {
  return entriesOf(section).flatMap((entry) => choiceOf(entry) ?? []);
}

/** The model a choice names: its entry's alias where the list has it, else the alias it stores. */
function modelOf(choice: DefaultChoice, models: readonly ModelEntry[]): string {
  return findModel(models, choice.model)?.value ?? choice.model;
}

/** What a favourite carries besides its model: its effort, thinking level and ultracode. */
function settingsOf(choice: DefaultChoice): string[] {
  return [
    ...(choice.effort === undefined ? [] : [choice.effort]),
    ...(choice.thinkingLevel === undefined ? [] : [`thinking ${choice.thinkingLevel}`]),
    ...(choice.ultracode === true ? ["ultracode"] : []),
  ];
}

/** What a favourite reads as: the version its model resolves to now, else the alias it stores. */
export function favouriteLabel(choice: DefaultChoice, models: readonly ModelEntry[]): string {
  const model = findModel(models, choice.model);
  return [model === null ? choice.model : comboLabel(model, null), ...settingsOf(choice)].join(
    " · ",
  );
}

/** Adjacent favourites on one model, drawn as the model's segment and then one segment each. */
export interface Run {
  /** The model's alias, resolved where the list has it. */
  readonly model: string;
  /** What the model's segment reads: its version, else the alias. */
  readonly label: string;
  /** The run's favourites, each with what its own segment reads; empty for nothing to add. */
  readonly favourites: readonly { readonly choice: DefaultChoice; readonly label: string }[];
}

/**
 * The favourites as runs, so a model is named once however many efforts follow it. A favourite with
 * nothing beside its model starts a run of its own, since the model's segment is what applies it.
 */
export function runsOf(
  favourites: readonly DefaultChoice[],
  models: readonly ModelEntry[],
): readonly Run[] {
  const runs: { model: string; label: string; favourites: Run["favourites"][number][] }[] = [];
  for (const choice of favourites) {
    const model = modelOf(choice, models);
    const label = settingsOf(choice).join(" · ");
    const last = runs.at(-1);
    if (last !== undefined && last.model === model && label !== "") {
      last.favourites.push({ choice, label });
    } else {
      const entry = findModel(models, choice.model);
      runs.push({
        model,
        label: entry === null ? choice.model : comboLabel(entry, null),
        favourites: [{ choice, label }],
      });
    }
  }
  return runs;
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
  return (
    modelOf(a, models) === modelOf(b, models) &&
    a.effort === b.effort &&
    a.thinkingLevel === b.thinkingLevel
  );
}

/** What is live as a choice, to add, or null before it is known. */
export function liveChoice(state: ModelState): DefaultChoice | null {
  if (state.current === null) return null;
  return { model: state.current.value, ...(state.effort === null ? {} : { effort: state.effort }) };
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

/** A pill whose click applies `choice`, flashing a refusal and keeping its reason as the tooltip. */
function Choosing(props: {
  readonly stores: Stores;
  readonly choice: DefaultChoice;
  readonly state: ModelState;
  readonly label: string;
  readonly current: boolean;
  /** The tooltip while nothing has been refused, in place of what the choice reads as. */
  readonly title?: string;
}): ReactNode {
  const { stores, choice, state, label, current } = props;
  const [flash, show] = useFlash();
  const [reason, setReason] = useState<string | null>(null);
  if (state.models.length === 0) {
    return (
      <Pill muted title={WAITING}>
        {label}
      </Pill>
    );
  }
  const problem = unavailable(choice, state.models);
  if (problem !== null) {
    return (
      <Pill muted title={`${favouriteLabel(choice, state.models)}: ${problem}`}>
        {label}
      </Pill>
    );
  }
  const full = favouriteLabel(choice, state.models);
  const title = props.title ?? (isLive(state, choice) ? `${full}: live now` : `Switch to ${full}`);
  return (
    <Pill
      current={current}
      flash={flash}
      title={reason ?? title}
      onClick={(event) => {
        setReason(null);
        apply(stores.ctx, choice, event, (why) => {
          setReason(why);
          show("refused");
        });
      }}
    >
      {label}
    </Pill>
  );
}

function Favourites(props: { readonly stores: Stores }): ReactNode {
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
  return (
    <PillGroup label="Model favourites">
      {runsOf(favourites, state.models).map((run, r) => (
        <Fragment key={r}>
          {/* The model's own segment, lit while the model is, and applying the effort beside it. */}
          <Choosing
            stores={stores}
            choice={(run.favourites[0] as Run["favourites"][number]).choice}
            state={state}
            label={run.label}
            current={state.current?.value === run.model}
          />
          {run.favourites.map(
            ({ choice, label }, i) =>
              label !== "" && (
                <Choosing
                  key={i}
                  stores={stores}
                  choice={choice}
                  state={state}
                  label={label}
                  current={isLive(state, choice)}
                />
              ),
          )}
        </Fragment>
      ))}
    </PillGroup>
  );
}

function Default(props: { readonly stores: Stores }): ReactNode {
  const { stores } = props;
  const state = useStore(stores.models);
  if (state.models.length === 0) {
    return (
      <Pill muted title={WAITING}>
        –
      </Pill>
    );
  }
  if (state.default === null) {
    return (
      <Pill
        muted
        title="No default model: click to choose one in Rigline's settings"
        onClick={() => stores.ctx.openSettings("rigline")}
      >
        No default
      </Pill>
    );
  }
  const { choice } = state.default;
  const label = favouriteLabel(choice, state.models);
  return (
    <Choosing
      stores={stores}
      choice={choice}
      state={state}
      label={label}
      current={isLive(state, choice)}
      title={isLive(state, choice) ? "Your default, live now" : "Switch to your default"}
    />
  );
}

/** One row of the list: what it reads as, and what is wrong with it. */
function Row(props: { readonly entry: unknown; readonly state: ModelState }): ReactNode {
  const { entry, state } = props;
  const choice = choiceOf(entry);
  if (choice === null) {
    return <Hint>Not a favourite Rigline can read: {JSON.stringify(entry)}</Hint>;
  }
  const problem = unavailable(choice, state.models);
  return (
    <>
      {favouriteLabel(choice, state.models)}
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
  const liveProblem = live === null ? WAITING : addProblem(live, favourites, state.models);
  return (
    <>
      <SettingRow
        label="Favourites"
        hint="One pill under the composer, a segment each; a click applies it."
      >
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
              : `Add current model (${comboLabel(state.current, state.effort)})`}
          </Button>
        </Actions>
      </SettingRow>
      <SettingRow
        label="Default"
        hint="Rigline's own setting: its pill applies it, and the gate can compare against it."
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
    ctx.element("favourites", () => <Favourites stores={stores} />);
    ctx.element("default", () => <Default stores={stores} />);
    ctx.menu(() => <MenuItem label="Model favourites…" onSelect={() => ctx.openSettings()} />);
    ctx.settingsTab("Model favourites", () => <Tab stores={stores} />);
  },
});
