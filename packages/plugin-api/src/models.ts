/**
 * Which models this install offers, and which one is live, read off the two messages that carry the
 * panel's own model state (D120 as amended).
 *
 * Pure: the panel's merge of a config reply and an `update_state`, and the lookup that turns a
 * stored model setting into an entry of the list. The host's models service holds the state.
 *
 * Every shape here was read in the webview bundle of 2.1.300, which is what `generated.ts` is
 * harvested from. There is no documentation for any of it.
 */

/** One model the install offers, as the panel's own picker reads it. */
export interface ModelEntry {
  /** The alias the panel stores and sends, such as `opus`. `"default"` means no explicit choice. */
  readonly value: string;
  /** The concrete id the alias resolves to, which moves under the alias as models are released. */
  readonly resolvedModel: string | null;
  readonly displayName: string | null;
  /** Whether this model takes an effort level. When false, thinking level is its mechanism. */
  readonly supportsEffort: boolean;
  /** The efforts it accepts. The panel's own default when the entry does not say. */
  readonly supportedEffortLevels: readonly string[];
}

/** The efforts the panel assumes for a model that supports effort and lists none. */
export const DEFAULT_EFFORT_LEVELS: readonly string[] = ["low", "medium", "high"];

/** What the install offers, and what is live in this panel. */
export interface ModelState {
  /** Every model offered, in the order the panel lists them. Empty before the first config. */
  readonly models: readonly ModelEntry[];
  /** Models named as unavailable, which the picker shows but does not offer. */
  readonly unavailable: readonly string[];
  /** The live model, resolved against `models`, or null where nothing matches it yet. */
  readonly current: ModelEntry | null;
  /** The model setting as the panel holds it, which is an alias and not always in `models`. */
  readonly setting: string | null;
  /** The live effort, or null where none is set or the live model takes none. */
  readonly effort: string | null;
  /**
   * Rigline's default from `config.yaml`, with the entry it resolves to, or null where none is set
   * or it names a model this install no longer offers.
   */
  readonly default: ResolvedDefault | null;
  /**
   * Whether a prompt in this session waits for a model to be chosen before it can be sent. Always
   * false with the gate off, and false once anything has chosen in this session.
   */
  readonly choiceRequired: boolean;
}

export const NO_MODEL_STATE: ModelState = Object.freeze({
  models: [],
  unavailable: [],
  current: null,
  setting: null,
  effort: null,
  default: null,
  choiceRequired: false,
});

/** When the gate asks for a choice before a send: `config.yaml`'s `model.requireChoice`. */
export type RequireChoice = "off" | "unlessDefault" | "always";

export const REQUIRE_CHOICE: readonly RequireChoice[] = ["off", "unlessDefault", "always"];

/** The combination a person usually wants: a choice, and one that names a model. */
export type DefaultChoice = ModelChoice & { readonly model: string };

/** Rigline's own model settings: `config.yaml`'s `model` block. */
export interface ModelSettings {
  readonly requireChoice: RequireChoice;
  readonly default: DefaultChoice | null;
}

export const NO_MODEL_SETTINGS: ModelSettings = Object.freeze({
  requireChoice: "off",
  default: null,
});

/** The default with the entry its model resolves to now, so its version can be shown. */
export interface ResolvedDefault {
  readonly choice: DefaultChoice;
  readonly model: ModelEntry;
}

const MODEL_KEYS = ["requireChoice", "default"];
const CHOICE_KEYS = ["model", "effort", "thinkingLevel", "ultracode"];

/**
 * The `model` block as written, or why it cannot be read.
 *
 * What this version does not understand is kept apart from what is wrong. A key or a mode a later
 * Rigline wrote reads as absent and is listed in `unknown`, dotted, for the report (D110); a value
 * of the wrong shape is a person's mistake. An unknown mode reads as `off`, so a gate that cannot
 * say what it is doing does nothing.
 */
