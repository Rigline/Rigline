/**
 * The favourites' reading and words. The model state is the host's (D120) and is tested there;
 * `packages/harness/test/model-favourites.test.ts` draws all of it against the real bundle.
 */
import { type ModelEntry, type ModelState, NO_MODEL_STATE } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import {
  addProblem,
  entriesOf,
  favouriteLabel,
  favouritesOf,
  liveKnown,
  liveLabel,
  offList,
  sameChoice,
  statusTooltip,
  unavailable,
} from "./index.tsx";

const opus: ModelEntry = {
  value: "opus",
  resolvedModel: "claude-opus-5-5",
  displayName: "Opus",
  supportsEffort: true,
  supportedEffortLevels: ["medium", "high"],
};
const haiku: ModelEntry = {
  value: "haiku",
  resolvedModel: "claude-haiku-5-5",
  displayName: "Haiku",
  supportsEffort: false,
  supportedEffortLevels: ["low", "medium", "high"],
};
const MODELS = [opus, haiku];

const state = (over: Partial<ModelState> = {}): ModelState => ({
  ...NO_MODEL_STATE,
  models: MODELS,
  current: opus,
  setting: "opus",
  effort: "high",
  ...over,
});

describe("reading the list", () => {
  it("keeps every entry as written, and reads the ones that are choices", () => {
    const section = { favourites: [{ model: "opus", effort: "high" }, "haiku", { model: "" }] };
    expect(entriesOf(section)).toHaveLength(3);
    expect(favouritesOf(section)).toEqual([{ model: "opus", effort: "high" }]);
  });

  it("reads a missing or misshapen list as empty", () => {
    expect(entriesOf({})).toEqual([]);
    expect(entriesOf({ favourites: "opus" })).toEqual([]);
  });
});

describe("what a favourite reads as", () => {
  it("names the version its alias resolves to, with the effort", () => {
    expect(favouriteLabel({ model: "opus", effort: "high" }, MODELS)).toBe("Opus 5.5 · high");
    expect(favouriteLabel({ model: "haiku" }, MODELS)).toBe("Haiku 5.5");
  });

  it("names the alias where the list has not got it", () => {
    expect(favouriteLabel({ model: "opus", effort: "high" }, [])).toBe("opus · high");
  });

  it("says what a hand-written favourite carries besides", () => {
    expect(favouriteLabel({ model: "haiku", thinkingLevel: "deep", ultracode: true }, MODELS)).toBe(
      "Haiku 5.5 · thinking deep · ultracode",
    );
  });

  it("says why one cannot be applied, and nothing before the list arrives", () => {
    expect(unavailable({ model: "gone" }, MODELS)).toBe("not offered by this install");
    expect(unavailable({ model: "opus", effort: "max" }, MODELS)).toBe(
      "no effort max for this model",
    );
    expect(unavailable({ model: "haiku", effort: "high" }, MODELS)).toBe("takes no effort");
    expect(unavailable({ model: "opus", effort: "high" }, MODELS)).toBeNull();
    expect(unavailable({ model: "gone" }, [])).toBeNull();
  });
});

describe("comparing choices", () => {
  it("resolves both, so a concrete id is the alias it resolves from", () => {
    expect(sameChoice({ model: "claude-opus-5-5" }, { model: "opus" }, MODELS)).toBe(true);
    expect(sameChoice({ model: "opus", effort: "high" }, { model: "opus" }, MODELS)).toBe(false);
  });
});

describe("what is live", () => {
  it("is not known before the list, nor before the setting where nothing answers to no setting", () => {
    expect(liveKnown(state({ models: [] }))).toBe(false);
    expect(liveKnown(state({ current: null, setting: null }))).toBe(false);
    expect(liveKnown(state({ current: null, setting: "gone" }))).toBe(true);
  });

  it("reads as its version, or as the setting where the install does not offer it", () => {
    expect(liveLabel(state())).toBe("Opus 5.5 · high");
    expect(liveLabel(state({ current: null, setting: "gone" }))).toBe("gone");
  });

  it("is off the list when it is neither a favourite nor the default", () => {
    const favourites = [{ model: "opus", effort: "medium" }];
    expect(offList(state(), favourites)).toBe(true);
    expect(offList(state(), [{ model: "opus", effort: "high" }])).toBe(false);
    const usual = { choice: { model: "opus", effort: "high" }, model: opus };
    expect(offList(state({ default: usual }), favourites)).toBe(false);
  });

  it("is never off a list nobody has set up", () => {
    expect(offList(state(), [])).toBe(false);
  });
});

describe("adding a favourite", () => {
  it("wants a model, and an effort where the model takes one", () => {
    expect(addProblem(null, [], MODELS)).toBe("Choose a model first");
    expect(addProblem({ model: "opus" }, [], MODELS)).toBe(
      "Choose an effort too, so the favourite sets both",
    );
    expect(addProblem({ model: "haiku" }, [], MODELS)).toBeNull();
  });

  it("refuses a repeat", () => {
    const favourites = [{ model: "opus", effort: "high" }];
    expect(addProblem({ model: "opus", effort: "high" }, favourites, MODELS)).toBe(
      "Already a favourite",
    );
    expect(addProblem({ model: "opus", effort: "medium" }, favourites, MODELS)).toBeNull();
  });
});

describe("the status pill's tooltip", () => {
  it("says what is live, what is wrong with it, and what a click does", () => {
    expect(statusTooltip(state({ models: [] }), [])).toBe("Waiting for Claude Code's model list");
    expect(statusTooltip(state({ choiceRequired: true }), [{ model: "haiku" }])).toBe(
      [
        "Live: Opus 5.5 · high",
        "Not one of your favourites",
        "Not chosen for this session yet",
        "No default model: click to choose one in Rigline's settings",
      ].join("\n"),
    );
    const usual = { choice: { model: "opus", effort: "high" }, model: opus };
    expect(statusTooltip(state({ default: usual }), [])).toBe(
      "Live: Opus 5.5 · high\nClick for your default: Opus 5.5 · high",
    );
  });
});
