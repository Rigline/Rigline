/**
 * The model derivation: the two configs the panel keeps, the lookup chain, and what counts as a live
 * effort. Every shape asserted here was read in the 2.1.300 webview bundle.
 */
import { describe, expect, it } from "vitest";
import {
  appliedModelOf,
  choiceProblem,
  choosesModel,
  comboLabel,
  configsAfterReply,
  configsAfterState,
  currentModel,
  DEFAULT_EFFORT_LEVELS,
  drawnConfig,
  effortOf,
  type ModelEntry,
  modelLabel,
  type ModelSettings,
  modelStateOf,
  modelsOf,
  NO_CONFIGS,
  NO_MODEL_SETTINGS,
  readModelSettings,
  sameModelState,
  setModelField,
  settingOf,
  supportsEffort,
  unavailableOf,
} from "./models.ts";

const opus = {
  value: "opus",
  resolvedModel: "claude-opus-5",
  displayName: "Opus",
  supportsEffort: true,
  supportedEffortLevels: ["medium", "high"],
};
const haiku = { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku" };

const config = { models: [opus, haiku], unavailable_models: ["sonnet"] };

describe("the two configs the panel keeps", () => {
  it("puts a stored reply in the stored slot and a live one in the live slot", () => {
    const stored = configsAfterReply(NO_CONFIGS, { config, stored: true });
    expect(stored).toEqual({ live: undefined, stored: config });

    const live = configsAfterReply(NO_CONFIGS, { config, stored: false });
    expect(live).toEqual({ live: config, stored: undefined });
  });

  it("draws the live config, and the stored one only as a fallback", () => {
    const other = { models: [haiku] };
    expect(drawnConfig({ live: undefined, stored: config })).toBe(config);
    expect(drawnConfig({ live: other, stored: config })).toBe(other);
    expect(drawnConfig(NO_CONFIGS)).toBeUndefined();
  });

  it("is a cold start that works: a cached reply alone still offers the models", () => {
    // The first reply is usually the cached one, so a service that only accepted live-destined
    // replies would show an empty list until the first update_state.
    const configs = configsAfterReply(NO_CONFIGS, { config, cached: true, stored: true });
    expect(modelsOf(drawnConfig(configs))).toHaveLength(2);
  });

  it("replaces the live config wholesale on an update, and clears the stored one", () => {
    const configs = configsAfterReply(NO_CONFIGS, { config, stored: true });
    const next = { models: [haiku] };

    expect(configsAfterState(configs, { config: next, state: {} })).toEqual({
      live: next,
      stored: undefined,
    });
  });

  it("keeps the live config when an update carries none, and still clears the stored one", () => {
    const configs = { live: config, stored: { models: [haiku] } };
    expect(configsAfterState(configs, { state: {} })).toEqual({ live: config, stored: undefined });
  });

  it("empties a non-empty account when an update carries no config", () => {
    const withAccount = { models: [opus], account: { email: "someone@example.com" } };
    const after = configsAfterState({ live: withAccount, stored: undefined }, { state: {} });
    expect(after.live).toEqual({ models: [opus], account: {} });
  });

  it("leaves an already-empty account's config untouched, rather than copying it", () => {
    const withEmpty = { models: [opus], account: {} };
    const after = configsAfterState({ live: withEmpty, stored: undefined }, { state: {} });
    expect(after.live).toBe(withEmpty);
  });
});

describe("reading a config", () => {
  it("takes the panel's own effort default for a model that lists none", () => {
    const [, second] = modelsOf(config);
    expect(second?.supportedEffortLevels).toEqual(DEFAULT_EFFORT_LEVELS);
    expect(second?.supportsEffort).toBe(false);
  });

  it("skips an entry with no value to be known by, rather than inventing one", () => {
    expect(modelsOf({ models: [{ displayName: "Nameless" }, opus] })).toHaveLength(1);
  });

  it("reads an absent or misshapen config as offering nothing", () => {
    expect(modelsOf(undefined)).toEqual([]);
    expect(modelsOf({ models: "opus" })).toEqual([]);
    expect(unavailableOf({ unavailable_models: [1, "sonnet"] })).toEqual(["sonnet"]);
  });
});

describe("the lookup chain", () => {
  const models = modelsOf(config);

  it("matches the alias as stored", () => {
    expect(currentModel(models, "opus")?.value).toBe("opus");
  });

  it("matches the alias with the million-token marker stripped", () => {
    expect(currentModel(models, "opus[1m]")?.value).toBe("opus");
    expect(currentModel(models, "OPUS[1M]")).toBeNull();
  });

  it("matches a concrete id against resolvedModel, so a pinned setting still resolves", () => {
    expect(currentModel(models, "claude-opus-5")?.value).toBe("opus");
  });

  it("treats no setting as the default, which is an alias like any other", () => {
    const withDefault = modelsOf({ models: [{ value: "default" }, opus] });
    expect(currentModel(withDefault, null)?.value).toBe("default");
    expect(currentModel(withDefault, "")?.value).toBe("default");
    expect(currentModel(models, null)).toBeNull();
  });

  it("is null for a setting this install no longer offers, which the warning state is for", () => {
    expect(currentModel(models, "gone")).toBeNull();
  });
});

describe("the live state", () => {
  it("reads the setting and the effort off an update_state request", () => {
    const request = { state: { modelSetting: "opus", settings: { effortLevel: "high" } } };
    expect(settingOf(request)).toBe("opus");
    expect(effortOf(request)).toBe("high");
    expect(settingOf({ state: {} })).toBeNull();
    expect(effortOf({ state: { settings: {} } })).toBeNull();
  });

  it("drops an effort the live model does not take, whatever the file says", () => {
    const configs = { live: config, stored: undefined };
    // `haiku` does not support effort, so a stored effortLevel is not live for it.
    expect(modelStateOf(configs, "haiku", "high").effort).toBeNull();
    // `opus` does, but only at the levels it lists.
    expect(modelStateOf(configs, "opus", "high").effort).toBe("high");
    expect(modelStateOf(configs, "opus", "low").effort).toBeNull();
  });

  it("answers supportsEffort against the model's own list and nothing of ours", () => {
    const [first] = modelsOf(config) as [ModelEntry];
    expect(supportsEffort(first, "medium")).toBe(true);
    expect(supportsEffort(first, "low")).toBe(false);
    expect(supportsEffort(null, "high")).toBe(false);
  });

  it("carries the setting even where nothing in the list matches it", () => {
    const state = modelStateOf({ live: config, stored: undefined }, "gone", null);
    expect(state.setting).toBe("gone");
    expect(state.current).toBeNull();
  });
});

describe("sameModelState", () => {
  const configs = { live: config, stored: undefined };

  it("is true for two readings of the same thing", () => {
    expect(
      sameModelState(modelStateOf(configs, "opus", "high"), modelStateOf(configs, "opus", "high")),
    ).toBe(true);
  });

  it("notices a changed setting, effort, list or unavailable set", () => {
    const base = modelStateOf(configs, "opus", "high");
    expect(sameModelState(base, modelStateOf(configs, "haiku", "high"))).toBe(false);
    expect(sameModelState(base, modelStateOf(configs, "opus", "medium"))).toBe(false);
    expect(
      sameModelState(
        base,
        modelStateOf({ live: { models: [opus] }, stored: undefined }, "opus", "high"),
      ),
    ).toBe(false);
    expect(
      sameModelState(
        base,
        modelStateOf(
          { live: { ...config, unavailable_models: [] }, stored: undefined },
          "opus",
          "high",
        ),
      ),
    ).toBe(false);
  });

  it("notices a model whose resolved id moved under the same alias", () => {
    const moved = { ...config, models: [{ ...opus, resolvedModel: "claude-opus-5-5" }, haiku] };
    const base = modelStateOf(configs, "opus", "high");
    expect(
      sameModelState(base, modelStateOf({ live: moved, stored: undefined }, "opus", "high")),
    ).toBe(false);
  });
});

describe("choiceProblem", () => {
  const state = modelStateOf({ live: config, stored: undefined }, "opus", "high");

  it("accepts a model the install offers, with an effort it takes", () => {
    expect(choiceProblem(state, { model: "opus", effort: "medium" })).toBeNull();
  });

  it("refuses a model the install does not offer, by name", () => {
    expect(choiceProblem(state, { model: "gone" })).toMatch(/does not offer the model "gone"/);
  });

  it("refuses an effort the named model does not take", () => {
    // Validated against the live list, never a table of ours: `opus` lists medium and high here.
    expect(choiceProblem(state, { model: "opus", effort: "low" })).toMatch(/the effort "low"/);
  });

  it("judges the effort against the model being set, not the one that is live", () => {
    // `haiku` takes no effort, so pairing it with one is incoherent even though `opus` is live.
    expect(choiceProblem(state, { model: "haiku", effort: "high" })).toMatch(
      /does not take an effort level/,
    );
  });

  it("judges an effort alone against the live model", () => {
    expect(choiceProblem(state, { effort: "medium" })).toBeNull();
    const onHaiku = modelStateOf({ live: config, stored: undefined }, "haiku", null);
    expect(choiceProblem(onHaiku, { effort: "medium" })).toMatch(/does not take an effort/);
  });

  it("refuses an effort with no model live to apply it to", () => {
    const nothing = modelStateOf({ live: config, stored: undefined }, "gone", null);
    expect(choiceProblem(nothing, { effort: "high" })).toMatch(/no model is live/);
  });

  it("refuses an effort and a thinking level together, which are the two mechanisms", () => {
    expect(choiceProblem(state, { effort: "high", thinkingLevel: "deep" })).toMatch(/never both/);
  });

  it("refuses a thinking level for a model that takes an effort instead", () => {
    expect(choiceProblem(state, { model: "opus", thinkingLevel: "deep" })).toMatch(
      /takes an effort level rather than/,
    );
  });

  it("accepts a thinking level for a model that takes no effort", () => {
    expect(choiceProblem(state, { model: "haiku", thinkingLevel: "deep" })).toBeNull();
  });

  it("refuses a choice that names nothing", () => {
    expect(choiceProblem(state, {})).toMatch(/has to name something/);
  });

  it("accepts ultracode on its own, which is a flag and not a model property", () => {
    expect(choiceProblem(state, { ultracode: true })).toBeNull();
  });
});

describe("what set_model needs and answers", () => {
  it("wraps the model as the object the extension requires", () => {
    // `setModel` throws `set_model: malformed request` unless `model.value` is a string.
    expect(setModelField("opus")).toEqual({ value: "opus" });
    expect(setModelField("default")).toEqual({ value: "default" });
  });

  it("reads `applied` off the reply, and treats its absence as not knowing", () => {
    expect(appliedModelOf({ type: "set_model_response", applied: "claude-opus-5" })).toBe(
      "claude-opus-5",
    );
    // The reply omits `applied` when the write returned nothing, which is a real answer.
    expect(appliedModelOf({ type: "set_model_response" })).toBeNull();
    expect(appliedModelOf(null)).toBeNull();
  });
});

describe("reading the model block", () => {
  it("is off with no default when absent", () => {
    expect(readModelSettings(undefined)).toEqual({ settings: NO_MODEL_SETTINGS, unknown: [] });
    expect(readModelSettings(null)).toEqual({ settings: NO_MODEL_SETTINGS, unknown: [] });
  });

  it("reads a mode and a default", () => {
    expect(
      readModelSettings({
        requireChoice: "unlessDefault",
        default: { model: "opus", effort: "high" },
      }),
    ).toEqual({
      settings: { requireChoice: "unlessDefault", default: { model: "opus", effort: "high" } },
      unknown: [],
    });
  });

  it("reads a mode it does not know as off, and names it, since a later Rigline may have written it", () => {
    expect(readModelSettings({ requireChoice: "smart", later: 1 })).toEqual({
      settings: NO_MODEL_SETTINGS,
      unknown: ["model.later", "model.requireChoice: smart"],
    });
  });

  it("keeps a key under the default it does not know, and names it", () => {
    expect(readModelSettings({ default: { model: "opus", speed: "fast" } })).toEqual({
      settings: { requireChoice: "off", default: { model: "opus" } },
      unknown: ["model.default.speed"],
    });
  });

  it("refuses a block of the wrong shape, which is a person's mistake", () => {
    expect(readModelSettings("always")).toEqual({
      problem: '"model" must be a mapping of settings',
    });
    expect(readModelSettings({ requireChoice: true })).toHaveProperty("problem");
    expect(readModelSettings({ default: "opus" })).toHaveProperty("problem");
    expect(readModelSettings({ default: { effort: "high" } })).toHaveProperty("problem");
    expect(readModelSettings({ default: { model: "opus", effort: 3 } })).toHaveProperty("problem");
    expect(
      readModelSettings({ default: { model: "haiku", effort: "high", thinkingLevel: "deep" } }),
    ).toEqual({ problem: '"model.default" takes an effort or a thinking level, never both' });
    expect(readModelSettings({ default: { model: "opus", ultracode: "yes" } })).toHaveProperty(
      "problem",
    );
  });
});

describe("whether a send waits for a choice", () => {
  const configs = { live: config, stored: undefined };
  const always: ModelSettings = { requireChoice: "always", default: null };
  const usual: ModelSettings = {
    requireChoice: "unlessDefault",
    default: { model: "opus", effort: "high" },
  };

  it("never waits with the gate off", () => {
    expect(modelStateOf(configs, "haiku", null).choiceRequired).toBe(false);
  });

  it("waits in every session until something chooses, in mode 3", () => {
    expect(modelStateOf(configs, "opus", "high", always).choiceRequired).toBe(true);
    expect(modelStateOf(configs, "opus", "high", always, true).choiceRequired).toBe(false);
  });

  it("waits in mode 2 only while the default is not what is live", () => {
    expect(modelStateOf(configs, "opus", "high", usual).choiceRequired).toBe(false);
    expect(modelStateOf(configs, "opus", "medium", usual).choiceRequired).toBe(true);
    expect(modelStateOf(configs, "haiku", null, usual).choiceRequired).toBe(true);
    // The million-token marker resolves to the same entry, so it is the same model.
    expect(modelStateOf(configs, "opus[1m]", "high", usual).choiceRequired).toBe(false);
    expect(modelStateOf(configs, "haiku", null, usual, true).choiceRequired).toBe(false);
  });

  it("waits in mode 2 while nothing is known, rather than letting through what it was asked to stop", () => {
    expect(modelStateOf(NO_CONFIGS, "opus", "high", usual).choiceRequired).toBe(true);
    expect(modelStateOf(configs, null, null, usual).choiceRequired).toBe(true);
  });

  it("matches the default on its model alone when it names no effort", () => {
    const anyEffort: ModelSettings = { requireChoice: "unlessDefault", default: { model: "opus" } };
    expect(modelStateOf(configs, "opus", "medium", anyEffort).choiceRequired).toBe(false);
  });

  it("resolves the default against the list, and reads null where the install no longer offers it", () => {
    expect(modelStateOf(configs, "opus", "high", usual).default).toEqual({
      choice: { model: "opus", effort: "high" },
      model: { ...opus },
    });
    const gone: ModelSettings = { requireChoice: "always", default: { model: "sonnet" } };
    expect(modelStateOf(configs, "opus", "high", gone).default).toBeNull();
  });

  it("is a change sameModelState sees", () => {
    expect(
      sameModelState(
        modelStateOf(configs, "opus", "high", always),
        modelStateOf(configs, "opus", "high", always, true),
      ),
    ).toBe(false);
  });

  it("counts a choice of model or effort, and not an ultracode switch on its own", () => {
    expect(choosesModel({ model: "opus" })).toBe(true);
    expect(choosesModel({ effort: "high" })).toBe(true);
    expect(choosesModel({ thinkingLevel: "deep" })).toBe(true);
    expect(choosesModel({ ultracode: true })).toBe(false);
  });
});

describe("what a person reads for a model", () => {
  const entry = (
    resolvedModel: string | null,
    displayName: string | null = "Opus",
  ): ModelEntry => ({
    value: "opus",
    resolvedModel,
    displayName,
    supportsEffort: true,
    supportedEffortLevels: DEFAULT_EFFORT_LEVELS,
  });

  it("reads the version off the concrete id, since the alias is named by its family alone", () => {
    expect(modelLabel(entry("claude-opus-5-5"))).toBe("Opus 5.5");
    expect(modelLabel(entry("claude-opus-5"))).toBe("Opus 5");
    expect(modelLabel(entry("claude-opus-4-1-20250805"))).toBe("Opus 4.1");
    expect(modelLabel(entry("claude-sonnet-4-20250514", "Default (recommended)"))).toBe("Sonnet 4");
    expect(modelLabel(entry("claude-opus-5-5[1m]"))).toBe("Opus 5.5");
  });

  it("shows an id of any other shape whole rather than guessing at it", () => {
    expect(modelLabel(entry("us.anthropic.claude-opus-5-5-v1:0"))).toBe(
      "Opus (us.anthropic.claude-opus-5-5-v1:0)",
    );
    expect(modelLabel(entry(null))).toBe("Opus");
    expect(modelLabel(entry(null, null))).toBe("opus");
  });

  it("puts the effort beside it", () => {
    expect(comboLabel(entry("claude-opus-5-5"), "high")).toBe("Opus 5.5 · high");
    expect(comboLabel(entry("claude-opus-5-5"), null)).toBe("Opus 5.5");
  });
});