export function readModelSettings(
  value: unknown,
):
  | { readonly settings: ModelSettings; readonly unknown: readonly string[] }
  | { readonly problem: string } {
  if (value === undefined || value === null) return { settings: NO_MODEL_SETTINGS, unknown: [] };
  const block = asRecord(value);
  if (block === null) return { problem: '"model" must be a mapping of settings' };
  const unknown = Object.keys(block)
    .filter((key) => !MODEL_KEYS.includes(key))
    .map((key) => `model.${key}`);
  let requireChoice: RequireChoice = "off";
  const mode = block.requireChoice;
  if (mode !== undefined && mode !== null) {
    if (typeof mode !== "string") {
      return { problem: `"model.requireChoice" must be one of ${REQUIRE_CHOICE.join(", ")}` };
    }
    if ((REQUIRE_CHOICE as readonly string[]).includes(mode)) requireChoice = mode as RequireChoice;
    else unknown.push(`model.requireChoice: ${mode}`);
  }
  const read = defaultOf(block.default);
  if ("problem" in read) return read;
  return {
    settings: { requireChoice, default: read.choice },
    unknown: [...unknown, ...read.unknown],
  };
}

function defaultOf(
  value: unknown,
): { readonly choice: DefaultChoice | null; readonly unknown: string[] } | { problem: string } {
  if (value === undefined || value === null) return { choice: null, unknown: [] };
  const record = asRecord(value);
  const model = text(record?.model);
  if (record === null || model === null) {
    return { problem: '"model.default" must name a model, as in { model: opus, effort: high }' };
  }
  const effort = record.effort ?? undefined;
  const thinkingLevel = record.thinkingLevel ?? undefined;
  const ultracode = record.ultracode ?? undefined;
  if (effort !== undefined && text(effort) === null) {
    return { problem: '"model.default.effort" must be an effort level, such as high' };
  }
  if (thinkingLevel !== undefined && text(thinkingLevel) === null) {
    return { problem: '"model.default.thinkingLevel" must be a thinking level' };
  }
  if (effort !== undefined && thinkingLevel !== undefined) {
    return { problem: '"model.default" takes an effort or a thinking level, never both' };
  }
  if (ultracode !== undefined && typeof ultracode !== "boolean") {
    return { problem: '"model.default.ultracode" must be true or false' };
  }
  return {
    choice: {
      model,
      ...(effort === undefined ? {} : { effort: effort as string }),
      ...(thinkingLevel === undefined ? {} : { thinkingLevel: thinkingLevel as string }),
      ...(ultracode === undefined ? {} : { ultracode }),
    },
    unknown: Object.keys(record)
      .filter((key) => !CHOICE_KEYS.includes(key))
      .map((key) => `model.default.${key}`),
  };
}

/**
 * The two configs the panel keeps, and which one it draws.
 *
 * A config reply carries `stored`, and a stored one lands in a different slot from a live one;
 * `update_state` replaces the live one and clears the stored one, so the fallback is discarded the
 * moment a live config arrives. Holding one slot is not a simplification but a cold-start bug: the
 * first reply is usually the cached one.
 */
export interface Configs {
  readonly live: ClaudeConfig | undefined;
  readonly stored: ClaudeConfig | undefined;
}

/** The part of the panel's `claudeConfig` this reads. Everything else in it is left alone. */
export interface ClaudeConfig {
  readonly models?: unknown;
  readonly unavailable_models?: unknown;
  readonly account?: unknown;
}

export const NO_CONFIGS: Configs = Object.freeze({ live: undefined, stored: undefined });

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** A config, or undefined where the payload does not carry one. Fields are read lazily, not here. */
function configOf(value: unknown): ClaudeConfig | undefined {
  const record = asRecord(value);
  return record ?? undefined;
}

/**
 * `configs` after a reply to `get_claude_state`: the config goes to the stored slot when the reply
 * says `stored`, and to the live slot otherwise.
 */
export function configsAfterReply(configs: Configs, payload: unknown): Configs {
  const record = asRecord(payload);
  if (record === null) return configs;
  const config = configOf(record.config);
  if (config === undefined) return configs;
  return record.stored === true ? { ...configs, stored: config } : { ...configs, live: config };
}

