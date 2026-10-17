/**
 * The favourites' reading and words. The model state is the panel's own and is tested in the host;
 * `packages/harness/test/model-favourites.test.ts` draws all of it against the real bundle.
 */
import type { ModelEntry } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import {
  addProblem,
  entriesOf,
  favouriteLabel,
  favouritesOf,
  sameChoice,
  segmentLabels,
  unavailable,
} from "./index.tsx";

const opus: ModelEntry = {
  value: "opus",
  resolvedModel: "claude-opus-5-5",
  displayName: "Opus",
  supportsEffort: true,
  supportedEffortLevels: ["low", "medium", "high", "xhigh"],
};
const sonnet: ModelEntry = {
  ...opus,
  value: "sonnet",
  resolvedModel: "claude-sonnet-5-5",
  displayName: "Sonnet",
};
const haiku: ModelEntry = {
  value: "haiku",
  resolvedModel: "claude-haiku-5-5",
  displayName: "Haiku",
  supportsEffort: false,
  supportedEffortLevels: ["low", "medium", "high"],
};
const MODELS = [opus, sonnet, haiku];

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
    expect(unavailable({ model: "haiku", effort: "high" }, MODELS)).toBe("takes no effort");
    expect(unavailable({ model: "opus", effort: "max" }, MODELS)).toBe(
      "no effort max for this model",
    );
    expect(unavailable({ model: "opus", effort: "high" }, MODELS)).toBeNull();
    expect(unavailable({ model: "gone" }, [])).toBeNull();
  });
});

describe("the segments", () => {
  it("names a model once for a run of favourites on it", () => {
    const favourites = [
      { model: "opus", effort: "xhigh" },
      { model: "opus", effort: "low" },
      { model: "sonnet", effort: "medium" },
    ];
    expect(segmentLabels(favourites, MODELS)).toEqual([
      "Opus 5.5 · xhigh",
      "low",
      "Sonnet 5.5 · medium",
    ]);
  });

  it("names it again once the run is broken, and for a repeat with nothing else to say", () => {
    const favourites = [
      { model: "opus", effort: "xhigh" },
      { model: "sonnet", effort: "medium" },
      { model: "opus", effort: "low" },
      { model: "haiku" },
      { model: "haiku" },
    ];
    expect(segmentLabels(favourites, MODELS)).toEqual([
      "Opus 5.5 · xhigh",
      "Sonnet 5.5 · medium",
      "Opus 5.5 · low",
      "Haiku 5.5",
      "Haiku 5.5",
    ]);
  });

  it("takes a concrete id and its alias for one model", () => {
    const favourites = [
      { model: "opus", effort: "xhigh" },
      { model: "claude-opus-5-5", effort: "low" },
    ];
    expect(segmentLabels(favourites, MODELS)).toEqual(["Opus 5.5 · xhigh", "low"]);
  });
});

describe("comparing choices", () => {
  it("resolves both, so a concrete id is the alias it resolves from", () => {
    expect(sameChoice({ model: "claude-opus-5-5" }, { model: "opus" }, MODELS)).toBe(true);
    expect(sameChoice({ model: "opus", effort: "high" }, { model: "opus" }, MODELS)).toBe(false);
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
