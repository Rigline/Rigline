/**
 * The model derivation: the two configs the panel keeps, the lookup chain, and what counts as a live
 * effort. Every shape asserted here was read in the 2.1.300 webview bundle.
 */
import { describe, expect, it } from "vitest";
import {
  appliedModelOf,
  choiceProblem,
  configsAfterReply,
  configsAfterState,
  currentModel,
  DEFAULT_EFFORT_LEVELS,
  drawnConfig,
  effortOf,
  type ModelEntry,
  modelStateOf,
  modelsOf,
  NO_CONFIGS,
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