/**
 * `configs` after an `update_state`: the live slot is replaced by the panel's own rule, and the
 * stored slot is cleared whether or not a config came with it.
 *
 * The panel's rule, which this reproduces: a config that is defined replaces wholesale, and one
 * that is not leaves the current config in place, emptying a non-empty `account`.
 */
export function configsAfterState(configs: Configs, request: unknown): Configs {
  const record = asRecord(request);
  if (record === null) return configs;
  const incoming = configOf(record.config);
  if (incoming !== undefined) return { live: incoming, stored: undefined };
  const current = configs.live;
  if (current === undefined) return { live: undefined, stored: undefined };
  const account = asRecord(current.account);
  const live =
    account === null || Object.keys(account).length === 0 ? current : { ...current, account: {} };
  return { live, stored: undefined };
}

/** The config the panel would draw: the live one, else the stored fallback. */
export function drawnConfig(configs: Configs): ClaudeConfig | undefined {
  return configs.live ?? configs.stored;
}

function entryOf(value: unknown): ModelEntry | null {
  const record = asRecord(value);
  const alias = text(record?.value);
  if (record === null || alias === null) return null;
  const levels = Array.isArray(record.supportedEffortLevels)
    ? record.supportedEffortLevels.filter((level): level is string => typeof level === "string")
    : null;
  return {
    value: alias,
    resolvedModel: text(record.resolvedModel),
    displayName: text(record.displayName),
    supportsEffort: record.supportsEffort === true,
    supportedEffortLevels: levels ?? DEFAULT_EFFORT_LEVELS,
  };
}

/** Every model a config offers, skipping an entry with no `value` to be known by. */
export function modelsOf(config: ClaudeConfig | undefined): readonly ModelEntry[] {
  if (!Array.isArray(config?.models)) return [];
  return config.models.flatMap((value) => entryOf(value) ?? []);
}

/** The models a config names as unavailable. */
export function unavailableOf(config: ClaudeConfig | undefined): readonly string[] {
  if (!Array.isArray(config?.unavailable_models)) return [];
  return config.unavailable_models.filter((name): name is string => typeof name === "string");
}

/** The million-token marker the panel strips before matching a setting against an alias. */
const MILLION = /\[1m\]$/i;

/**
 * The entry a model setting names, by the panel's own chain: the alias as stored, then the alias
 * with the million-token marker stripped, then an entry whose concrete id it is.
 *
 * Null where nothing matches, which is a real state rather than a failure — a setting naming a model
 * this install no longer offers reads as no current model, and that is what the warning state is for.
 */
export function currentModel(
  models: readonly ModelEntry[],
  setting: string | null,
): ModelEntry | null {
  const alias = setting === null || setting === "" ? "default" : setting;
  const stripped = alias.replace(MILLION, "");
  return (
    models.find((model) => model.value === alias) ??
    models.find((model) => model.value === stripped) ??
    models.find((model) => model.resolvedModel !== null && model.resolvedModel === alias) ??
    null
  );
}

/** The model setting an `update_state` request carries, or null where it names none. */
export function settingOf(request: unknown): string | null {
  const state = asRecord(asRecord(request)?.state);
  return text(state?.modelSetting);
}

/**
 * The effort an `update_state` request carries, or null.
 *
 * `state.settings.effortLevel` is what the panel seeds its own effort from. Read from the state
 * rather than from the config, because effort is a setting and not a property of the install.
 */
export function effortOf(request: unknown): string | null {
  const state = asRecord(asRecord(request)?.state);
  return text(asRecord(state?.settings)?.effortLevel);
}

/** Whether an effort is one the model accepts, which is the only table worth consulting. */
export function supportsEffort(model: ModelEntry | null, effort: string): boolean {
  return model !== null && model.supportsEffort && model.supportedEffortLevels.includes(effort);
}

/** The default with the entry it names in `models`, or null where it names none of them. */
export function resolvedDefault(
  models: readonly ModelEntry[],
  choice: DefaultChoice | null,
): ResolvedDefault | null {
  if (choice === null) return null;
  const model = currentModel(models, choice.model);
  return model === null ? null : { choice, model };
}

/**
 * Whether what is live is the default: the same entry, and the same effort where the default names
 * one. Model and effort only, since they are what persists between sessions and so what drifts.
 */
export function isDefaultLive(
  current: ModelEntry | null,
  effort: string | null,
  usual: ResolvedDefault | null,
): boolean {
  if (usual === null || current === null || current.value !== usual.model.value) return false;
  return usual.choice.effort === undefined || usual.choice.effort === effort;
}

/**
 * Whether a send waits for a choice. Mode 2 asks whenever the default is not known to be live, so a
 * list that has not arrived yet asks rather than letting through what the person asked to stop.
 */
export function choiceRequired(
  settings: ModelSettings,
  chosen: boolean,
  current: ModelEntry | null,
  effort: string | null,
  usual: ResolvedDefault | null,
): boolean {
  if (settings.requireChoice === "off" || chosen) return false;
  if (settings.requireChoice === "always") return true;
  return !isDefaultLive(current, effort, usual);
}

/** Whether applying `choice` chose a model for the session, which an ultracode switch alone does not. */
export function choosesModel(choice: ModelChoice): boolean {
  return (
    choice.model !== undefined || choice.effort !== undefined || choice.thinkingLevel !== undefined
  );
}

/** What `configs`, the panel's own settings and Rigline's model settings read as. */
export function modelStateOf(
  configs: Configs,
  setting: string | null,
  effort: string | null,
  settings: ModelSettings = NO_MODEL_SETTINGS,
  chosen = false,
): ModelState {
  const config = drawnConfig(configs);
  const models = modelsOf(config);
  const current = currentModel(models, setting);
  // An effort the live model does not take is not live, whatever the file says: the panel's own
  // controls only show one for a model that supports it.
  const live = effort !== null && supportsEffort(current, effort) ? effort : null;
  const usual = resolvedDefault(models, settings.default);
  return {
    models,
    unavailable: unavailableOf(config),
    current,
    setting,
    effort: live,
    default: usual,
    choiceRequired: choiceRequired(settings, chosen, current, live, usual),
  };
}

/** A concrete Anthropic model id: a family and a version, then perhaps a date and the 1M marker. */
const MODEL_ID = /^claude-([a-z]{1,16})-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?(?:\[1m\])?$/i;

/**
 * What a person reads for a model: its family and the version its alias resolves to now.
 *
 * The CLI names an alias by its family alone, "Opus", and keeps the version in the concrete id, so
 * the version is read from there. An id of any other shape is shown whole rather than guessed (P5).
 */
export function modelLabel(model: ModelEntry): string {
  const name = model.displayName ?? model.value;
  const id = model.resolvedModel;
  if (id === null || id === name) return name;
  const parts = MODEL_ID.exec(id);
  if (parts === null) return `${name} (${id})`;
  const [, family = "", major = "", minor] = parts;
  const title = `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()}`;
  return `${title} ${minor === undefined ? major : `${major}.${minor}`}`;
}

/** A model and its effort as one label: `Opus 5.5 · high`. */
export function comboLabel(model: ModelEntry, effort: string | null): string {
  return effort === null ? modelLabel(model) : `${modelLabel(model)} · ${effort}`;
}

/** Whether two states say the same, so a service publishes only on a change. */
export function sameModelState(a: ModelState, b: ModelState): boolean {
  return (
    a.setting === b.setting &&
    a.effort === b.effort &&
    a.choiceRequired === b.choiceRequired &&
    a.default?.choice === b.default?.choice &&
    a.default?.model.value === b.default?.model.value &&
    a.current?.value === b.current?.value &&
    a.models.length === b.models.length &&
    a.unavailable.length === b.unavailable.length &&
    a.models.every((model, i) => sameEntry(model, b.models[i])) &&
    a.unavailable.every((name, i) => name === b.unavailable[i])
  );
}

function sameEntry(a: ModelEntry, b: ModelEntry | undefined): boolean {
  return (
    b !== undefined &&
    a.value === b.value &&
    a.resolvedModel === b.resolvedModel &&
    a.displayName === b.displayName &&
    a.supportsEffort === b.supportsEffort &&
    a.supportedEffortLevels.length === b.supportedEffortLevels.length &&
    a.supportedEffortLevels.every((level, i) => level === b.supportedEffortLevels[i])
  );
}

/**
 * What a favourite is: a model, and the effort or thinking level that goes with it (D120 as
 * amended).
 *
 * **The field set is closed here and nowhere else.** `apply_settings` reaches six keys of Claude
 * Code's own `WEBVIEW_WRITABLE_SETTINGS`, so a bag a plugin could add a key to would be a pipe into
 * all six; enumerating them is what makes the combination the vetted unit rather than the transport.
 * Every field is optional, and one omitted is left alone.
 */
export interface ModelChoice {
  /** A model's `value` from the live list. `"default"` is one of them where the install offers it. */
  readonly model?: string;
  /** One of that model's `supportedEffortLevels`. Only for a model whose `supportsEffort` is true. */
  readonly effort?: string;
  /** The other mechanism, for a model whose `supportsEffort` is false. Never both. */
  readonly thinkingLevel?: string;
  readonly ultracode?: boolean;
}

/** What a choice turned out to be, as far as the panel could tell. */
export interface AppliedChoice {
  /**
   * What `set_model_response` said was applied, or null where it said nothing — the reply omits
   * `applied` when the write returned nothing, so not knowing is a real answer and not a failure.
   */
  readonly model: string | null;
  readonly effort: string | null;
  readonly thinkingLevel: string | null;
  readonly ultracode: boolean | null;
}

/** A choice applied, or why it was not. A caller that cannot tell the two apart is P5's mistake. */
export type ChoiceResult = { readonly applied: AppliedChoice } | { readonly refused: string };

/**
 * Why `choice` cannot be applied against `state`, or null.
 *
 * Validated against the live list and never a table of ours: a favourite pairing a model with an
 * effort it does not support is incoherent, and a model's supported set moves under it as models are
 * released. Which is also why this takes the state rather than caching anything.
 */
export function choiceProblem(state: ModelState, choice: ModelChoice): string | null {
  const keys = Object.keys(choice);
  if (keys.length === 0) return "a choice has to name something";
  if (choice.effort !== undefined && choice.thinkingLevel !== undefined) {
    return "a choice carries an effort or a thinking level, never both";
  }
  // The model the rest of the choice is judged against: the one being set, else the live one.
  const target =
    choice.model === undefined ? state.current : currentModel(state.models, choice.model);
  if (choice.model !== undefined && target === null) {
    return `this install does not offer the model "${choice.model}"`;
  }
  if (choice.effort !== undefined) {
    if (target === null) return "no model is live, so there is nothing an effort applies to";
    if (!target.supportsEffort) return `${target.value} does not take an effort level`;
    if (!target.supportedEffortLevels.includes(choice.effort)) {
      return `${target.value} does not take the effort "${choice.effort}"`;
    }
  }
  if (choice.thinkingLevel !== undefined && target !== null && target.supportsEffort) {
    return `${target.value} takes an effort level rather than a thinking level`;
  }
  return null;
}

/** The `model` field `set_model` requires: an object whose `value` is a string. */
export function setModelField(model: string): { readonly value: string } {
  return { value: model };
}

/** The `applied` a `set_model_response` carries, or null where it carried none. */
export function appliedModelOf(reply: unknown): string | null {
  const record = reply as { readonly applied?: unknown } | null;
  const applied = typeof record === "object" && record !== null ? record.applied : undefined;
  return typeof applied === "string" && applied !== "" ? applied : null;
}
